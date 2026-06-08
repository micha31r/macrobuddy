import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigStore } from '../config.js';
import { createApp } from '../server.js';

const YAML = `
layout: { cols: 2, rows: 1 }
keys:
  - { id: 1, col: 1, row: 1 }
macros:
  - { keys: [1], action: { type: hotkey, keys: "cmd+c" } }
`;

let server: Server;
let base: string;
let configPath: string;

beforeAll(async () => {
  configPath = path.join(os.tmpdir(), `mb-server-${process.pid}.yaml`);
  fs.writeFileSync(configPath, YAML);
  const store = ConfigStore.load(configPath);
  store.setToken('secret-token'); // the key-derived LAN token (stubbed here)
  await new Promise<void>((resolve) => {
    server = createApp(store, path.join(os.tmpdir(), 'no-dist')).listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
  fs.rmSync(configPath, { force: true });
});

describe('GET /config — key required', () => {
  it('rejects without the token (401)', async () => {
    expect((await fetch(`${base}/config`)).status).toBe(401);
  });

  it('rejects a wrong token (401)', async () => {
    expect((await fetch(`${base}/config`, { headers: { 'x-mb-token': 'nope' } })).status).toBe(401);
  });

  it('accepts the right token and returns the public config (no macros)', async () => {
    const res = await fetch(`${base}/config`, { headers: { 'x-mb-token': 'secret-token' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: unknown[]; macros?: unknown };
    expect(body.keys).toHaveLength(1);
    expect(body).not.toHaveProperty('macros');
  });

  it('HEAD /config is an auth-free connectivity heartbeat', async () => {
    expect((await fetch(`${base}/config`, { method: 'HEAD' })).status).toBe(200);
  });
});
