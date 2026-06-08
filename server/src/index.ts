import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveLanToken, encodeSecret, randomSecret } from '@macrobuddy/shared';
import { ConfigStore } from './config.js';
import { listen, printRelayBanner, printStartupBanner } from './net.js';
import { startRelayClient } from './relay.js';
import { createApp } from './server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Config path: CLI arg (relative to cwd) or macropad.yaml at the repo root.
const configPath = path.resolve(process.argv[2] ?? path.join(here, '../../macropad.yaml'));

let store: ConfigStore;
try {
  store = ConfigStore.load(configPath);
} catch (err) {
  console.error(`Failed to load ${configPath}:\n${(err as Error).message}`);
  process.exit(1);
}
store.watch();

const port = Number(process.env.PORT) || 3000;
// The Vite + cloudflare() build emits the pad to client/dist/client (the Worker
// bundle lands alongside, unused by this Node/LAN server).
const clientDist = path.resolve(here, '../../client/dist/client');

// One secret per start gates everything: the LAN HTTP token AND the relay's
// room id + AES key all derive from it. A passphrase in MACROBUDDY_SECRET pins
// it (stable across restarts — handy in dev); otherwise it's a fresh random
// 256-bit secret. The pad always opens with this key (in the URL hash).
const secretEnv = process.env.MACROBUDDY_SECRET?.trim();
const secret = secretEnv ? new TextEncoder().encode(secretEnv) : randomSecret();
const secretB64 = encodeSecret(secret);
store.setToken(deriveLanToken(secret));

/** True for a localhost / loopback relay target (i.e. the local Vite dev Worker). */
function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return /(?:\/\/|^)(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(url);
  }
}

const app = createApp(store, clientDist);
void (async () => {
  let server;
  try {
    // Smart bind: if `port` is taken, step to the next free port instead of crashing.
    server = await listen(app, port, '0.0.0.0');
  } catch (err) {
    console.error(`[server] could not bind a free port near ${port}: ${(err as Error).message}`);
    process.exit(1);
  }
  const actualPort = (server.address() as AddressInfo).port;
  if (actualPort !== port) console.log(`[server] port ${port} was busy — using ${actualPort}`);

  console.log(`[server] config: ${configPath}`);
  printStartupBanner(actualPort, secretB64);

  // (In `npm run dev` the keyed hot-reload URL is printed by Vite itself, using
  // its own actual port — see client/vite.config.ts.)

  // Remote access (relay): the host dials OUT to the public Worker that serves
  // the pad + runs the relay, so the pad works on any network. Defaults to the
  // production host; override with MACROBUDDY_RELAY_APP_URL (set it empty for
  // LAN-only). `npm run dev` sets it empty so dev never touches production.
  const appUrl = (process.env.MACROBUDDY_RELAY_APP_URL ?? 'https://macrobuddy.dev').trim();
  if (appUrl) {
    const relayWsUrl = process.env.MACROBUDDY_RELAY_WS?.trim() || appUrl.replace(/^http/, 'ws');

    // Dev guard: the in-Vite Worker runs on Cloudflare's miniflare, which crashes
    // on Node ≥25 when a WebSocket upgrades to it (workers-sdk bug). Connecting as
    // the relay host would take down `vite dev`, so on a loopback target + Node ≥25
    // we skip it. A real (non-loopback) Worker URL never hits miniflare → fine.
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (isLoopback(relayWsUrl) && nodeMajor >= 25) {
      console.warn(
        `[relay] Relay-in-dev is off on Node ${process.versions.node} — Cloudflare's miniflare ` +
          'crashes on Node ≥25 (workers-sdk bug). LAN/pad dev still works; for relay testing use ' +
          'Node 22 or 24 LTS (run `nvm use`).',
      );
      return;
    }

    try {
      await startRelayClient(store, { relayWsUrl, secret });
      printRelayBanner(appUrl, secretB64);
    } catch (err) {
      console.error(`[relay] failed to start: ${(err as Error).message}`);
    }
  } else {
    // Relay disabled (MACROBUDDY_RELAY_APP_URL empty — e.g. `npm run dev`). Local frontend only.
    console.log('\x1b[90m  Global frontend off (remote access disabled) — showing the local one only.\x1b[0m\n');
  }
})();
