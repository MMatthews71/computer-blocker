/**
 * FocusLock browser extension — background service worker.
 *
 * The extension is intentionally "dumb": it stores no rules and makes no
 * blocking decisions of its own. It asks the local FocusLock service, "Can
 * this page load?", and if the answer is no it redirects the tab to the
 * bundled block page. The service is always the single source of truth.
 *
 * If the service is unreachable the extension FAILS CLOSED: it blocks the
 * navigation and shows a "protection unavailable" block page rather than
 * letting the page through.
 *
 * Reliability: navigations are caught from several angles — webNavigation
 * (before-navigate, committed, history state), tabs.onUpdated (reloads and URL
 * changes), and a scan of already-open tabs on startup — so a page can't slip
 * through just because one signal was missed while the worker was asleep.
 *
 * Open the service-worker console (chrome://extensions → FocusLock →
 * "Inspect views: service worker") to watch the [FocusLock] logs below.
 */

const SERVICE_ORIGIN = 'http://127.0.0.1:47615';
const BLOCK_PAGE = chrome.runtime.getURL('block.html');

function log(...args) {
  console.log('[FocusLock]', ...args);
}

/** Best-effort detection of which browser this is, for the guardian. */
function detectBrowser() {
  try {
    if (typeof navigator !== 'undefined' && navigator.brave) return 'brave';
  } catch {
    /* ignore */
  }
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'opera';
  return 'chrome';
}
const BROWSER_FAMILY = detectBrowser();

/**
 * Tell the service this browser is running FocusLock. If these stop arriving,
 * the service's guardian will (after a grace period) close this browser — that
 * is how "the extension can't just be removed" is enforced.
 */
async function sendHeartbeat() {
  try {
    await fetch(`${SERVICE_ORIGIN}/extension/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser: BROWSER_FAMILY }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    /* service not up yet; will retry on the next tick */
  }
}

/** Ask the service about a URL. Returns a Decision, or null if unreachable. */
async function checkUrl(url) {
  try {
    const res = await fetch(`${SERVICE_ORIGIN}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'web', value: url }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      log('check HTTP', res.status, 'for', url);
      return null;
    }
    return await res.json();
  } catch (err) {
    log('check failed (service unreachable?):', String(err && err.message ? err.message : err));
    return null;
  }
}

/** Build the block-page URL carrying just enough context for it to render. */
function blockPageFor(url, decision) {
  const params = new URLSearchParams({ url });
  if (decision) {
    params.set('reason', decision.reason);
    params.set('breakAvailable', String(decision.breakAvailable));
    params.set('breaksRemaining', String(decision.breaksRemaining));
    params.set('msUntilReset', String(decision.msUntilReset));
    if (decision.targetId) params.set('targetId', decision.targetId);
  } else {
    params.set('reason', 'service-unavailable');
  }
  return `${BLOCK_PAGE}?${params.toString()}`;
}

/** Only govern real web pages — never the block page or internal schemes. */
function isGovernable(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://')) && !url.startsWith(BLOCK_PAGE);
}

/** Evaluate a tab's URL and redirect to the block page if it isn't allowed. */
async function evaluate(tabId, url, source) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  if (!isGovernable(url)) return;

  const decision = await checkUrl(url);
  const blocked = decision ? !decision.allowed : true; // fail closed on null
  log(source, blocked ? 'BLOCK' : 'allow', url, decision ? `(${decision.reason})` : '(no service)');
  if (blocked) {
    try {
      await chrome.tabs.update(tabId, { url: blockPageFor(url, decision) });
    } catch (err) {
      log('redirect failed:', String(err && err.message ? err.message : err));
    }
  }
}

// --- webNavigation signals (top frame only) ---------------------------------
function fromWebNav(source) {
  return (details) => {
    if (details.frameId !== 0) return;
    evaluate(details.tabId, details.url, source);
  };
}
chrome.webNavigation.onBeforeNavigate.addListener(fromWebNav('before-navigate'));
chrome.webNavigation.onCommitted.addListener(fromWebNav('committed'));
chrome.webNavigation.onHistoryStateUpdated.addListener(fromWebNav('history-state'));

// --- tabs.onUpdated: reliably fires on reloads and URL changes ---------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    const url = changeInfo.url || (tab && tab.url);
    if (url) evaluate(tabId, url, 'tab-updated');
  }
});

// --- On startup / install, scan any already-open tabs -----------------------
function scanOpenTabs(reason) {
  chrome.tabs.query({}, (tabs) => {
    log(`scanning ${tabs.length} open tab(s) (${reason})`);
    for (const tab of tabs) {
      if (tab.id != null && tab.url) evaluate(tab.id, tab.url, 'startup-scan');
    }
  });
}
chrome.runtime.onStartup.addListener(() => {
  sendHeartbeat();
  scanOpenTabs('browser startup');
});
chrome.runtime.onInstalled.addListener(() => {
  log('installed / updated — FocusLock extension active');
  sendHeartbeat();
  scanOpenTabs('installed');
});

// --- Live enforcement: catch pages that become blocked while sitting open ----
// Re-check the tab you switch to, and the focused tab when a window regains
// focus, so an expired break blocks immediately when you return to the page.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (!chrome.runtime.lastError && tab && tab.url) evaluate(tabId, tab.url, 'tab-activated');
  });
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    for (const tab of tabs) if (tab.id != null && tab.url) evaluate(tab.id, tab.url, 'window-focus');
  });
});

// A periodic backstop (every 30s — the alarms minimum) re-checks every open tab.
// This catches background tabs whose page timers the browser has throttled.
chrome.alarms.create('focuslock-recheck', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'focuslock-recheck') {
    sendHeartbeat(); // ~every 30s, well within the guardian's timeout
    scanOpenTabs('alarm');
  }
});

// --- Messaging: break start + health, used by the block page and popup ------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message && message.type === 'recheck' && message.url) {
      const tabId = _sender.tab && _sender.tab.id;
      if (typeof tabId !== 'number' || !isGovernable(message.url)) {
        sendResponse({ blocked: false });
        return;
      }
      const decision = await checkUrl(message.url);
      // Only redirect on a *definite* block. If the service is momentarily
      // unreachable we skip this cycle rather than yanking the user off an
      // active page — navigation-time checks still fail closed.
      if (decision && !decision.allowed) {
        log('recheck BLOCK', message.url, `(${decision.reason})`);
        try {
          await chrome.tabs.update(tabId, { url: blockPageFor(message.url, decision) });
        } catch (err) {
          log('recheck redirect failed:', String(err && err.message ? err.message : err));
        }
        sendResponse({ blocked: true });
      } else {
        sendResponse({ blocked: false });
      }
      return;
    }
    if (message && message.type === 'start-break' && message.targetId) {
      try {
        const res = await fetch(`${SERVICE_ORIGIN}/breaks/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetId: message.targetId }),
        });
        sendResponse({ ok: res.ok });
      } catch {
        sendResponse({ ok: false });
      }
      return;
    }
    if (message && message.type === 'health') {
      try {
        const res = await fetch(`${SERVICE_ORIGIN}/health`, { signal: AbortSignal.timeout(1000) });
        sendResponse(res.ok ? await res.json() : { running: false });
      } catch {
        sendResponse({ running: false });
      }
      return;
    }
    sendResponse({ ok: false });
  })();
  return true; // async response
});

log(`service worker loaded (browser: ${BROWSER_FAMILY})`);
sendHeartbeat();
