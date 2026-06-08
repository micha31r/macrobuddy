import downUrl from './assets/key-down.wav';
import upUrl from './assets/key-up.wav';

/**
 * Key click sounds via Web Audio: the source recording held both a key-down
 * and a key-up transient, split into two clips so holding a key clicks once
 * and releasing clicks again. One decoded buffer per clip, a fresh
 * BufferSource per play — overlapping plays work no matter how fast the user
 * taps.
 *
 * The AudioContext is created eagerly (suspended) and resumed inside the
 * press handler (a user gesture), which satisfies mobile autoplay policies.
 */

type AudioContextCtor = typeof AudioContext;

interface Clip {
  buffer: AudioBuffer;
  offset: number; // seconds of leading silence to skip
}

let ctx: AudioContext | null = null;
const clips: Partial<Record<'down' | 'up', Clip>> = {};

function audioContext(): AudioContext | null {
  if (!ctx) {
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ?? (window as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** First point where the sample amplitude exceeds the threshold. */
function leadingSilence(decoded: AudioBuffer, threshold = 0.02): number {
  const samples = decoded.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i] ?? 0) > threshold) return i / decoded.sampleRate;
  }
  return 0;
}

async function load(context: AudioContext, kind: 'down' | 'up', url: string): Promise<void> {
  try {
    const res = await fetch(url);
    const decoded = await context.decodeAudioData(await res.arrayBuffer());
    clips[kind] = { buffer: decoded, offset: leadingSilence(decoded) };
  } catch (err) {
    console.warn(`[sound] failed to load key ${kind} clip:`, err);
  }
}

// On iOS, Web Audio is muted by the ringer/silent switch unless the page opts
// into the "playback" audio session (Audio Session API, iOS 17+).
try {
  const session = (navigator as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
} catch {
  /* best effort */
}

// Eagerly create the (suspended) context and decode both clips at module
// load, so the very first key press only has to resume() and play.
{
  const context = audioContext();
  if (context) {
    void load(context, 'down', downUrl);
    void load(context, 'up', upUrl);
  }
}

function play(kind: 'down' | 'up'): void {
  const context = audioContext();
  if (!context) return;
  if (context.state === 'suspended') void context.resume();
  const clip = clips[kind];
  if (!clip) return;
  const source = context.createBufferSource();
  source.buffer = clip.buffer;
  source.connect(context.destination);
  source.start(0, clip.offset);
}

/** Key-down click. Call from a user gesture (it is: pointerdown). */
export function playDown(): void {
  play('down');
}

/** Key-up click. */
export function playUp(): void {
  play('up');
}
