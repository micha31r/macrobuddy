/**
 * Hotkey actions.
 *
 * Keystrokes are sent with the prebuilt native binding @nut-tree-fork/libnut-<platform>
 * (nut-js's engine), imported directly: the higher-level nut-js wrapper eagerly drags in
 * jimp and screen-capture machinery we never use, and broke loading in practice.
 *
 * parseCombo() is pure (no native import) so it works — and is unit-tested —
 * on machines where the optional native dependency is not installed.
 * runHotkey() lazily imports the binding the first time a hotkey actually fires.
 */

/** Marks hotkey failures caused by the optional native dependency being unavailable. */
export class HotkeyUnavailableError extends Error {}

export interface ParsedCombo {
  /** libnut native key string to tap. */
  key: string;
  /** libnut native modifier strings to hold. */
  modifiers: string[];
}

// Native key strings verified against @nut-tree-fork/libnut@2.7.5 (its key
// lookup table and the strings compiled into the binding). Note: native
// "return" is the main Enter key; native "enter" is numpad enter.
const KEY_MAP: Record<string, string> = {
  // named keys
  enter: 'return',
  return: 'return',
  tab: 'tab',
  esc: 'escape',
  escape: 'escape',
  space: 'space',
  backspace: 'backspace',
  delete: 'backspace', // what configs almost always mean; see forwarddelete
  forwarddelete: 'delete',
  insert: 'insert',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  // punctuation
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  minus: '-',
  equal: '=',
  leftbracket: '[',
  rightbracket: ']',
  grave: '`',
  backtick: '`',
  // media
  mute: 'audio_mute',
  volumeup: 'audio_vol_up',
  volumedown: 'audio_vol_down',
  playpause: 'audio_play',
  nexttrack: 'audio_next',
  prevtrack: 'audio_prev',
};
for (let c = 97; c <= 122; c++) KEY_MAP[String.fromCharCode(c)] = String.fromCharCode(c); // a-z
for (let d = 0; d <= 9; d++) KEY_MAP[String(d)] = String(d); // top-row digits
for (let f = 1; f <= 24; f++) KEY_MAP[`f${f}`] = `f${f}`;

const MODIFIERS: Record<string, string> = {
  ctrl: 'control',
  control: 'control',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
};
const CMD_ALIASES = new Set(['cmd', 'command', 'win', 'meta', 'super']);

function modifierFor(token: string, platform: NodeJS.Platform): string | undefined {
  // "cmd" maps to ⌘ on macOS and Ctrl elsewhere (spec: cmd→ctrl on Windows).
  if (CMD_ALIASES.has(token)) return platform === 'darwin' ? 'cmd' : 'control';
  return MODIFIERS[token];
}

/**
 * Parse a combo like "cmd+shift+t" into libnut native strings: the last token
 * is the key to tap, all preceding tokens must be modifiers.
 */
export function parseCombo(combo: string, platform: NodeJS.Platform = process.platform): ParsedCombo {
  const tokens = combo
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) throw new Error(`empty hotkey combo "${combo}"`);

  const modifiers = tokens.slice(0, -1).map((token) => {
    const modifier = modifierFor(token, platform);
    if (!modifier) {
      throw new Error(`"${token}" in combo "${combo}" is not a modifier (use cmd, ctrl, shift, alt)`);
    }
    return modifier;
  });

  const last = tokens[tokens.length - 1]!;
  const key = KEY_MAP[last] ?? modifierFor(last, platform);
  if (!key) throw new Error(`unknown key "${last}" in combo "${combo}"`);

  return { key, modifiers };
}

// Minimal view of the native binding — typed by hand because the package is an
// optional dependency that may not be installed (so no static import allowed).
interface LibnutModule {
  keyTap(key: string, modifiers?: string[]): void;
}

let libnutPromise: Promise<LibnutModule | null> | undefined;

function loadLibnut(specifier: string): Promise<LibnutModule | null> {
  libnutPromise ??= import(specifier).then(
    (mod: { default?: LibnutModule } & LibnutModule) => mod.default ?? mod,
    (err: unknown) => {
      console.error(`[hotkey] failed to load ${specifier}: ${err instanceof Error ? err.message : err}`);
      return null;
    },
  );
  return libnutPromise;
}

/** Press a hotkey combo. Throws HotkeyUnavailableError if the binding can't load. */
export async function runHotkey(combo: string): Promise<void> {
  const { key, modifiers } = parseCombo(combo);
  const specifier = `@nut-tree-fork/libnut-${process.platform}`;
  const libnut = await loadLibnut(specifier);
  if (!libnut) {
    throw new HotkeyUnavailableError(
      `hotkey support unavailable: ${specifier} could not load — re-run "npm install" on this ` +
        'machine (a node_modules installed on another OS will not work); on Linux, X11 libraries are required',
    );
  }
  libnut.keyTap(key, modifiers);
}
