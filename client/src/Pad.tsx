import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { pressKeys } from './api';
import Glow from './Glow';
import { createInputController } from './input';
import Key from './Key';
import type { PublicConfig } from './types';
import type { SizeMode } from './App';
import { onViewportChange, safeAreaInsets } from './viewport';

/** Grid width in "fixed" size mode — a natural desktop size; browser zoom scales it. */
const FIXED_WIDTH = 520;
/** The home-page demo pad is capped small so it sits inside the content column. */
const DEMO_WIDTH = 340;

interface PadLayout {
  width: number;
  marginTop: string;
}

/**
 * Pad size + vertical placement. The app sizes against the visual viewport in
 * JS (CSS dvh/vw formulas go stale on iOS orientation changes); the nav is a
 * fixed overlay reserving ZERO height, so the pad centers in the *full* visible
 * viewport. The home-page **demo** instead sizes to its container width (capped)
 * and sits inline in the scrolling column.
 */
function usePadLayout(
  cols: number,
  rows: number,
  sizeMode: SizeMode,
  demo: boolean,
  boxRef: RefObject<HTMLDivElement | null>,
): PadLayout {
  const compute = useCallback((): PadLayout => {
    if (demo) {
      const avail = boxRef.current?.clientWidth ?? DEMO_WIDTH;
      return { width: Math.floor(Math.max(120, Math.min(avail, DEMO_WIDTH))), marginTop: '0px' };
    }
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vhRaw = window.visualViewport?.height ?? window.innerHeight;
    // Keep the pad out of the camera cutout / home indicator in standalone (the
    // safe-area insets are 0 on devices without them → unchanged there).
    const { top, bottom } = safeAreaInsets();
    const vh = vhRaw - top - bottom;
    const byWidth = vw * 0.825; // case ≈ 95vw → ~2.5vw margin per side
    // height budget uses the (safe) viewport (nav reserves no space); 24 = a
    // small symmetric gap. case layout footprint = grid + 15% bezel + 2.7% edge
    const heightFactor = rows / cols + 0.177;
    const byHeight = (vh - 24) / heightFactor;
    const fit = Math.min(byWidth, byHeight);
    const capped = sizeMode === 'fixed' && FIXED_WIDTH < fit;
    const width = Math.floor(Math.max(120, capped ? FIXED_WIDTH : fit));

    // center the visual case (rect 15% bezel + 1.5% painted edge) in the safe vh
    // (offset by the top inset) → landscape fills the height; portrait centers
    const centered = top + Math.max(0, Math.round((vh - width * (rows / cols + 0.165)) / 2));
    return { width, marginTop: `${centered}px` };
  }, [cols, rows, sizeMode, demo, boxRef]);

  const [layout, setLayout] = useState(compute);
  useEffect(() => {
    if (demo) {
      const update = () => setLayout(compute());
      update(); // measure the container now that it's mounted
      const el = boxRef.current;
      const ro = el && 'ResizeObserver' in window ? new ResizeObserver(update) : undefined;
      ro?.observe(el!);
      window.addEventListener('resize', update);
      return () => {
        ro?.disconnect();
        window.removeEventListener('resize', update);
      };
    }
    return onViewportChange(() => setLayout(compute()));
  }, [compute, demo, boxRef]);
  return layout;
}

/**
 * Indicator LEDs: connection status (green = backend reachable, red = not)
 * and activity (flashes on any key press). In demo mode there is no backend,
 * so it skips the heartbeat and stays "connected".
 */
function Leds({ demo = false, relay = false }: { demo?: boolean; relay?: boolean }) {
  const [connected, setConnected] = useState(true);
  const [active, setActive] = useState(false);
  const held = useRef(0); // multi-touch: how many keys are currently down
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // The LED stays lit while any key is held; a quick tap still shows a
    // ~150ms minimum blink.
    const press = () => {
      held.current += 1;
      setActive(true);
      window.clearTimeout(timer.current);
    };
    const release = () => {
      held.current = Math.max(0, held.current - 1);
      if (held.current === 0) {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setActive(false), 150);
      }
    };
    window.addEventListener('macrobuddy:press', press);
    window.addEventListener('macrobuddy:release', release);

    if (demo) {
      return () => {
        window.removeEventListener('macrobuddy:press', press);
        window.removeEventListener('macrobuddy:release', release);
        window.clearTimeout(timer.current);
      };
    }

    const online = () => setConnected(true);
    const offline = () => setConnected(false);
    window.addEventListener('macrobuddy:online', online);
    window.addEventListener('macrobuddy:offline', offline);

    // Background heartbeat (only while the page is visible) — direct LAN only.
    // In relay mode the WebSocket open/close + peer events drive the LED, so a
    // /config ping (which only proves the *relay* is up) would mask a down host.
    const ping = async () => {
      if (document.hidden) return;
      try {
        await fetch('/config', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(3000) });
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    const heartbeat = relay ? undefined : window.setInterval(() => void ping(), 5000);

    return () => {
      window.removeEventListener('macrobuddy:press', press);
      window.removeEventListener('macrobuddy:release', release);
      window.removeEventListener('macrobuddy:online', online);
      window.removeEventListener('macrobuddy:offline', offline);
      window.clearTimeout(timer.current);
      if (heartbeat) window.clearInterval(heartbeat);
    };
  }, [demo, relay]);

  return (
    <div className="leds" aria-hidden>
      <span className={`led led--status${connected ? '' : ' led--down'}`} />
      <span className={`led led--activity${active ? ' led--on' : ''}`} />
    </div>
  );
}

