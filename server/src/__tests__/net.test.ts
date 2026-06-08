import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { listen } from '../net.js';

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function track(s: Server): Server {
  open.push(s);
  return s;
}
const portOf = (s: Server) => (s.address() as AddressInfo).port;

describe('listen — smart port fallback', () => {
  it('binds the requested port when free', async () => {
    const s = track(await listen(express(), 0, '127.0.0.1'));
    expect(portOf(s)).toBeGreaterThan(0);
  });

  it('steps to the next port when the requested one is taken', async () => {
    const first = track(await listen(express(), 0, '127.0.0.1'));
    const busy = portOf(first);

    // Same port is occupied → listen must fall through to a different one.
    const second = track(await listen(express(), busy, '127.0.0.1'));
    expect(portOf(second)).not.toBe(busy);
  });

  it('rejects if no port is free within the attempt budget', async () => {
    const first = track(await listen(express(), 0, '127.0.0.1'));
    const busy = portOf(first);
    // attempts = 0 → no retry, so the busy port surfaces EADDRINUSE.
    await expect(listen(express(), busy, '127.0.0.1', 0)).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
