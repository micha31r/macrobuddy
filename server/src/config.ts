import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { PublicConfig } from './types.js';

const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hotkey'),
    keys: z.string().min(1),
  }),
  z.object({
    type: z.literal('script'),
    run: z.enum(['bash', 'pwsh', 'python']),
    path: z.string().min(1),
    args: z.array(z.string()).default([]),
  }),
  // A placeholder that does nothing — for starter templates. The key still
  // sounds + animates; replace `{ type: none }` with a hotkey/script action.
  z.object({
    type: z.literal('none'),
  }),
]);

export const GESTURES = ['tap', 'double', 'hold', 'combo'] as const;
export type Gesture = (typeof GESTURES)[number];

// A key defines a button's presentation + grid position. Real keys carry a
// unique numeric id; spacer keys render as empty space for alignment. A
// `modifier` key roots combos (tap/hold engages it) and can't have tap/hold
// actions of its own.
const KeySchema = z
  .object({
    id: z.number().int().optional(),
    spacer: z.boolean().default(false),
    modifier: z.boolean().default(false),
    label: z.string().optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
    shape: z.enum(['square', 'circle']).default('square'),
    col: z.number().int().min(1),
    row: z.number().int().min(1),
    colSpan: z.number().int().min(1).default(1),
    rowSpan: z.number().int().min(1).default(1),
  })
  .superRefine((key, ctx) => {
    if (!key.spacer && key.id == null) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'a non-spacer key needs a numeric id' });
    }
  });

// A macro binds key ids to an action. One id = a single key with a gesture
// (tap | double | hold); multiple ids = a modifier-rooted combo (held
// together). Later definitions override earlier ones (last-wins).
const MacroSchema = z.object({
  keys: z.array(z.number().int()).min(1),
  on: z.enum(['tap', 'double', 'hold']).optional(),
  action: ActionSchema,
});

const ConfigSchema = z
  .object({
    token: z.string().optional(),
    comboWindow: z.number().int().min(0).default(150),
    doubleTapWindow: z.number().int().min(0).default(250),
    holdThreshold: z.number().int().min(0).default(350),
    layout: z.object({
      cols: z.number().int().min(1),
      rows: z.number().int().min(1),
    }),
    keys: z.array(KeySchema).min(1),
    macros: z.array(MacroSchema).default([]),
  })
  .superRefine((config, ctx) => {
    const ids = new Set<number>();
    const modifiers = new Set<number>();
    config.keys.forEach((key, i) => {
      if (key.id != null) {
        if (ids.has(key.id)) {
          ctx.addIssue({ code: 'custom', path: ['keys', i, 'id'], message: `duplicate key id ${key.id}` });
        }
        ids.add(key.id);
        if (key.modifier) modifiers.add(key.id);
      }
      if (key.col + key.colSpan - 1 > config.layout.cols) {
        ctx.addIssue({
          code: 'custom',
          path: ['keys', i],
          message: `key at col ${key.col} (+span ${key.colSpan}) overflows ${config.layout.cols} cols`,
        });
      }
      if (key.row + key.rowSpan - 1 > config.layout.rows) {
        ctx.addIssue({
          code: 'custom',
          path: ['keys', i],
          message: `key at row ${key.row} (+span ${key.rowSpan}) overflows ${config.layout.rows} rows`,
        });
      }
    });
    config.macros.forEach((macro, i) => {
      const path: (string | number)[] = ['macros', i];
      for (const id of macro.keys) {
        if (!ids.has(id)) {
          ctx.addIssue({ code: 'custom', path: [...path, 'keys'], message: `macro references unknown key id ${id}` });
        }
      }
      if (macro.keys.length === 1) {
        const id = macro.keys[0]!;
        if (modifiers.has(id) && (macro.on ?? 'tap') !== 'double') {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `modifier key ${id} can only have an "on: double" action (tap/hold engage combos)`,
          });
        }
      } else {
        // combo: exactly one modifier root + ≥1 normal key, no gesture
        if (macro.on != null) {
          ctx.addIssue({ code: 'custom', path: [...path, 'on'], message: 'combos cannot set "on"' });
        }
        const mods = macro.keys.filter((id) => modifiers.has(id));
        if (mods.length !== 1) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'keys'],
            message: `a combo needs exactly one modifier key as its root (found ${mods.length})`,
          });
        }
        if (macro.keys.every((id) => modifiers.has(id))) {
          ctx.addIssue({ code: 'custom', path: [...path, 'keys'], message: 'a combo needs at least one non-modifier key' });
        }
      }
    });
  });

export type Config = z.infer<typeof ConfigSchema>;
export type KeyDef = Config['keys'][number];
export type Macro = Config['macros'][number];
export type Action = Macro['action'];
export type ScriptAction = Extract<Action, { type: 'script' }>;

