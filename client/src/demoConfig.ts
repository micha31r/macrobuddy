import type { PublicConfig, PublicKey } from './types';

// A representative pad for the home-page demo. It never talks to a host — the
// demo Pad runs with a no-op send — so the gestures are all simple taps; the
// point is to feel the keys (sound + press), not to do anything.
const base = {
  spacer: false,
  modifier: false,
  gestures: { tap: true, double: false, hold: false },
  shape: 'square' as const,
  colSpan: 1,
  rowSpan: 1,
};

function k(p: Partial<PublicKey> & { id: number; col: number; row: number }): PublicKey {
  return { ...base, ...p };
}

export const demoConfig: PublicConfig = {
  layout: { cols: 4, rows: 4 },
  comboWindow: 150,
  doubleTapWindow: 250,
  holdThreshold: 350,
  keys: [
    k({ id: 1, col: 1, row: 1, icon: 'clipboard', color: '#3273f5' }),
    k({ id: 2, col: 2, row: 1, icon: 'scissors' }),
    k({ id: 3, col: 3, row: 1, icon: 'magnifying-glass' }),
    k({ id: 4, col: 4, row: 1, icon: 'cog-6-tooth', modifier: true }),
    k({ id: 5, col: 1, row: 2, icon: 'play', color: '#2fb344' }),
    k({ id: 6, col: 2, row: 2, icon: 'pause' }),
    k({ id: 7, col: 3, row: 2, icon: 'rocket-launch', color: '#8b5cf6' }),
    k({ id: 8, col: 4, row: 2, icon: 'bolt', color: '#f5a623' }),
    k({ id: 9, col: 1, row: 3, icon: 'command-line' }),
    k({ id: 10, col: 2, row: 3, icon: 'code-bracket' }),
    k({ id: 11, col: 3, row: 3, icon: 'beaker' }),
    { ...base, spacer: true, col: 4, row: 3 } as PublicKey,
    k({ id: 13, col: 1, row: 4, icon: 'arrow-uturn-left' }),
    k({ id: 14, col: 2, row: 4, icon: 'arrow-uturn-right' }),
    k({ id: 15, col: 3, row: 4, icon: 'speaker-wave' }),
    k({ id: 16, col: 4, row: 4, icon: 'heart', color: '#e5484d', shape: 'circle' }),
  ],
};
