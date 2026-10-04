/**
 * Local HTTP API — the IPC surface the browser extensions and desktop UI use
 * to talk to the service. Bound to loopback only. All rule logic lives in the
 * service/core; this file only marshals requests and responses.
 *
 * The API is deliberately small and predictable:
 *
 *   GET  /health                      liveness + integrity status
 *   POST /check        {kind,value}   "can this load/run?" -> Decision
 *   GET  /state                       full engine state (for the UI)
 *   GET  /stats                       today's rolled-up statistics
 *   POST /targets      {target,rule}  add a managed target
 *   PUT  /targets/:id   {rule}        change a target's rule
 *   DEL  /targets/:id                 remove a target
 *   POST /categories   {categoryId,rule}
 *   POST /breaks/start {targetId}
 *   POST /breaks/end
 *   POST /modes/activate {modeId|null}
 *   POST /sessions/start {name,durationMs,locked,targetIds}
 *   POST /sessions/end
 *   PUT  /settings     {resetTime?,timezoneOffsetMinutes?}
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { ProtectionService } from './service.js';
import type { ExtensionGuardian } from './guardian.js';
import type { AppGuardian } from './appguard.js';
import type { AccessRequest, Rule } from '@focuslock/core';

export interface ServerOptions {
  host?: string;
  port?: number;
  guardian?: ExtensionGuardian;
  appGuardian?: AppGuardian;
}

export const DEFAULT_PORT = 47615; // "FOCUS" on a phone keypad-ish; loopback only.

export function createApiServer(service: ProtectionService, options: ServerOptions = {}): Server {
  const host = options.host ?? '127.0.0.1';
  const guardian = options.guardian;
  const appGuardian = options.appGuardian;

  const server = createServer((req, res) => {
    handle(service, guardian, appGuardian, req, res).catch((err) => {
      sendJson(res, 500, { error: String(err?.message ?? err) });
    });
  });

  // Refuse any non-loopback connection defensively.
  server.on('connection', (socket) => {
    const addr = socket.remoteAddress ?? '';
    if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
      socket.destroy();
    }
  });

  server.listen(options.port ?? DEFAULT_PORT, host);
  return server;
}

async function handle(
  service: ProtectionService,
  guardian: ExtensionGuardian | undefined,
  appGuardian: AppGuardian | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // Basic CORS for browser extensions (loopback origin only in practice).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Chrome's Private Network Access: a request from an extension/page to this
  // loopback server is a "private network" request and its preflight must be
  // explicitly allowed, or the browser silently blocks the call.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (method === 'OPTIONS') return sendJson(res, 204, {});

  // ---- Reads ----
  if (method === 'GET' && path === '/health') {
    return sendJson(res, 200, {
      ...service.getStatus(),
      // Browser enforcement is permanent — always on, no setting to disable it.
      guardian: { enforce: true, browsers: guardian ? guardian.status() : [] },
      appGuardian: { blocked: appGuardian ? appGuardian.status() : [] },
    });
  }
  // Extension heartbeat: proof that a supported browser is running FocusLock.
  if (method === 'POST' && path === '/extension/heartbeat') {
    const body = await readJson<{ browser?: string }>(req);
    if (guardian) guardian.heartbeat(body?.browser ?? 'chrome');
    return sendJson(res, 200, { ok: true });
  }
  // Graceful shutdown, used by the desktop app to replace an outdated service.
  // Loopback-only is already enforced by the connection guard.
  if (method === 'POST' && path === '/shutdown') {
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }
  if (method === 'GET' && path === '/state') {
    return sendJson(res, 200, service.getState());
  }
  if (method === 'GET' && path === '/stats') {
    return sendJson(res, 200, service.getStats());
  }

  // ---- The check ----
  if (method === 'POST' && path === '/check') {
    const body = await readJson<AccessRequest>(req);
    if (!body || (body.kind !== 'web' && body.kind !== 'app') || typeof body.value !== 'string') {
      return sendJson(res, 400, { error: 'expected {kind:"web"|"app", value:string}' });
    }
    return sendJson(res, 200, service.check(body));
  }

  // ---- Targets ----
  if (method === 'POST' && path === '/targets') {
    const body = await readJson<{ target: { kind: string; value: string; label: string }; rule: Rule }>(req);
    if (!body?.target || !body.rule) return sendJson(res, 400, { error: 'expected {target, rule}' });
    const created = service.addTarget(body.target as never, body.rule);
    return sendJson(res, 201, created);
  }
  const targetMatch = /^\/targets\/([^/]+)$/.exec(path);
  if (targetMatch) {
    const id = decodeURIComponent(targetMatch[1]!);
    if (method === 'PUT') {
      const body = await readJson<{ rule: Rule }>(req);
      if (!body?.rule) return sendJson(res, 400, { error: 'expected {rule}' });
      const result = service.updateTargetRule(id, body.rule);
      if (result.ok) return sendJson(res, 200, { ok: true });
      return sendJson(res, result.reason === 'not-found' ? 404 : 403, { ok: false, error: result.reason });
    }
    if (method === 'DELETE') {
      // Targets are locked once added (commitment device); removal is refused.
      const result = service.removeTarget(id);
      return sendJson(res, result.reason === 'not-found' ? 404 : 403, { ok: false, error: result.reason });
    }
  }

  // ---- Categories ----
  if (method === 'POST' && path === '/categories') {
    const body = await readJson<{ categoryId: string; rule: Rule }>(req);
    if (!body?.categoryId || !body.rule) return sendJson(res, 400, { error: 'expected {categoryId, rule}' });
    try {
      return sendJson(res, 201, service.addCategory(body.categoryId, body.rule));
    } catch (err) {
      return sendJson(res, 400, { error: String((err as Error).message) });
    }
  }

  // ---- Breaks ----
  if (method === 'POST' && path === '/breaks/start') {
    const body = await readJson<{ targetId: string }>(req);
    if (!body?.targetId) return sendJson(res, 400, { error: 'expected {targetId}' });
    const result = service.startBreak(body.targetId);
    return sendJson(res, result.ok ? 200 : 409, result);
  }
  if (method === 'POST' && path === '/breaks/end') {
    service.endBreak();
    return sendJson(res, 200, { ok: true });
  }

  // ---- Modes ----
  if (method === 'POST' && path === '/modes/activate') {
    const body = await readJson<{ modeId: string | null }>(req);
    const modeId = body?.modeId ?? null;
    return sendJson(res, service.setActiveMode(modeId) ? 200 : 404, { ok: true });
  }

  // ---- Focus sessions ----
  if (method === 'POST' && path === '/sessions/start') {
    const body = await readJson<{ name: string; durationMs: number; locked?: boolean; targetIds?: string[] }>(req);
    if (!body?.name || !Number.isFinite(body.durationMs)) {
      return sendJson(res, 400, { error: 'expected {name, durationMs, locked?, targetIds?}' });
    }
    const now = Date.now();
    const session = service.startSession({
      name: body.name,
      startedAt: now,
      endsAt: now + body.durationMs,
      locked: body.locked ?? false,
      targetIds: body.targetIds ?? [],
    });
    return sendJson(res, 201, session);
  }
  if (method === 'POST' && path === '/sessions/end') {
    const result = service.endSession();
    return sendJson(res, result.ok ? 200 : 409, result);
  }

  // ---- Settings ----
  if (method === 'PUT' && path === '/settings') {
    const body = await readJson<{
      resetTime?: string;
      timezoneOffsetMinutes?: number;
    }>(req);
    service.updateSettings(body ?? {});
    return sendJson(res, 200, service.getState().settings);
  }

  sendJson(res, 404, { error: `no route for ${method} ${path}` });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return null;
  }
}
