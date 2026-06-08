import type { Gesture } from './types';
import { activeTransport } from './transport';

// `api` is the stable surface the UI calls. The pad always opens with a key;
// `resolveEntry` (re-exported) probes once to pick the transport (direct LAN
// HTTP vs. E2E relay), then `pressKeys` rides the resolved one.
export { parseHashSecret, resolveEntry } from './transport';

/** Fire the macro bound to the held set of key ids + the resolved gesture. */
export function pressKeys(ids: number[], gesture: Gesture): Promise<void> {
  return activeTransport().pressKeys(ids, gesture);
}
