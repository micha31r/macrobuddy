export type Gesture = 'tap' | 'double' | 'hold' | 'combo';

/** Presentation-only view of a key — safe to send to the client. */
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

/** POST /action request body — the held key ids + the resolved gesture. */
export interface ActionRequest {
  keys: number[];
  gesture: Gesture;
  token?: string;
}

/** POST /action response body. */
export interface ActionResponse {
  ok: boolean;
  error?: string;
}
