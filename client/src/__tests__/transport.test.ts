import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decrypt, deriveKeys, encrypt, encodeSecret, type ControllerMessage } from '@macrobuddy/shared';
import { parseHashSecret, relayTransport, resolveEntry } from '../transport';

// The transport's crypto uses the global WebCrypto; ensure `crypto.subtle`
// exists under the Node test runner.
beforeAll(() => {
  if (!(globalThis.crypto && 'subtle' in globalThis.crypto)) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

/** A stand-in for the browser WebSocket the relay transport opens. */
class MockWebSocket {
  static last: MockWebSocket | undefined;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Uint8Array[] = [];
  constructor(readonly url: string) {
    MockWebSocket.last = this;
  }
  send(data: ArrayBufferLike | Uint8Array): void {
    this.sent.push(new Uint8Array(data as ArrayBuffer));
  }
  close(): void {
    this.onclose?.();
  }
  fireOpen(): void {
    this.onopen?.();
  }
  deliver(frame: Uint8Array): void {
    this.onmessage?.({ data: frame.buffer.slice(0) });
  }
}

afterEach(() => {
  MockWebSocket.last = undefined;
  vi.unstubAllGlobals();
});

describe('parseHashSecret', () => {
  it('returns null when there is no hash', () => {
    expect(parseHashSecret('')).toBeNull();
    expect(parseHashSecret('#')).toBeNull();
  });

  it('decodes a secret carried in the hash (with or without #)', () => {
    const secret = new Uint8Array(32).map((_, i) => i);
    const encoded = encodeSecret(secret);
    expect([...(parseHashSecret('#' + encoded) ?? [])]).toEqual([...secret]);
    expect([...(parseHashSecret(encoded) ?? [])]).toEqual([...secret]);
  });
});

describe('relayTransport', () => {
  const secret = new Uint8Array(32).map((_, i) => (i * 5 + 1) & 0xff);

  it('connects to the room derived from the secret, as the controller', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const { roomId } = await deriveKeys(secret);
    relayTransport(secret, 'wss://relay.example', 'tok');
    await vi.waitFor(() => expect(MockWebSocket.last).toBeDefined());
    expect(MockWebSocket.last!.url).toBe(`wss://relay.example/room/${roomId}?role=controller`);
  });

  it('round-trips an encrypted getConfig with a stand-in host', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const { key } = await deriveKeys(secret);
    const transport = relayTransport(secret, 'wss://relay.example', 'tok');

    await vi.waitFor(() => expect(MockWebSocket.last).toBeDefined());
    const ws = MockWebSocket.last!;
    ws.fireOpen();

    const pending = transport.fetchConfig();

    // The "host": wait for the encrypted request, decrypt it, reply in kind.
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    const request = await decrypt<ControllerMessage>(key, ws.sent[0]!);
    expect(request.t).toBe('getConfig');

    const config = { layout: { cols: 1, rows: 1 }, comboWindow: 150, doubleTapWindow: 250, holdThreshold: 350, keys: [] };
    ws.deliver(await encrypt(key, { t: 'config', rid: request.rid, config }));

    expect(await pending).toEqual(config);
  });

  it('rejects pressKeys when the host reports the action failed', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const { key } = await deriveKeys(secret);
    const transport = relayTransport(secret, 'wss://relay.example', 'tok');

    await vi.waitFor(() => expect(MockWebSocket.last).toBeDefined());
    const ws = MockWebSocket.last!;
    ws.fireOpen();

    const pending = transport.pressKeys([1], 'tap');
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    const request = await decrypt<ControllerMessage>(key, ws.sent[0]!);
    expect(request.t).toBe('action');

    ws.deliver(await encrypt(key, { t: 'result', rid: request.rid, ok: false, error: 'hotkey support unavailable' }));
    await expect(pending).rejects.toThrow(/hotkey support unavailable/);
  });
});

describe('resolveEntry', () => {
  const secret = new Uint8Array(32).map((_, i) => (i * 5 + 1) & 0xff);

  it('uses the HTTP transport when /config returns a real config', async () => {
    const config = { layout: { cols: 1, rows: 1 }, comboWindow: 150, doubleTapWindow: 250, holdThreshold: 350, keys: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => config })),
    );
    const { kind, config: got } = await resolveEntry(secret);
    expect(kind).toBe('http');
    expect(got).toEqual(config);
  });

  it('surfaces a 401 as "wrong key"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid or missing key' }) })),
    );
    await expect(resolveEntry(secret)).rejects.toThrow(/wrong key/);
  });

  it('switches to the relay transport when /config says {relay:true}', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ relay: true }) })),
    );
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('window', { location: { protocol: 'https:', host: 'relay.example' }, dispatchEvent: () => true });
    const { key } = await deriveKeys(secret);

    const pending = resolveEntry(secret);
    await vi.waitFor(() => expect(MockWebSocket.last).toBeDefined());
    const ws = MockWebSocket.last!;
    ws.fireOpen();
    await vi.waitFor(() => expect(ws.sent.length).toBe(1)); // getConfig over the WS
    const request = await decrypt<ControllerMessage>(key, ws.sent[0]!);
    expect(request.t).toBe('getConfig');

    const config = { layout: { cols: 2, rows: 2 }, comboWindow: 150, doubleTapWindow: 250, holdThreshold: 350, keys: [] };
    ws.deliver(await encrypt(key, { t: 'config', rid: request.rid, config }));

    const { kind, config: got } = await pending;
    expect(kind).toBe('relay');
    expect(got).toEqual(config);
  });
});
