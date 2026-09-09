import { describe, it, expect } from 'vitest';
import { BreakNotifier, type ActiveBreakLike } from '../src/breaknotify.js';

/** A notifier wired to a mutable clock and break, recording every notification. */
function harness(thresholdMs = 30_000) {
  const notes: Array<{ title: string; body: string }> = [];
  let active: ActiveBreakLike | null = null;
  let now = 0;
  const notifier = new BreakNotifier({
    getActiveBreak: () => active,
    notify: (title, body) => notes.push({ title, body }),
    thresholdMs,
    now: () => now,
  });
  return {
    notifier,
    notes,
    setNow: (t: number) => (now = t),
    setBreak: (b: ActiveBreakLike | null) => (active = b),
  };
}

describe('BreakNotifier', () => {
  it('does not notify when plenty of time remains', () => {
    const h = harness();
    h.setBreak({ startedAt: 0, endsAt: 1_800_000 }); // 30 min break
    h.setNow(60_000); // 29 min left
    h.notifier.tick();
    expect(h.notes).toHaveLength(0);
  });

  it('notifies once when the remaining time drops to the threshold', () => {
    const h = harness();
    h.setBreak({ startedAt: 0, endsAt: 1_800_000 });
    h.setNow(1_770_001); // just under 30s left
    h.notifier.tick();
    h.setNow(1_775_000); // still under 30s — must NOT notify again
    h.notifier.tick();
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]?.body).toContain('30 seconds');
  });

  it('does not notify after the break has already ended', () => {
    const h = harness();
    h.setBreak({ startedAt: 0, endsAt: 1_800_000 });
    h.setNow(1_800_001); // expired
    h.notifier.tick();
    expect(h.notes).toHaveLength(0);
  });

  it('warns again for a brand-new break', () => {
    const h = harness();
    h.setBreak({ startedAt: 0, endsAt: 1_800_000 });
    h.setNow(1_775_000);
    h.notifier.tick(); // warns for break #1

    h.setBreak(null); // break ends
    h.notifier.tick();

    h.setBreak({ startedAt: 2_000_000, endsAt: 3_800_000 }); // new break, new startedAt
    h.setNow(3_775_000);
    h.notifier.tick(); // warns for break #2
    expect(h.notes).toHaveLength(2);
  });

  it('does not warn twice for the same break even without an intervening gap', () => {
    const h = harness();
    h.setBreak({ startedAt: 500, endsAt: 1_800_000 });
    for (let t = 1_770_001; t < 1_800_000; t += 1_000) {
      h.setNow(t);
      h.notifier.tick();
    }
    expect(h.notes).toHaveLength(1);
  });
});
