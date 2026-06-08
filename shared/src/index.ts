// @macrobuddy/shared — the relay wire protocol + its end-to-end crypto.
//
// This module is the SINGLE SOURCE OF TRUTH shared by the phone (client), the
// laptop (server relay client), and any other peer. Both ends must derive the
// same room id + key and frame messages identically, or encryption silently
// breaks — so it lives in one place and is imported by both.
//
// It is deliberately isomorphic. The relay E2E crypto uses Web Crypto
// (`crypto.subtle`), which is only available in *secure* contexts (HTTPS) — fine,
// the relay is always HTTPS. The LAN token instead uses a pure-JS HMAC
// (@noble/hashes) so it also works on insecure plain-HTTP LAN origins, where
// `crypto.subtle` is undefined.
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

export type Gesture = 'tap' | 'double' | 'hold' | 'combo';
export type Role = 'host' | 'controller';

/** Mirror of the server's `toPublicConfig` output (server/src/config.ts). */
export interface PublicKey {
  id?: number;
  spacer: boolean;
  modifier: boolean;
  gestures: { tap: boolean; double: boolean; hold: boolean };
  label?: string;
  icon?: string;
  color?: string;
  shape: 'square' | 'circle';
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface PublicConfig {
  layout: { cols: number; rows: number };
  comboWindow: number;
  doubleTapWindow: number;
  holdThreshold: number;
  keys: PublicKey[];
}

/** Controller (phone) → Host (laptop). Sent as encrypted *binary* frames. */
export type ControllerMessage =
  | { t: 'getConfig'; rid: string }
  | { t: 'action'; rid: string; keys: number[]; gesture: Gesture; token?: string };

/** Host (laptop) → Controller (phone). Sent as encrypted *binary* frames. */
export type HostMessage =
  | { t: 'config'; rid: string; config: PublicConfig }
  | { t: 'result'; rid: string; ok: boolean; error?: string };

/**
 * Relay-originated control frame. Sent as a plaintext *text* frame — it carries
 * no secret, only "your peer connected/disconnected" so the LED can react. The
 * binary/text split lets each side tell E2E payloads from relay metadata.
 */
export type ControlMessage = { t: 'peer'; state: 'online' | 'offline' };

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

export const SECRET_BYTES = 32; // 256-bit root secret (lives only in the URL hash)
const IV_BYTES = 12; // AES-GCM nonce
const ROOM_BYTES = 16; // routing id length
const HKDF_SALT = utf8('macrobuddy/v1');

export interface DerivedKeys {
  /** Public routing id — safe to hand the relay; reveals nothing about `key`. */
  roomId: string;
  /** AES-256-GCM key — never leaves the two peers. */
  key: CryptoKey;
}

/** A fresh 256-bit root secret. Everything else derives from this. */
export function randomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

/**
 * Derive the (public) room id and the (private) encryption key from the root
 * secret. HKDF with distinct `info` strings → independent outputs, so the room
 * id can be public without weakening the key.
 */
export async function deriveKeys(secret: Uint8Array): Promise<DerivedKeys> {
  const roomBytes = await hkdf(secret, 'room', ROOM_BYTES);
  const keyBytes = await hkdf(secret, 'enc', 32);
  const key = await crypto.subtle.importKey('raw', ab(keyBytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { roomId: toHex(roomBytes), key };
}

/**
 * Derive the LAN HTTP auth token from the root secret (sent as `x-mb-token` on
 * `/config` and in the `/action` body). Pure-JS HMAC-SHA-256 (no `crypto.subtle`)
 * so it works on insecure plain-HTTP LAN origins (`http://lan-ip:3000`) where Web
 * Crypto's `subtle` is undefined. One-way → independent of the room id / AES key,
 * so the raw secret never has to go on the wire.
 */
export function deriveLanToken(secret: Uint8Array): string {
  return toBase64Url(hmac(sha256, secret, utf8('macrobuddy/lan')).subarray(0, 16));
}

/** Encrypt a JSON message → `iv(12) ‖ ciphertext+tag` (ArrayBuffer-backed). */
export async function encrypt(key: CryptoKey, message: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = utf8(JSON.stringify(message));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(iv) }, key, ab(plaintext)));
  const frame = new Uint8Array(IV_BYTES + ct.length);
  frame.set(iv, 0);
  frame.set(ct, IV_BYTES);
  return frame;
}

/** Decrypt a frame produced by `encrypt`. Throws on a wrong key / tampering. */
export async function decrypt<T = unknown>(key: CryptoKey, frame: Uint8Array): Promise<T> {
  const iv = frame.subarray(0, IV_BYTES);
  const ct = frame.subarray(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(iv) }, key, ab(ct));
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

// ---------------------------------------------------------------------------
// Encoding helpers (isomorphic base64url / hex / utf8)
// ---------------------------------------------------------------------------

/** Encode the root secret for the URL hash (`https://host/#<secret>`). */
export function encodeSecret(secret: Uint8Array): string {
  return toBase64Url(secret);
}

/** Decode the root secret read from `location.hash`. */
export function decodeSecret(text: string): Uint8Array {
  return fromBase64Url(text.replace(/^#/, ''));
}

async function hkdf(secret: Uint8Array, info: string, bytes: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', ab(secret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: ab(HKDF_SALT), info: ab(utf8(info)) },
    base,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// WebCrypto's newest lib typings require ArrayBuffer-backed views (not
// SharedArrayBuffer). Every byte array we hand it is ArrayBuffer-backed, so this
// boundary assertion is safe and keeps the public signatures plain `Uint8Array`.
function ab(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
