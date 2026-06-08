import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { resolveIcon } from './icons';
import { playDown, playUp } from './sound';
import type { PublicKey } from './types';

const MIN_VISUAL_PRESS_MS = 90; // even the fastest tap shows a full dip

function placement(def: PublicKey): CSSProperties {
  return {
    gridColumn: `${def.col} / span ${def.colSpan}`,
    gridRow: `${def.row} / span ${def.rowSpan}`,
  };
}

/**
 * A key is a static darker "edge" slab with the face button on top. The
 * tactile feedback (sink, down/up click, LED) fires INSTANTLY on the pointer
 * events — zero delay. Action resolution (tap/double/hold/combo) is the
 * controller's job; this only reports raw onDown(id)/onUp(id).
 */
export default function Key({
  def,
  armed,
  onDown,
  onUp,
}: {
  def: PublicKey;
  armed: boolean;
  onDown: (id: number) => void;
  onUp: (id: number) => void;
}) {
  const [pressed, setPressed] = useState(false);
  const isDown = useRef(false);
  const pressedAt = useRef(0);
  const releaseTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(releaseTimer.current), []);

  // Spacer: empty grid cell for alignment — no button, edge, sound or LED.
  if (def.spacer || def.id == null) {
    return <div className="keycell keycell--spacer" style={placement(def)} aria-hidden />;
  }
  const id = def.id;

  const Icon = def.icon ? resolveIcon(def.icon) : undefined;

  const cellStyle = placement(def);
  if (def.color) {
    Object.assign(cellStyle, {
      '--key-color': def.color,
      '--key-color-edge': `color-mix(in srgb, ${def.color} 72%, black)`,
    } as CSSProperties);
  }

  const release = () => {
    if (!isDown.current) return;
    isDown.current = false;
    playUp();
    onUp(id);
    const remaining = MIN_VISUAL_PRESS_MS - (performance.now() - pressedAt.current);
    window.clearTimeout(releaseTimer.current);
    if (remaining > 0) {
      releaseTimer.current = window.setTimeout(() => setPressed(false), remaining);
    } else {
      setPressed(false);
    }
  };

  const cellClasses = ['keycell'];
  if (def.shape === 'circle') cellClasses.push('keycell--circle');
  const faceClasses = ['key'];
  if (def.modifier) faceClasses.push('key--modifier');
  if (armed) faceClasses.push('key--armed');
  if (pressed) faceClasses.push('key--pressed');

  return (
    <div className={cellClasses.join(' ')} style={cellStyle}>
      <span className="key__edge" aria-hidden />
      <button
        type="button"
        className={faceClasses.join(' ')}
        style={def.color ? { color: '#fff' } : undefined}
        aria-label={def.label ?? `key ${id}`}
        onPointerDown={() => {
          window.clearTimeout(releaseTimer.current);
          isDown.current = true;
          pressedAt.current = performance.now();
          setPressed(true);
          playDown();
          onDown(id);
        }}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
      >
        {Icon && <Icon className="key__icon" aria-hidden />}
        {def.label && <span className="key__label">{def.label}</span>}
        {def.modifier && <span className="key__mod-dot" aria-hidden />}
      </button>
    </div>
  );
}
