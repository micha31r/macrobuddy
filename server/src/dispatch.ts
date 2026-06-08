import { HotkeyUnavailableError, runHotkey } from './actions/hotkey.js';
import { runScript } from './actions/script.js';
import { GESTURES, type Gesture } from './config.js';
import type { ConfigStore } from './config.js';

export interface DispatchResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Transport-agnostic core: given a held set of key ids + the resolved gesture
 * (+ optional token), authorize, resolve the macro, and run its action. Both
 * the LAN/HTTP route and the future relay adapter call this.
 */
export async function dispatch(
  store: ConfigStore,
  heldIds: number[],
  gesture: Gesture,
  token: string | undefined,
): Promise<DispatchResult> {
  const requiredToken = store.token();
  if (requiredToken && token !== requiredToken) {
    return { ok: false, status: 401, error: 'invalid or missing token' };
  }
  if (!Array.isArray(heldIds) || heldIds.length === 0 || heldIds.some((id) => typeof id !== 'number')) {
    return { ok: false, status: 400, error: 'expected a non-empty array of numeric key ids' };
  }
  if (!GESTURES.includes(gesture)) {
    return { ok: false, status: 400, error: `unknown gesture "${gesture}"` };
  }

  const action = store.resolve(heldIds, gesture);
  if (!action) {
    return { ok: false, status: 404, error: `no macro bound to ${gesture} of keys [${heldIds.join(', ')}]` };
  }

  // `none` is a placeholder (starter templates) — succeeds, does nothing.
  if (action.type === 'none') {
    return { ok: true, status: 200 };
  }

  try {
    if (action.type === 'hotkey') {
      await runHotkey(action.keys);
    } else {
      runScript(action, store.dir); // fire-and-forget; exit codes are logged
    }
    return { ok: true, status: 200 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[action:${heldIds.join('+')}] ${message}`);
    return { ok: false, status: err instanceof HotkeyUnavailableError ? 503 : 500, error: message };
  }
}
