import WebSocket, { type RawData } from 'ws';
import {
  decrypt,
  deriveKeys,
  encrypt,
  randomSecret,
  type ControllerMessage,
  type HostMessage,
} from '@macrobuddy/shared';
import type { ConfigStore } from './config.js';
import { dispatch } from './dispatch.js';

/**
 * Turn one decrypted controller message into the host's reply. Pure w.r.t.
 * transport: an `action` goes through the same `dispatch()` seam the LAN HTTP
 * route uses, so authorize→resolve→execute is identical on both paths — no
 * logic duplication, and `toPublicConfig` is still the only thing exposed.
 */
export async function handleControllerMessage(store: ConfigStore, msg: ControllerMessage): Promise<HostMessage> {
  if (msg.t === 'getConfig') {
    return { t: 'config', rid: msg.rid, config: store.publicConfig() };
  }
  const result = await dispatch(store, msg.keys, msg.gesture, msg.token);
  return { t: 'result', rid: msg.rid, ok: result.ok, error: result.error };
}

export interface RelayOptions {
  /** Relay WebSocket base, e.g. `wss://macrobuddy.example.workers.dev`. */
  relayWsUrl: string;
  /** Fixed root secret (tests). Default: a fresh 256-bit secret per start. */
  secret?: Uint8Array;
}

export interface RelayHandle {
  /** The root secret — encode into the QR's URL hash; never sent to the relay. */
  secret: Uint8Array;
  /** Public routing id the relay sees. */
  roomId: string;
  /** Resolves on the first successful connection. */
  ready: Promise<void>;
  close(): void;
}

/**
 * Run the laptop as a relay *client*: connect out to the relay (no inbound
 * port), join our room as the `host`, and answer encrypted controller messages.
 * Reconnects with backoff so a dropped relay link self-heals.
 */
export async function startRelayClient(store: ConfigStore, opts: RelayOptions): Promise<RelayHandle> {
  const secret = opts.secret ?? randomSecret();
  const { roomId, key } = await deriveKeys(secret);
  const url = `${opts.relayWsUrl.replace(/\/$/, '')}/room/${roomId}?role=host`;

  let ws: WebSocket | undefined;
  let closed = false;
  let backoff = 500;
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => (markReady = resolve));

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(url);

    ws.on('open', () => {
      backoff = 500;
      markReady();
      console.log(`[relay] connected — room ${roomId.slice(0, 8)}… ready for your phone`);
    });

    ws.on('message', async (data: RawData, isBinary: boolean) => {
      if (!isBinary) return; // text frames are relay control metadata; ignore
      try {
        const msg = await decrypt<ControllerMessage>(key, toBytes(data));
        const reply = await handleControllerMessage(store, msg);
        ws?.send(await encrypt(key, reply));
      } catch (err) {
        // wrong key / tampered / malformed → drop it; the host never crashes
        console.error(`[relay] dropped a frame: ${(err as Error).message}`);
      }
    });

    ws.on('close', () => {
      if (closed) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    });

    // 'error' is always followed by 'close', which drives the reconnect.
    ws.on('error', (err) =>
      console.error(`[relay] socket error: ${err.message || (err as { code?: string }).code || 'connection failed'}`),
    );
  };
  connect();

  return {
    secret,
    roomId,
    ready,
    close() {
      closed = true;
      ws?.close();
    },
  };
}

/** Normalize a `ws` message into a single Uint8Array. */
function toBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}
