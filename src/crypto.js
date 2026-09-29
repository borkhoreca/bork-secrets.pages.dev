const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomId(prefix, byteLength = 16) {
  return `${prefix}${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))}`;
}

export function generateRevealToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))); // 256 bits
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings without early return by comparing their fixed-length SHA-256 digests. */
export async function timingSafeEqualStrings(a, b) {
  const [ha, hb] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

function parseKey(keyString) {
  const raw = String(keyString ?? '').trim();
  let bytes;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    bytes = Uint8Array.from(raw.match(/../g).map((h) => parseInt(h, 16)));
  } else {
    try {
      bytes = base64ToBytes(raw.replace(/-/g, '+').replace(/_/g, '/'));
    } catch {
      bytes = new Uint8Array(0);
    }
  }
  if (bytes.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be a 256-bit base64 or hex key');
  return bytes;
}

async function importKey(keyString, usage) {
  return crypto.subtle.importKey('raw', parseKey(keyString), { name: 'AES-GCM' }, false, [usage]);
}

/**
 * AES-256-GCM. The shareId is bound as additional authenticated data so a payload
 * cannot be moved to another share. Web Crypto appends the auth tag to the ciphertext.
 */
export async function encryptSecret(plaintext, keyString, shareId) {
  const key = await importKey(keyString, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(shareId) },
    key,
    encoder.encode(plaintext),
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptSecret({ iv, ciphertext }, keyString, shareId) {
  const key = await importKey(keyString, 'decrypt');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv), additionalData: encoder.encode(shareId) },
    key,
    base64ToBytes(ciphertext),
  );
  return decoder.decode(plain);
}
