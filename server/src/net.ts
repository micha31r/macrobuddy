import type { Server } from 'node:http';
import os from 'node:os';
import type { Express } from 'express';
import qrcode from 'qrcode-terminal';

const RESET = '\x1b[0m';
const GRAY = '\x1b[90m'; // bright-black = dim gray (the local/LAN code)
// 256-color vibrant purple (#af5fff) for the live/relay code. Bright enough to
// keep ~6:1 contrast on a dark terminal (still scans); 256-color rather than
// 24-bit so it renders on Apple Terminal too.
const PURPLE = '\x1b[38;5;135m';

/** Print a scannable QR for `url`, tinted with an ANSI `color` (or default if omitted). */
function renderQr(url: string, color?: string): void {
  qrcode.generate(url, { small: true }, (qr) => {
    // Color per line so the SGR state can't bleed past the block.
    console.log(color ? qr.split('\n').map((l) => `${color}${l}${RESET}`).join('\n') : qr);
  });
}

/**
 * Listen on `startPort`; if it's taken (EADDRINUSE) step to the next port, up to
 * `attempts` times, so a busy 3000 doesn't crash the host. Resolves with the
 * bound server (read `.address()` for the port it actually got).
 */
export function listen(app: Express, startPort: number, host: string, attempts = 20): Promise<Server> {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tried = 0;
    const server = app.listen(port, host); // creates the http.Server once
    server.on('listening', () => resolve(server));
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && tried < attempts) {
        tried += 1;
        port += 1;
        server.listen(port, host); // rebind the SAME server (app.listen would spawn a new one)
      } else {
        reject(err);
      }
    });
  });
}

/** First non-internal IPv4 address — the host's LAN address. */
export function lanAddress(): string | undefined {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return undefined;
}

export function buildUrl(host: string, port: number, secretB64: string): string {
  return `http://${host}:${port}/#${secretB64}`;
}

/** Print the scannable QR code plus the plain URL fallback (LAN / same WiFi). */
export function printStartupBanner(port: number, secretB64: string): void {
  const host = lanAddress();
  const url = buildUrl(host ?? 'localhost', port, secretB64);
  console.log('\nMacroBuddy is running.\n');
  console.log('Local frontend — scan with your phone on the same WiFi:\n');
  renderQr(url, GRAY); // gray: the local code is the dimmer of the two
  console.log('  The key after "#" stays on your device; the pad needs it to open.\n');
  if (!host) console.log(`  (no LAN address detected — open this machine's IP on port ${port})\n`);
}

/**
 * Print the relay QR — works on ANY network. The 256-bit secret rides in the
 * URL hash (`/#…`), which browsers never put on the wire, so the relay only
 * ever sees ciphertext.
 */
export function printRelayBanner(appUrl: string, secretB64: string): void {
  const url = `${appUrl.replace(/\/$/, '')}/#${secretB64}`;
  console.log('\nGlobal frontend — scan to use the pad from anywhere (end-to-end encrypted):\n');
  renderQr(url, PURPLE); // vibrant purple: the global code stands out from the gray local one
  console.log(`  ${url}\n`);
  console.log('  The key after "#" stays on your devices — the relay only sees ciphertext.\n');
}
