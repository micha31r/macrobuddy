import { describe, expect, it } from 'vitest';
import {
  decodeSecret,
  decrypt,
  deriveKeys,
  deriveLanToken,
  encodeSecret,
  encrypt,
  randomSecret,
  SECRET_BYTES,
} from '../index.js';

// A fixed secret so the derived room id is a stable golden value.
const FIXED = new Uint8Array(32).map((_, i) => i + 1); // 0x01,0x02,…,0x20

describe('deriveKeys', () => {
  it('derives a deterministic room id from a fixed secret', async () => {
    const a = await deriveKeys(FIXED);
    const b = await deriveKeys(FIXED);
    expect(a.roomId).toBe(b.roomId);
    expect(a.roomId).toMatch(/^[0-9a-f]{32}$/); // 16 bytes, hex
  });

  it('gives different room ids for different secrets', async () => {
    const a = await deriveKeys(randomSecret());
    const b = await deriveKeys(randomSecret());
    expect(a.roomId).not.toBe(b.roomId);
  });
});

describe('deriveLanToken', () => {
  it('is deterministic from a fixed secret', () => {
    expect(deriveLanToken(FIXED)).toBe(deriveLanToken(FIXED));
    expect(deriveLanToken(FIXED)).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });

  it('differs per secret and is independent of the room id', async () => {
    expect(deriveLanToken(FIXED)).not.toBe(deriveLanToken(randomSecret()));
    expect(deriveLanToken(FIXED)).not.toBe((await deriveKeys(FIXED)).roomId); // distinct domain
  });

  it('works without crypto.subtle (insecure plain-HTTP LAN origin)', () => {
    // On http://lan-ip:3000 (iOS Safari), `crypto.subtle` is undefined. The LAN
    // token must derive anyway — it uses a pure-JS HMAC, not Web Crypto.
    const subtle = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      expect(() => deriveLanToken(FIXED)).not.toThrow();
      expect(deriveLanToken(FIXED)).toMatch(/^[A-Za-z0-9_-]+$/);
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true });
    }
  });
});

describe('encrypt / decrypt', () => {
  it('round-trips a message under the same derived key', async () => {
    const { key } = await deriveKeys(FIXED);
    const msg = { t: 'action', rid: 'r1', keys: [4, 12], gesture: 'combo' };
    const frame = await encrypt(key, msg);
    expect(await decrypt(key, frame)).toEqual(msg);
  });

  it('produces opaque frames — no plaintext leaks onto the wire', async () => {
    const { key } = await deriveKeys(FIXED);
    const frame = await encrypt(key, { t: 'action', keys: [1], gesture: 'tap', token: 'hunter2' });
    const text = new TextDecoder().decode(frame);
    for (const needle of ['action', 'gesture', 'tap', 'token', 'hunter2']) {
      expect(text).not.toContain(needle);
    }
  });

  it('fails to decrypt under a key derived from a different secret', async () => {
    const mine = await deriveKeys(FIXED);
    const theirs = await deriveKeys(randomSecret());
    const frame = await encrypt(mine.key, { t: 'getConfig', rid: 'x' });
    await expect(decrypt(theirs.key, frame)).rejects.toBeTruthy();
  });

  it('two peers from the same secret can talk', async () => {
    const secret = randomSecret();
    const phone = await deriveKeys(secret);
    const laptop = await deriveKeys(secret);
    expect(phone.roomId).toBe(laptop.roomId);
    const frame = await encrypt(phone.key, { t: 'getConfig', rid: 'q' });
    expect(await decrypt(laptop.key, frame)).toEqual({ t: 'getConfig', rid: 'q' });
  });
});

describe('secret encoding', () => {
  it('round-trips through the URL-hash encoding', () => {
    const secret = randomSecret();
    expect(secret.length).toBe(SECRET_BYTES);
    const encoded = encodeSecret(secret);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect([...decodeSecret(encoded)]).toEqual([...secret]);
  });

  it('tolerates a leading # from location.hash', () => {
    const secret = randomSecret();
    expect([...decodeSecret('#' + encodeSecret(secret))]).toEqual([...secret]);
  });
});
