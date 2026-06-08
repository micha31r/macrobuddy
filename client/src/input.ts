export type Gesture = 'tap' | 'double' | 'hold' | 'combo';

export interface InputConfig {
  comboWindow: number; // ms to collect more keys into a combo
  doubleTapWindow: number; // ms to wait for a second tap / latch a modifier
  holdThreshold: number; // ms a press becomes a hold
  isModifier: (id: number) => boolean;
  /** Which standalone gestures a key has bound (so single-gesture keys fire instantly). */
  hints: (id: number) => { tap: boolean; double: boolean; hold: boolean };
}

/**
 * Resolves physical key presses into macro actions. Only the *action* is
 * gated by these timers — the caller fires UI feedback (sound, sink, LED)
 * immediately on the raw pointer events, independent of this controller.
 *
 * Pure and timer-driven (setTimeout only, no Date.now) so it unit-tests with
 * fake timers. `send(keys, gesture)` performs the action; `onArmedChange`
 * reports which modifier (if any) is currently engaged, for the UI highlight.
 */
export function createInputController(
  cfg: InputConfig,
  send: (keys: number[], gesture: Gesture) => void,
  onArmedChange: (modifierId: number | null) => void = () => {},
) {
  // engaged modifier
  let engaged: number | null = null;
  let engagedHeld = false; // is the modifier still physically down?
  let comboUsed = false; // did any combo key fire during this engagement?
  let comboKeys = new Set<number>();
  let comboTimer: ReturnType<typeof setTimeout> | undefined;
  let latchTimer: ReturnType<typeof setTimeout> | undefined;

  // modifier double-tap tracking
  let modTapPending: number | null = null;
  let modTapTimer: ReturnType<typeof setTimeout> | undefined;

  // per normal-key pending state
  const holdTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const consumed = new Set<number>(); // keys whose hold already fired
  const tapPending = new Map<number, ReturnType<typeof setTimeout>>();

  const setEngaged = (id: number | null) => {
    engaged = id;
    onArmedChange(id);
  };

  const disengage = () => {
    clearTimeout(comboTimer);
    clearTimeout(latchTimer);
    comboKeys = new Set();
    comboUsed = false;
    engagedHeld = false;
    setEngaged(null);
  };

  const fireCombo = () => {
    clearTimeout(comboTimer);
    if (engaged == null || comboKeys.size === 0) return;
    send([engaged, ...comboKeys], 'combo');
    comboKeys = new Set();
    // keep the modifier engaged if it's still held → a later key starts a new combo
    if (!engagedHeld) disengage();
  };

  return {
    onDown(id: number) {
      if (cfg.isModifier(id)) {
        // second tap of a modifier within the window → its double-tap action
        if (modTapPending === id) {
          clearTimeout(modTapTimer);
          modTapPending = null;
          disengage();
          send([id], 'double');
          return;
        }
        clearTimeout(latchTimer);
        engagedHeld = true;
        setEngaged(id);
        return;
      }

      // normal key while a modifier is engaged → part of a combo
      if (engaged != null) {
        comboKeys.add(id);
        comboUsed = true;
        clearTimeout(latchTimer); // a combo key arrived — cancel the disengage latch
        clearTimeout(comboTimer);
        comboTimer = setTimeout(fireCombo, cfg.comboWindow);
        return;
      }

      // normal key, standalone: arm a hold timer if a hold is bound
      consumed.delete(id);
      if (cfg.hints(id).hold) {
        holdTimers.set(
          id,
          setTimeout(() => {
            holdTimers.delete(id);
            consumed.add(id);
            send([id], 'hold');
          }, cfg.holdThreshold),
        );
      }
    },

    onUp(id: number) {
      if (cfg.isModifier(id)) {
        if (id !== engaged) return;
        engagedHeld = false;
        if (comboKeys.size > 0) {
          // a combo is mid-collection; let the combo timer finish, then disengage
          return;
        }
        if (comboUsed) {
          // the modifier was used for a combo already → just disengage, no latch
          disengage();
          return;
        }
        // a clean modifier tap → latch briefly for a combo, and arm double-tap
        modTapPending = id;
        clearTimeout(modTapTimer);
        modTapTimer = setTimeout(() => {
          modTapPending = null;
        }, cfg.doubleTapWindow);
        clearTimeout(latchTimer);
        latchTimer = setTimeout(disengage, cfg.doubleTapWindow);
        return;
      }

      // normal key that became part of a combo — nothing to do on release
      if (engaged != null && comboKeys.has(id)) return;

      const holdTimer = holdTimers.get(id);
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimers.delete(id);
      }
      if (consumed.has(id)) {
        consumed.delete(id);
        return; // hold already fired
      }

      // tap vs double-tap
      if (cfg.hints(id).double) {
        const pending = tapPending.get(id);
        if (pending) {
          clearTimeout(pending);
          tapPending.delete(id);
          send([id], 'double');
        } else {
          tapPending.set(
            id,
            setTimeout(() => {
              tapPending.delete(id);
              send([id], 'tap');
            }, cfg.doubleTapWindow),
          );
        }
      } else {
        send([id], 'tap'); // single-gesture key → instant
      }
    },
  };
}
