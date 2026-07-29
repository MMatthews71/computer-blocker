import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProtectionService } from '../src/service.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
let service: ProtectionService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focuslock-'));
  store = new Store(dir, join(dir, 'config.key'));
  service = new ProtectionService(store, Date.UTC(2024, 0, 1, 12, 0, 0));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ProtectionService end-to-end', () => {
  it('allows unmanaged requests and blocks managed ones', () => {
    expect(service.check({ kind: 'web', value: 'https://example.com' }).allowed).toBe(true);
    service.addTarget({ kind: 'domain', value: 'tiktok.com', label: 'TikTok' }, { type: 'permanent-block' });
    expect(service.check({ kind: 'web', value: 'https://tiktok.com' }).allowed).toBe(false);
  });

  it('runs the full daily-break flow through the service', () => {
    const yt = service.addTarget(
      { kind: 'domain', value: 'youtube.com', label: 'YouTube' },
      { type: 'daily-break' },
    );
    // Blocked, but a break is offered.
    const before = service.check({ kind: 'web', value: 'https://youtube.com' });
    expect(before.allowed).toBe(false);
    expect(before.breakAvailable).toBe(true);

    // Spend a break.
    const started = service.startBreak(yt.target.id);
    expect(started.ok).toBe(true);
    expect(service.getStatus().breaksRemaining).toBe(1);

    // Now allowed.
    expect(service.check({ kind: 'web', value: 'https://youtube.com' }).allowed).toBe(true);
  });

  it('expands a category into many targets', () => {
    const added = service.addCategory('social-media', { type: 'permanent-block' });
    expect(added.length).toBeGreaterThan(3);
    expect(service.check({ kind: 'web', value: 'https://instagram.com' }).allowed).toBe(false);
  });

  it('refuses to end a locked focus session early', () => {
    service.startSession({
      name: 'Deep Work',
      startedAt: Date.now(),
      endsAt: Date.now() + 3_600_000,
      locked: true,
      targetIds: [],
    });
    const result = service.endSession();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('session-locked');
  });

  it('persists state across restarts', () => {
    service.addTarget({ kind: 'domain', value: 'reddit.com', label: 'Reddit' }, { type: 'permanent-block' });
    // Re-open the service against the same store (simulates a restart).
    const revived = new ProtectionService(store, Date.UTC(2024, 0, 1, 13, 0, 0));
    expect(revived.check({ kind: 'web', value: 'https://reddit.com' }).allowed).toBe(false);
  });

  it('records blocked attempts in statistics', () => {
    service.addTarget({ kind: 'domain', value: 'tiktok.com', label: 'TikTok' }, { type: 'permanent-block' });
    const now = Date.UTC(2024, 0, 1, 12, 0, 0);
    service.check({ kind: 'web', value: 'https://tiktok.com' }, now);
    service.check({ kind: 'web', value: 'https://tiktok.com' }, now + 1000);
    const stats = service.getStats(now + 2000);
    expect(stats.blockedAttempts).toBe(2);
    expect(stats.mostOpened[0]).toBe('TikTok');
  });

  it('fails closed when the persisted config is tampered with', () => {
    service.addTarget({ kind: 'domain', value: 'youtube.com', label: 'YouTube' }, { type: 'daily-break' });
    store.close();

    // Tamper: rewrite the config file's JSON directly, leaving the old signature.
    const configPath = join(dir, 'config.json');
    const payload = JSON.parse(readFileSync(configPath, 'utf8'));
    const mutated = JSON.parse(payload.json);
    mutated.managedTargets = []; // attacker removes all rules
    payload.json = JSON.stringify(mutated);
    writeFileSync(configPath, JSON.stringify(payload), 'utf8');

    // Re-open: integrity check fails -> fully fail closed.
    const reopened = new Store(dir, join(dir, 'config.key'));
    const tampered = new ProtectionService(reopened, Date.UTC(2024, 0, 1, 13, 0, 0));
    expect(tampered.getStatus().integrityOk).toBe(false);

    // Even a normally-unmanaged site is blocked while integrity is compromised:
    // the attacker cannot get a fail-open by deleting rules.
    const d = tampered.check({ kind: 'web', value: 'https://example.com' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('blocked-fail-closed');

    // Recovery: pushing a fresh config through the app re-establishes trust.
    tampered.addTarget({ kind: 'domain', value: 'x.com', label: 'X' }, { type: 'permanent-block' });
    expect(tampered.getStatus().integrityOk).toBe(true);
    expect(tampered.check({ kind: 'web', value: 'https://example.com' }).allowed).toBe(true);
    reopened.close();
  });
});
