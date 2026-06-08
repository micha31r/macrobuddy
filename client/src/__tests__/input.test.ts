import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInputController, type Gesture } from '../input';

// Test rig: keys 1 (tap only), 2 (tap+double), 3 (tap+hold), 9 (all three),
// 4 (modifier). Combo window 150, doubleTap 250, hold 350.
const HINTS: Record<number, { tap: boolean; double: boolean; hold: boolean }> = {
  1: { tap: true, double: false, hold: false },
  2: { tap: true, double: true, hold: false },
  3: { tap: true, double: false, hold: true },
  9: { tap: true, double: true, hold: true },
  4: { tap: false, double: false, hold: false },
};

function make() {
  const sent: Array<{ keys: number[]; gesture: Gesture }> = [];
  const armed: Array<number | null> = [];
  const c = createInputController(
    {
      comboWindow: 150,
      doubleTapWindow: 250,
      holdThreshold: 350,
      isModifier: (id) => id === 4,
      hints: (id) => HINTS[id] ?? { tap: true, double: false, hold: false },
    },
    (keys, gesture) => sent.push({ keys: [...keys].sort((a, b) => a - b), gesture }),
    (m) => armed.push(m),
  );
  return { c, sent, armed };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('single keys', () => {
  it('fires a single-gesture tap instantly on release', () => {
    const { c, sent } = make();
    c.onDown(1);
    c.onUp(1);
    expect(sent).toEqual([{ keys: [1], gesture: 'tap' }]);
  });

  it('waits to disambiguate tap vs double on a tap+double key', () => {
    const { c, sent } = make();
    c.onDown(2);
    c.onUp(2);
    expect(sent).toHaveLength(0); // pending
    vi.advanceTimersByTime(250);
    expect(sent).toEqual([{ keys: [2], gesture: 'tap' }]);
  });

  it('fires double on a fast second tap', () => {
    const { c, sent } = make();
    c.onDown(2);
    c.onUp(2);
    vi.advanceTimersByTime(100);
    c.onDown(2);
    c.onUp(2);
    expect(sent).toEqual([{ keys: [2], gesture: 'double' }]);
  });

  it('fires hold when held past the threshold', () => {
    const { c, sent } = make();
    c.onDown(3);
    vi.advanceTimersByTime(350);
    expect(sent).toEqual([{ keys: [3], gesture: 'hold' }]);
    c.onUp(3); // release after a hold → no extra fire
    vi.advanceTimersByTime(300);
    expect(sent).toEqual([{ keys: [3], gesture: 'hold' }]);
  });

  it('fires tap (not hold) when released before the threshold', () => {
    const { c, sent } = make();
    c.onDown(9);
    vi.advanceTimersByTime(100);
    c.onUp(9);
    vi.advanceTimersByTime(250); // also clears the double window
    expect(sent).toEqual([{ keys: [9], gesture: 'tap' }]);
  });
});

describe('modifier + combos', () => {
  it('hold modifier + press a key → combo after the window', () => {
    const { c, sent, armed } = make();
    c.onDown(4); // engage (held)
    expect(armed.at(-1)).toBe(4);
    c.onDown(2); // combo member — its own tap/double suppressed
    c.onUp(2);
    expect(sent).toHaveLength(0); // waiting for combo window
    vi.advanceTimersByTime(150);
    expect(sent).toEqual([{ keys: [2, 4], gesture: 'combo' }]);
    c.onUp(4);
    expect(armed.at(-1)).toBe(null);
  });

  it('collects multiple keys into one combo', () => {
    const { c, sent } = make();
    c.onDown(4);
    c.onDown(1);
    vi.advanceTimersByTime(80);
    c.onDown(3); // joins within the window
    vi.advanceTimersByTime(150);
    expect(sent).toEqual([{ keys: [1, 3, 4], gesture: 'combo' }]);
  });

  it('tap modifier then press a key → latched combo', () => {
    const { c, sent } = make();
    c.onDown(4);
    c.onUp(4); // tap → latched, armed for doubleTapWindow
    c.onDown(1); // within latch → combo
    vi.advanceTimersByTime(150);
    expect(sent).toEqual([{ keys: [1, 4], gesture: 'combo' }]);
  });

  it('double-tapping a modifier fires its own action', () => {
    const { c, sent } = make();
    c.onDown(4);
    c.onUp(4);
    vi.advanceTimersByTime(100);
    c.onDown(4); // second tap within window → double
    expect(sent).toEqual([{ keys: [4], gesture: 'double' }]);
  });

  it('a lone modifier tap does nothing once the latch expires', () => {
    const { c, sent } = make();
    c.onDown(4);
    c.onUp(4);
    vi.advanceTimersByTime(300); // past the latch/double window
    expect(sent).toHaveLength(0);
  });
});
