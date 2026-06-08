// Mirrors the server's public projection (server/src/types.ts).

export type Gesture = 'tap' | 'double' | 'hold' | 'combo';

export interface PublicKey {
  id?: number;
  spacer: boolean;
  modifier: boolean;
  gestures: { tap: boolean; double: boolean; hold: boolean };
  label?: string;
  icon?: string;
  color?: string;
  shape: 'square' | 'circle';
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface PublicConfig {
  layout: { cols: number; rows: number };
  comboWindow: number;
  doubleTapWindow: number;
  holdThreshold: number;
  keys: PublicKey[];
}

export interface ActionResponse {
  ok: boolean;
  error?: string;
}
