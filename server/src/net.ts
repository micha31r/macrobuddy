import os from 'node:os';
import qrcode from 'qrcode-terminal';

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
  console.log('\nMacroBuddy is running. Scan with your phone (same WiFi):\n');
  qrcode.generate(url, { small: true });
  console.log(`  ${url}\n`);
  console.log('  The key after "#" stays on your device; the pad needs it to open.\n');
  if (!host) console.log("  (no LAN address detected — replace \"localhost\" with this machine's IP)\n");
}

/**
 * Print the relay QR — works on ANY network. The 256-bit secret rides in the
 * URL hash (`/#…`), which browsers never put on the wire, so the relay only
 * ever sees ciphertext.
 */
export function printRelayBanner(appUrl: string, secretB64: string): void {
  const url = `${appUrl.replace(/\/$/, '')}/#${secretB64}`;
  console.log('\nRemote access is on. Scan to use the pad on ANY network (end-to-end encrypted):\n');
  qrcode.generate(url, { small: true });
  console.log(`  ${url}\n`);
  console.log('  The key after "#" stays on your devices — the relay only sees ciphertext.\n');
}