/** Canonical key for a set of key ids — order-independent, dedup-friendly. */
function canonical(ids: number[]): string {
  return [...new Set(ids)].sort((a, b) => a - b).join(',');
}

/** A macro's gesture bucket: single keys use `on` (default tap); sets are combos. */
function macroGesture(macro: Macro): Gesture {
  return macro.keys.length === 1 ? (macro.on ?? 'tap') : 'combo';
}

/**
 * Resolve a (held set, gesture) to its action. Macros are indexed by
 * `canonical|gesture`; iterating in declaration order means a later definition
 * overrides an earlier one (last-wins on conflict).
 */
export function buildMacroIndex(macros: Macro[]): Map<string, Action> {
  const index = new Map<string, Action>();
  for (const macro of macros) index.set(`${canonical(macro.keys)}|${macroGesture(macro)}`, macro.action);
  return index;
}

export function resolveMacro(macros: Macro[], heldIds: number[], gesture: Gesture): Action | undefined {
  return buildMacroIndex(macros).get(`${canonical(heldIds)}|${gesture}`);
}

/** Which gestures a key has bound — sent to the client so it knows when to wait. */
export function gestureHints(macros: Macro[], id: number): { tap: boolean; double: boolean; hold: boolean } {
  const hints = { tap: false, double: false, hold: false };
  for (const macro of macros) {
    if (macro.keys.length === 1 && macro.keys[0] === id) {
      const g = macroGesture(macro);
      if (g === 'tap' || g === 'double' || g === 'hold') hints[g] = true;
    }
  }
  return hints;
}

/** Validate a raw (YAML-parsed) config object. Throws with a readable message. */
export function validateConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) throw new Error(z.prettifyError(result.error));
  return result.data;
}

/** Project the config down to presentation fields only — no macros/actions, no token. */
export function toPublicConfig(config: Config): PublicConfig {
  return {
    layout: config.layout,
    comboWindow: config.comboWindow,
    doubleTapWindow: config.doubleTapWindow,
    holdThreshold: config.holdThreshold,
    keys: config.keys.map(({ id, spacer, modifier, label, icon, color, shape, col, row, colSpan, rowSpan }) => ({
      id,
      spacer,
      modifier,
      // gesture hints (booleans only — no action detail) so the client knows
      // whether a tap must wait to disambiguate from double/hold
      gestures: id != null ? gestureHints(config.macros, id) : { tap: false, double: false, hold: false },
      label,
      icon,
      color,
      shape,
      col,
      row,
      colSpan,
      rowSpan,
    })),
  };
}

/** Holds the live config and hot-reloads it when the YAML file changes. */
export class ConfigStore {
  readonly dir: string;
  private config: Config;
  private runtimeToken?: string;

  private constructor(
    readonly filePath: string,
    config: Config,
  ) {
    this.config = config;
    this.dir = path.dirname(filePath);
  }

  static load(filePath: string): ConfigStore {
    return new ConfigStore(filePath, readConfig(filePath));
  }

  /** Watch the config file and swap in new versions; keep the last good config on error. */
  watch(): void {
    let timer: NodeJS.Timeout | undefined;
    // Watch the directory, not the file: editors often replace the file on
    // save (rename), which would silently kill a direct file watcher.
    fs.watch(this.dir, (_event, filename) => {
      if (filename !== path.basename(this.filePath)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          this.config = readConfig(this.filePath);
          console.log(`[config] reloaded ${this.filePath}`);
        } catch (err) {
          console.error(`[config] reload failed, keeping previous config:\n${(err as Error).message}`);
        }
      }, 150);
    });
  }

  publicConfig(): PublicConfig {
    return toPublicConfig(this.config);
  }

  /** Resolve a (held set, gesture) to its macro action (last-wins). */
  resolve(heldIds: number[], gesture: Gesture): Action | undefined {
    return resolveMacro(this.config.macros, heldIds, gesture);
  }

  /** Set the required auth token at runtime (the key-derived LAN token). */
  setToken(token: string | undefined): void {
    this.runtimeToken = token?.trim() ? token : undefined;
  }

  /**
   * The required auth token. The runtime token (derived from the URL-hash key)
   * takes precedence; otherwise MACROBUDDY_TOKEN env / the config field. Empty =
   * unset (no auth — e.g. in unit tests that never call setToken).
   */
  token(): string | undefined {
    if (this.runtimeToken) return this.runtimeToken;
    const token = process.env.MACROBUDDY_TOKEN ?? this.config.token;
    return token?.trim() ? token : undefined;
  }
}

function readConfig(filePath: string): Config {
  return validateConfig(parse(fs.readFileSync(filePath, 'utf8')));
}