/**
 * Wires the input controller to the keys. Raw pointer events dispatch the
 * (instant) activity-LED events and feed the controller, which resolves
 * tap/double/hold/combo and fires the (delayed) action. In demo mode the
 * action `send` is a no-op — presses still sound + animate, but nothing leaves
 * the page. `armed` is the modifier currently engaged, for the key highlight.
 */
function useInput(config: PublicConfig, demo: boolean) {
  const [armed, setArmed] = useState<number | null>(null);

  const controller = useMemo(() => {
    const modifiers = new Set<number>();
    const hintMap = new Map<number, { tap: boolean; double: boolean; hold: boolean }>();
    for (const key of config.keys) {
      if (key.id == null) continue;
      if (key.modifier) modifiers.add(key.id);
      hintMap.set(key.id, key.gestures);
    }
    const send = demo ? () => {} : (keys: number[], gesture: Parameters<typeof pressKeys>[1]) =>
      void pressKeys(keys, gesture).catch(() => {});
    return createInputController(
      {
        comboWindow: config.comboWindow,
        doubleTapWindow: config.doubleTapWindow,
        holdThreshold: config.holdThreshold,
        isModifier: (id) => modifiers.has(id),
        hints: (id) => hintMap.get(id) ?? { tap: true, double: false, hold: false },
      },
      send,
      setArmed,
    );
  }, [config, demo]);

  return {
    armed,
    onDown: (id: number) => {
      window.dispatchEvent(new Event('macrobuddy:press')); // activity LED, instant
      controller.onDown(id);
    },
    onUp: (id: number) => {
      window.dispatchEvent(new Event('macrobuddy:release'));
      controller.onUp(id);
    },
  };
}

interface PadProps {
  config: PublicConfig;
  glow: boolean;
  sizeMode: SizeMode;
  /** Home-page demo: container-sized, presses sound + animate but go nowhere. */
  demo?: boolean;
  /** Relay transport in use → the LED follows the WebSocket, not a /config ping. */
  relay?: boolean;
}

/**
 * The pad keeps a fixed grid shape and scales to fit — keys shrink/grow
 * uniformly, the layout never reflows. All pad geometry (radii, edges, gaps,
 * label size, decorations) derives from --pad-w in CSS, so a 27" monitor
 * renders the same proportions as a phone, just bigger.
 */
export default function Pad({ config, glow, sizeMode, demo = false, relay = false }: PadProps) {
  const { cols, rows } = config.layout;
  const boxRef = useRef<HTMLDivElement>(null);
  const { width, marginTop } = usePadLayout(cols, rows, sizeMode, demo, boxRef);
  const input = useInput(config, demo);
  const caseStyle = { '--pad-w': `${width}px`, marginTop } as CSSProperties;

  // Explicit pixel tracks (not 1fr): iOS Safari doesn't recompute fr track
  // sizes when the grid is relaid out on rotation, leaving keys squished.
  const gap = Math.round(width * 0.04);
  const gridHeight = Math.round((width * rows) / cols);
  const colTrack = (width - (cols - 1) * gap) / cols;
  const rowTrack = (gridHeight - (rows - 1) * gap) / rows;
  const caseEl = (
    <div className="case" style={caseStyle}>
      {/* RGB underglow — an LED strip wrapped around the back of the case */}
      {glow && <Glow />}
      {/* decorative "silkscreen", like the hardware unit */}
      <span className="deco deco--top" aria-hidden>
        <svg viewBox="0 0 10 10">
          <polygon points="5,1 9.3,9 0.7,9" />
        </svg>
        <svg viewBox="0 0 10 10">
          <rect x="1.2" y="1.2" width="7.6" height="7.6" />
        </svg>
        <svg viewBox="0 0 10 10">
          <polygon points="5,0.6 6.32,3.44 9.4,3.8 7.12,5.92 7.74,8.98 5,7.44 2.26,8.98 2.88,5.92 0.6,3.8 3.68,3.44" />
        </svg>
      </span>
      <span className="deco deco--left" aria-hidden>
        MacroBuddy © 2026
      </span>
      <span className="deco deco--right" aria-hidden>
        Tap responsibly
      </span>
      <span className="deco deco--bottom" aria-hidden>
        Just push it
      </span>
      <span className="screw screw--tl" aria-hidden />
      <span className="screw screw--tr" aria-hidden />
      <span className="screw screw--bl" aria-hidden />
      <span className="screw screw--br" aria-hidden />
      <Leds demo={demo} relay={relay} />
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${colTrack}px)`,
          gridTemplateRows: `repeat(${rows}, ${rowTrack}px)`,
          gap: `${gap}px`,
          width: 'var(--pad-w)',
          height: `${gridHeight}px`,
        }}
      >
        {config.keys.map((key, i) => (
          <Key
            key={key.id ?? `spacer-${i}`}
            def={key}
            armed={key.id != null && key.id === input.armed}
            onDown={input.onDown}
            onUp={input.onUp}
          />
        ))}
      </div>
    </div>
  );

  // Demo lives inline in the home column; wrap it so we can measure the width.
  if (demo) {
    return (
      <div className="pad-demo" ref={boxRef}>
        {caseEl}
      </div>
    );
  }
  return caseEl;
}
