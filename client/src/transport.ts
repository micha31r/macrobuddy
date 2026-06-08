import {
  decrypt,
  deriveKeys,
  deriveLanToken,
  encrypt,
  fromBase64Url,
  type ControlMessage,
  type ControllerMessage,
  type HostMessage,
  type PublicConfig,
} from '@macrobuddy/shared';
import type { Gesture } from './types';

/**
 * The transport seam. The pad always opens with a key (`#secret` in the URL
 * hash); a keyless URL is the home page and never reaches here. Two transports
 * sit behind one interface, chosen by `resolveEntry`:
 *
 *  - `httpTransport`  — same-origin fetch to the laptop (direct LAN), key-gated
 *    with a token derived from the secret.
 *  - `relayTransport` — an E2E-encrypted WebSocket through the public relay.
 *
 * Neither touches the UI/gesture layer; both only carry the *action* once the
 * UI has already fired, so the zero-delay invariant is unaffected.
 */
export interface Transport {
  fetchConfig(): Promise<PublicConfig>;
  pressKeys(ids: number[], gesture: Gesture): Promise<void>;
}

// Connection signals for the status LED — the same events both transports emit.
function online(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('macrobuddy:online'));
}
function offline(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('macrobuddy:offline'));
}

// ---------------------------------------------------------------------------
// HTTP transport (direct LAN) — carries the key-derived token.
// ---------------------------------------------------------------------------

export function httpTransport(token: string): Transport {
  return {
    async fetchConfig() {
      let res: Response;
      try {
        res = await fetch('/config', { headers: { 'x-mb-token': token } });
      } catch {
        offline();
        throw new Error('server unreachable');
      }
      online();
      if (res.status === 401) throw new Error('wrong key');
      if (!res.ok) throw new Error(`failed to load config (HTTP ${res.status})`);
      return res.json();
    },

    async pressKeys(ids, gesture) {
      let res: Response;
      try {
        res = await fetch('/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-mb-token': token },
          body: JSON.stringify({ keys: ids, gesture, token }),
        });
      } catch {
        offline();
        throw new Error('server unreachable');
      }
      online();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Relay transport (any network) — E2E encrypted over a WebSocket.
// ---------------------------------------------------------------------------

/** Persistent, self-healing relay socket; correlates replies by request id. */
class RelayConnection {
  private ws?: WebSocket;
  private key?: CryptoKey;
  private roomId?: string;
  private readonly keyReady: Promise<void>;
  private openP!: Promise<void>;
  private markOpen!: () => void;
  private readonly pending = new Map<string, { resolve: (m: HostMessage) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    secret: Uint8Array,
    private readonly wsBase: string,
  ) {
    this.keyReady = deriveKeys(secret).then(({ roomId, key }) => {
      this.roomId = roomId;
      this.key = key;
    });
    this.armOpen();
    void this.connect();
  }

  private armOpen(): void {
    this.openP = new Promise<void>((resolve) => (this.markOpen = resolve));
  }

  private async connect(): Promise<void> {
    await this.keyReady;
    const ws = new WebSocket(`${this.wsBase}/room/${this.roomId}?role=controller`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      online();
      this.markOpen();
    };
    ws.onmessage = (ev) => void this.onMessage(ev);
    ws.onclose = () => {
      offline();
      this.armOpen();
      setTimeout(() => void this.connect(), 1000);
    };
    ws.onerror = () => {}; // 'close' follows and drives the reconnect
  }

  private async onMessage(ev: MessageEvent): Promise<void> {
    if (typeof ev.data === 'string') {
      // relay control metadata (peer presence) — plaintext, carries no secret
      try {
        const ctrl = JSON.parse(ev.data) as ControlMessage;
        if (ctrl.t === 'peer') (ctrl.state === 'offline' ? offline : online)();
      } catch {
        /* ignore malformed control frame */
      }
      return;
    }
    try {
      const msg = await decrypt<HostMessage>(this.key!, new Uint8Array(ev.data as ArrayBuffer));
      const waiter = this.pending.get(msg.rid);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.pending.delete(msg.rid);
        waiter.resolve(msg);
      }
    } catch {
      /* undecryptable (wrong key / tampering) — drop it */
    }
  }

  async request(msg: ControllerMessage, timeoutMs = 6000): Promise<HostMessage> {
    await this.keyReady;
    await this.openP;
    const frame = await encrypt(this.key!, msg);
    return new Promise<HostMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.rid);
        offline();
        reject(new Error('relay timed out'));
      }, timeoutMs);
      this.pending.set(msg.rid, { resolve, timer });
      try {
        this.ws!.send(frame);
      } catch {
        clearTimeout(timer);
        this.pending.delete(msg.rid);
        reject(new Error('relay send failed'));
      }
    });
  }
}

let ridSeq = 0;
const nextRid = (): string => `r${++ridSeq}`;

export function relayTransport(secret: Uint8Array, wsBase: string, token: string): Transport {
  const conn = new RelayConnection(secret, wsBase);
  return {
    async fetchConfig() {
      const reply = await conn.request({ t: 'getConfig', rid: nextRid() });
      if (reply.t !== 'config') throw new Error('unexpected relay reply');
      return reply.config;
    },
    async pressKeys(ids, gesture) {
      const reply = await conn.request({ t: 'action', rid: nextRid(), keys: ids, gesture, token });
      if (reply.t === 'result' && !reply.ok) throw new Error(reply.error ?? 'action failed');
    },
  };
}

// ---------------------------------------------------------------------------
// Entry — pick the transport for a keyed URL (a one-shot /config probe).
// ---------------------------------------------------------------------------

/** Parse the 256-bit secret from a URL hash (`#<base64url>`); null if absent. */
export function parseHashSecret(hash: string): Uint8Array | null {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) return null;
  try {
    return fromBase64Url(raw);
  } catch {
    return null;
  }
}

function relayWsBase(): string {
  const override = (import.meta.env as Record<string, string | undefined>).VITE_RELAY_URL;
  if (override) return override.replace(/\/$/, '');
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

export type TransportKind = 'http' | 'relay';

let active: Transport | null = null;

/**
 * Resolve the keyed entry point. Derives the LAN token, probes same-origin
 * `/config` with it, and decides:
 *  - `401`           → wrong key,
 *  - `{relay:true}`  → it's the relay Worker → relay (WebSocket),
 *  - a real config   → it's the Node host (direct LAN) → HTTP.
 * Caches the active transport for `pressKeys` and returns the config.
 */
export async function resolveEntry(
  secret: Uint8Array,
): Promise<{ transport: Transport; config: PublicConfig; kind: TransportKind }> {
  const token = deriveLanToken(secret);
  let res: Response;
  try {
    res = await fetch('/config', { headers: { 'x-mb-token': token } });
  } catch {
    offline();
    throw new Error('server unreachable');
  }
  online();
  if (res.status === 401) throw new Error('wrong key');
  if (!res.ok) throw new Error(`failed to load config (HTTP ${res.status})`);
  const data = (await res.json()) as PublicConfig | { relay?: boolean };

  if ((data as { relay?: boolean }).relay === true) {
    const transport = relayTransport(secret, relayWsBase(), token);
    const config = await transport.fetchConfig();
    active = transport;
    return { transport, config, kind: 'relay' };
  }

  active = httpTransport(token);
  return { transport: active, config: data as PublicConfig, kind: 'http' };
}

/** The transport resolved by `resolveEntry` (used by `pressKeys`). */
export function activeTransport(): Transport {
  if (!active) throw new Error('no active transport — call resolveEntry first');
  return active;
}
