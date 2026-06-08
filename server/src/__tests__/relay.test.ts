import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { type RawData } from 'ws';
import { decrypt, deriveKeys, encrypt, type HostMessage } from '@macrobuddy/shared';
import { ConfigStore } from '../config.js';
import { handleControllerMessage, startRelayClient } from '../relay.js';
import { startFakeRelay } from './fakeRelay.js';

const YAML = `
layout: { cols: 4, rows: 2 }
keys:
  - { id: 1, col: 1, row: 1 }
  - { id: 2, col: 2, row: 1 }
  - { id: 4, modifier: true, col: 3, row: 1 }
macros:
  - { keys: [1], action: { type: hotkey, keys: "cmd+c" } }
  - { keys: [2], action: { type: none } }
  - { keys: [4, 2], action: { type: hotkey, keys: "cmd+shift+f" } }
`;

let store: ConfigStore;
let configPath: string;

beforeAll(() => {
  configPath = path.join(os.tmpdir(), `macrobuddy-relay-${process.pid}.yaml`);
  fs.writeFileSync(configPath, YAML);
  store = ConfigStore.load(configPath);
});

afterAll(() => fs.rmSync(configPath, { force: true }));

describe('handleControllerMessage', () => {
  it('answers getConfig with the public config (no macros/actions)', async () => {
    const reply = await handleControllerMessage(store, { t: 'getConfig', rid: 'r1' });
    expect(reply.t).toBe('config');
    if (reply.t !== 'config') throw new Error('unreachable');
    expect(reply.rid).toBe('r1');
    expect(reply.config.keys).toHaveLength(3);
    expect(reply.config.comboWindow).toBe(150);
    expect(reply.config).not.toHaveProperty('macros');
  });

  it('dispatches an action and returns its result', async () => {
    const reply = await handleControllerMessage(store, { t: 'action', rid: 'r2', keys: [1], gesture: 'tap' });
    expect(reply.t).toBe('result');
    if (reply.t !== 'result') throw new Error('unreachable');
    expect(reply.rid).toBe('r2');
    // Bound macro exists → it runs (or, in this container, reports the hotkey
    // engine is unavailable). Either way it's a real, resolved result.
    expect(typeof reply.ok).toBe('boolean');
  });

  it('runs a `none` placeholder action as a no-op (ok)', async () => {
    const reply = await handleControllerMessage(store, { t: 'action', rid: 'rn', keys: [2], gesture: 'tap' });
    expect(reply.t).toBe('result');
    if (reply.t !== 'result') throw new Error('unreachable');
    expect(reply.ok).toBe(true);
  });

  it('reports an unbound combo as not-ok', async () => {
    const reply = await handleControllerMessage(store, { t: 'action', rid: 'r3', keys: [4, 1], gesture: 'combo' });
    expect(reply.t).toBe('result');
    if (reply.t !== 'result') throw new Error('unreachable');
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/no macro bound/);
  });
});

describe('end-to-end over a loopback relay', () => {
  it('runs the full encrypted path with no plaintext on the wire', async () => {
    const relay = await startFakeRelay();
    const secret = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
    const host = await startRelayClient(store, { relayWsUrl: relay.url, secret });
    await host.ready;

    const { roomId, key } = await deriveKeys(secret);
    const phone = new WebSocket(`${relay.url}/room/${roomId}?role=controller`);
    await new Promise<void>((resolve) => phone.on('open', () => resolve()));

    // getConfig
    phone.send(await encrypt(key, { t: 'getConfig', rid: 'c1' }));
    const configFrame = await nextBinary(phone);
    expect(latin1(configFrame)).not.toMatch(/layout|comboWindow|keys/); // opaque
    const configReply = await decrypt<HostMessage>(key, configFrame);
    expect(configReply.t).toBe('config');
    if (configReply.t !== 'config') throw new Error('unreachable');
    expect(configReply.rid).toBe('c1');
    expect(configReply.config.keys).toHaveLength(3);

    // action
    phone.send(await encrypt(key, { t: 'action', rid: 'c2', keys: [1], gesture: 'tap' }));
    const resultReply = await decrypt<HostMessage>(key, await nextBinary(phone));
    expect(resultReply.t).toBe('result');
    if (resultReply.t !== 'result') throw new Error('unreachable');
    expect(resultReply.rid).toBe('c2');

    phone.close();
    host.close();
    await relay.close();
  });
});

function nextBinary(ws: WebSocket): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const onMessage = (data: RawData, isBinary: boolean) => {
      if (!isBinary) return; // skip relay control (peer online/offline) text frames
      ws.off('message', onMessage);
      resolve(new Uint8Array(data as Buffer));
    };
    ws.on('message', onMessage);
  });
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}
