import { useEffect, useRef } from 'react';

const SIZE = 64; // tiny buffer — CSS upscales and blurs it, drawing stays cheap
const POINTS = 96;

interface Pt {
  x: number;
  y: number;
}

/** Uniformly sample the perimeter of a rounded rectangle. */
function roundedRectPerimeter(cx: number, cy: number, w: number, h: number, r: number, count: number): Pt[] {
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const x1 = cx + w / 2;
  const y1 = cy + h / 2;
  const sw = w - 2 * r; // straight widths
  const sh = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const total = 2 * sw + 2 * sh + 4 * arc;
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    let d = (i / count) * total;
    if (d < sw) {
      pts.push({ x: x0 + r + d, y: y0 }); // top, L→R
      continue;
    }
    d -= sw;
    if (d < arc) {
      const a = -Math.PI / 2 + d / r;
      pts.push({ x: x1 - r + Math.cos(a) * r, y: y0 + r + Math.sin(a) * r }); // top-right corner
      continue;
    }
    d -= arc;
    if (d < sh) {
      pts.push({ x: x1, y: y0 + r + d }); // right, T→B
      continue;
    }
    d -= sh;
    if (d < arc) {
      const a = d / r;
      pts.push({ x: x1 - r + Math.cos(a) * r, y: y1 - r + Math.sin(a) * r }); // bottom-right corner
      continue;
    }
    d -= arc;
    if (d < sw) {
      pts.push({ x: x1 - r - d, y: y1 }); // bottom, R→L
      continue;
    }
    d -= sw;
    if (d < arc) {
      const a = Math.PI / 2 + d / r;
      pts.push({ x: x0 + r + Math.cos(a) * r, y: y1 - r + Math.sin(a) * r }); // bottom-left corner
      continue;
    }
    d -= arc;
    if (d < sh) {
      pts.push({ x: x0, y: y1 - r - d }); // left, B→T
      continue;
    }
    d -= sh;
    const a = Math.PI + d / r;
    pts.push({ x: x0 + r + Math.cos(a) * r, y: y0 + r + Math.sin(a) * r }); // top-left corner
  }
  return pts;
}

/**
 * RGB underglow as an actual LED strip: a stroked band hugging the case
 * outline (the canvas spans 200% of the case, so the case edge is the
 * centered half-size rect). Colors flow *along* the strip with wavy,
 * per-session-random motion; the CSS blur turns it into bleeding light.
 */
export default function Glow() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = SIZE;
    canvas.height = SIZE;

    // case outline in canvas coords; corner radius matches the case's 8% of
    // --pad-w (case = 1.15·pad → r ≈ 0.07·case ≈ 0.035·canvas)
    const strip = roundedRectPerimeter(SIZE / 2, SIZE / 2, SIZE * 0.5, SIZE * 0.5, SIZE * 0.035, POINTS);

    // Randomized per mount: every session flows differently.
    const rnd = {
      hueBase: Math.random() * 360,
      hueSpeed: (8 + Math.random() * 12) * (Math.random() < 0.5 ? -1 : 1), // deg/s along the strip
      waveFreq: 2 + Math.floor(Math.random() * 3), // spatial waves (integer → seamless wrap)
      waveSpeed: 0.4 + Math.random() * 0.7,
      breathe: 0.25 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = SIZE * 0.055;
      ctx.lineCap = 'round';
      for (let i = 0; i < POINTS; i++) {
        const s = i / POINTS; // 0..1 along the strip
        const p = strip[i]!;
        const q = strip[(i + 1) % POINTS]!;
        // gentle radial breathing so the band never looks rigid
        const wob =
          1 +
          Math.sin(s * Math.PI * 2 * rnd.waveFreq + t * rnd.waveSpeed + rnd.phase) * 0.05 +
          Math.sin(s * Math.PI * 2 * 5 - t * rnd.breathe) * 0.025;
        const px = (p.x - SIZE / 2) * wob + SIZE / 2;
        const py = (p.y - SIZE / 2) * wob + SIZE / 2;
        const qx = (q.x - SIZE / 2) * wob + SIZE / 2;
        const qy = (q.y - SIZE / 2) * wob + SIZE / 2;
        // hue flows along the strip and drifts over time, with a wavy ripple
        const hue =
          rnd.hueBase + s * 360 + t * rnd.hueSpeed + Math.sin(s * Math.PI * 2 * rnd.waveFreq - t * rnd.waveSpeed * 1.7) * 35;
        ctx.strokeStyle = `hsla(${((hue % 360) + 360) % 360}, 100%, 60%, 0.85)`;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(qx, qy);
        ctx.stroke();
      }
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(0);
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      draw((now - t0) / 1000);
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="glow" aria-hidden />;
}
