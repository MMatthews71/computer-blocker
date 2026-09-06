import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppGuardian } from '../src/appguard.js';
import { ProtectionService } from '../src/service.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
let service: ProtectionService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focuslock-appguard-'));
  store = new Store(dir, join(dir, 'config.key'));
  service = new ProtectionService(store, Date.UTC(2024, 0, 1, 12, 0, 0));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** An app guardian wired to a real service but fake process listing/killing. */
function makeGuardian(running: string[]) {
  const killed: string[] = [];
  const blocked: string[] = [];
  const guardian = new AppGuardian({
    evaluate: (name) => service.evaluateApp(name),
    onBlocked: (name) => blocked.push(name),
    listProcesses: async () => running,
    killProcess: async (name) => {
      killed.push(name);
    },
  });
  return { guardian, killed, blocked };
}

describe('AppGuardian', () => {
  it('closes a running app the user has permanently blocked', async () => {
    service.addTarget({ kind: 'app', value: 'Terraria', label: 'Terraria' }, { type: 'permanent-block' });
    const { guardian, killed } = makeGuardian(['Terraria.exe', 'explorer.exe', 'node.exe']);
    await guardian.tick();
    expect(killed).toEqual(['Terraria.exe']); // matched by name, .exe-insensitive
  });

  it('NEVER closes an unmanaged / system process', async () => {
    // No targets at all.
    const { guardian, killed } = makeGuardian(['explorer.exe', 'svchost.exe', 'node.exe', 'winlogon.exe']);
    await guardian.tick();
    expect(killed).toEqual([]);
  });

  it('does not close an app that is always-allowed', async () => {
    service.addTarget({ kind: 'app', value: 'Terraria', label: 'Terraria' }, { type: 'always-allowed' });
    const { guardian, killed } = makeGuardian(['Terraria.exe']);
    await guardian.tick();
    expect(killed).toEqual([]);
  });

  it('does not close a blocked app while a break for it is active', async () => {
    const t = service.addTarget({ kind: 'app', value: 'Terraria', label: 'Terraria' }, { type: 'daily-break' });
    const start = service.startBreak(t.target.id);
    expect(start.ok).toBe(true);
    const { guardian, killed } = makeGuardian(['Terraria.exe']);
    await guardian.tick();
    expect(killed).toEqual([]);
  });

  it('records a blocked attempt once per new block, not every tick', async () => {
    service.addTarget({ kind: 'app', value: 'Terraria', label: 'Terraria' }, { type: 'permanent-block' });
    const { guardian, killed, blocked } = makeGuardian(['Terraria.exe']);
    await guardian.tick();
    await guardian.tick(); // still running (fake) -> should NOT record again
    expect(blocked).toEqual(['Terraria.exe']); // recorded once
    expect(killed.length).toBe(2); // but kill attempted each tick while it persists
  });

  it('surfaces currently-blocked apps via status()', async () => {
    service.addTarget({ kind: 'app', value: 'Terraria', label: 'Terraria' }, { type: 'permanent-block' });
    const { guardian } = makeGuardian(['Terraria.exe']);
    await guardian.tick();
    expect(guardian.status()).toEqual([{ name: 'Terraria.exe', reason: 'permanent-block' }]);
  });
});
