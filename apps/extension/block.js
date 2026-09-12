/**
 * FocusLock block page logic.
 *
 * Reads the decision context passed in the query string, renders a calm block
 * screen, and — when the service says a daily break is available — offers to
 * spend one. Spending a break asks the background worker (which relays to the
 * service), then reloads the original URL so the now-unlocked page loads.
 */

const params = new URLSearchParams(location.search);
const originalUrl = params.get('url') ?? '';
const reason = params.get('reason') ?? 'permanent-block';
const breakAvailable = params.get('breakAvailable') === 'true';
const breaksRemaining = Number(params.get('breaksRemaining') ?? '0');
const msUntilReset = Number(params.get('msUntilReset') ?? '0');
const targetId = params.get('targetId');

const REASON_TEXT = {
  'permanent-block': 'This target is permanently blocked.',
  'blocked-no-break-remaining': 'No daily breaks remaining.',
  'blocked-break-on-other-target': 'Your active break is being used on another app.',
  'blocked-by-schedule': 'Outside its allowed hours.',
  'blocked-by-mode': 'Blocked by your current mode.',
  'blocked-by-focus-session': 'A focus session is in progress.',
  'blocked-fail-closed': 'Protection is active in safe mode.',
  'service-unavailable': 'FocusLock protection is unavailable, so this page is blocked.',
};

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || '—';
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

document.getElementById('host').textContent = host(originalUrl);
document.getElementById('reason').textContent =
  REASON_TEXT[reason] ?? 'This page is currently unavailable.';
document.getElementById('reset').textContent = formatDuration(msUntilReset);
document.getElementById('breaks').textContent = String(breaksRemaining);

const breakBtn = document.getElementById('break-btn');
if (breakAvailable && targetId && breaksRemaining > 0) {
  breakBtn.hidden = false;
  breakBtn.addEventListener('click', () => {
    breakBtn.disabled = true;
    breakBtn.textContent = 'Starting break…';
    chrome.runtime.sendMessage({ type: 'start-break', targetId }, (response) => {
      if (response?.ok) {
        location.href = originalUrl; // reload; the page is now unlocked
      } else {
        breakBtn.disabled = false;
        breakBtn.textContent = 'Could not start break — try again';
      }
    });
  });
}

// Auto-recover: keep asking the service whether this page is allowed again. The
// moment it is — most commonly because the user paused FocusLock — send them
// straight back to where they were, so pausing takes effect without a manual
// reload of every blocked tab.
function pollAllowed() {
  if (!originalUrl) return;
  try {
    chrome.runtime.sendMessage({ type: 'check', url: originalUrl }, (resp) => {
      if (chrome.runtime.lastError) return; // worker asleep; try again next tick
      if (resp && resp.allowed === true) location.href = originalUrl;
    });
  } catch {
    /* ignore — retried on the next interval */
  }
}
pollAllowed();
setInterval(pollAllowed, 2000);

document.getElementById('close-btn').addEventListener('click', () => {
  // window.close() only works for script-opened tabs; fall back to a blank page.
  window.close();
  location.replace('about:blank');
});
