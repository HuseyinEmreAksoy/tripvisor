/**
 * base64.ts — dependency-free base64 ⇄ bytes (M5 Y2.1 photo pipeline).
 *
 * expo-image-manipulator hands the encoded JPEG back as base64 on native;
 * the pipeline needs the raw bytes to strip/verify metadata and to upload an
 * ArrayBuffer (the supabase-js Storage path that works on React Native).
 * Hermes' atob/btoa availability has varied across RN versions, so this
 * stays pure and portable (and fast enough for ~350 KB images).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Int16Array = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  // URL-safe variants decode too.
  t['-'.charCodeAt(0)] = 62;
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** Decode base64 (standard or URL-safe; whitespace and a data: prefix tolerated). */
export function base64ToBytes(input: string): Uint8Array {
  const comma = input.startsWith('data:') ? input.indexOf(',') : -1;
  const src = comma >= 0 ? input.slice(comma + 1) : input;
  const out = new Uint8Array(Math.floor((src.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 61 /* = */) break;
    const v = c < 256 ? (LOOKUP[c] as number) : -1;
    if (v < 0) {
      if (c === 10 || c === 13 || c === 32 || c === 9) continue;
      throw new Error(`[photos.base64] invalid character at ${i}`);
    }
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Encode bytes as standard base64 (with padding). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '=';
  }
  return out;
}

/** A standalone ArrayBuffer holding exactly `bytes` (upload bodies must not carry a parent buffer's slack). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
