import { describe, expect, it } from 'vitest';
import { resolveMacro, toPublicConfig, validateConfig } from '../config.js';

const valid = () => ({
  layout: { cols: 4, rows: 2 },
  keys: [
    { id: 1, col: 1, row: 1 },
    { id: 2, col: 2, row: 1 },
    { id: 4, modifier: true, col: 3, row: 1 },
    { spacer: true, col: 4, row: 1 },
  ],
  macros: [
    { keys: [1], action: { type: 'hotkey', keys: 'cmd+c' } },
    { keys: [1], on: 'double', action: { type: 'hotkey', keys: 'cmd+shift+c' } },
    { keys: [1], on: 'hold', action: { type: 'hotkey', keys: 'cmd+x' } },
    { keys: [4], on: 'double', action: { type: 'hotkey', keys: 'cmd+comma' } },
    { keys: [4, 2], action: { type: 'hotkey', keys: 'cmd+shift+f' } },
  ],
});

describe('validateConfig', () => {
  it('accepts a valid config and applies defaults', () => {
    const config = validateConfig(valid());
    expect(config.comboWindow).toBe(150);
    expect(config.doubleTapWindow).toBe(250);
    expect(config.holdThreshold).toBe(350);
    expect(config.keys[0]).toMatchObject({ shape: 'square', spacer: false, modifier: false });
    expect(config.keys[2]?.modifier).toBe(true);
  });

  it('allows a spacer key without an id', () => {
    expect(() => validateConfig(valid())).not.toThrow();
  });

  it('rejects a non-spacer key without an id', () => {
    const raw = valid() as any;
    delete raw.keys[0].id;
    expect(() => validateConfig(raw)).toThrow(/needs a numeric id/);
  });

  it('rejects duplicate key ids', () => {
    const raw = valid() as any;
    raw.keys[1].id = 1;
    expect(() => validateConfig(raw)).toThrow(/duplicate key id 1/);
  });

  it('rejects a macro referencing an unknown key id', () => {
    const raw = valid() as any;
    raw.macros.push({ keys: [99], action: { type: 'hotkey', keys: 'cmd+x' } });
    expect(() => validateConfig(raw)).toThrow(/unknown key id 99/);
  });

  it('rejects a tap/hold action on a modifier key', () => {
    const raw = valid() as any;
    raw.macros.push({ keys: [4], on: 'tap', action: { type: 'hotkey', keys: 'cmd+z' } });
    expect(() => validateConfig(raw)).toThrow(/can only have an "on: double"/);
  });

  it('rejects a combo with no modifier root', () => {
    const raw = valid() as any;
    raw.macros.push({ keys: [1, 2], action: { type: 'hotkey', keys: 'cmd+z' } });
    expect(() => validateConfig(raw)).toThrow(/exactly one modifier/);
  });

  it('rejects a combo with `on`', () => {
    const raw = valid() as any;
    raw.macros.push({ keys: [4, 2], on: 'tap', action: { type: 'hotkey', keys: 'cmd+z' } });
    expect(() => validateConfig(raw)).toThrow(/combos cannot set "on"/);
  });
});

describe('resolveMacro', () => {
  const macros = () => validateConfig(valid()).macros;

  it('resolves per-gesture single keys', () => {
    expect(resolveMacro(macros(), [1], 'tap')).toEqual({ type: 'hotkey', keys: 'cmd+c' });
    expect(resolveMacro(macros(), [1], 'double')).toEqual({ type: 'hotkey', keys: 'cmd+shift+c' });
    expect(resolveMacro(macros(), [1], 'hold')).toEqual({ type: 'hotkey', keys: 'cmd+x' });
  });

  it('resolves a combo regardless of order', () => {
    expect(resolveMacro(macros(), [4, 2], 'combo')).toEqual({ type: 'hotkey', keys: 'cmd+shift+f' });
    expect(resolveMacro(macros(), [2, 4], 'combo')).toEqual({ type: 'hotkey', keys: 'cmd+shift+f' });
  });

  it('keeps gestures distinct (tap of a combo set is unbound)', () => {
    expect(resolveMacro(macros(), [4, 2], 'tap')).toBeUndefined();
  });

  it('last definition wins per (set, gesture)', () => {
    const raw = valid() as any;
    raw.macros.push({ keys: [1], action: { type: 'hotkey', keys: 'cmd+k' } });
    const config = validateConfig(raw);
    expect(resolveMacro(config.macros, [1], 'tap')).toEqual({ type: 'hotkey', keys: 'cmd+k' });
    // other gestures untouched
    expect(resolveMacro(config.macros, [1], 'double')).toEqual({ type: 'hotkey', keys: 'cmd+shift+c' });
  });
});

describe('toPublicConfig', () => {
  it('exposes presentation + timings + gesture hints but no macros/actions', () => {
    const pub = toPublicConfig(validateConfig(valid()));
    expect(pub.comboWindow).toBe(150);
    expect(pub).not.toHaveProperty('macros');
    expect(pub.keys[0]).toMatchObject({ id: 1, modifier: false, gestures: { tap: true, double: true, hold: true } });
    // modifier's double-tap action is a real binding → reflected in the hint
    expect(pub.keys[2]).toMatchObject({ id: 4, modifier: true, gestures: { tap: false, double: true, hold: false } });
    expect(pub.keys[3]).toMatchObject({ spacer: true });
  });
});
