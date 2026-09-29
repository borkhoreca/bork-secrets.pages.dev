import { sha256Hex } from './crypto.js';
import { HttpError } from './response.js';

/** Fingerprint of the request, so the same key with a different payload is a conflict. */
export function fingerprint(input) {
  return sha256Hex(JSON.stringify(input));
}

export async function lookupIdempotent(env, key, requestHash) {
  if (!key) return null;
  const row = await env.DB.prepare('SELECT response_json FROM idempotency_keys WHERE key = ?').bind(key).first();
  if (!row) return null;
  const stored = JSON.parse(row.response_json);
  if (stored.requestHash !== requestHash) {
    throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used with a different request');
  }
  return stored.response;
}

export async function storeIdempotent(env, key, shareId, requestHash, response) {
  if (!key) return;
  await env.DB.prepare(
    'INSERT OR IGNORE INTO idempotency_keys (key, share_id, created_at, response_json) VALUES (?, ?, ?, ?)',
  )
    .bind(key, shareId, new Date().toISOString(), JSON.stringify({ requestHash, response }))
    .run();
}
