import { HttpError } from './response.js';
import { sha256Hex } from './crypto.js';

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'unknown';
}

/** Salted so stored hashes cannot be reversed by brute-forcing the IPv4 space without the key. */
export async function hashIp(request, env) {
  return (await sha256Hex(`${clientIp(request)}:${env.APP_ENCRYPTION_KEY ?? ''}`)).slice(0, 32);
}

/**
 * Fixed-window counter in KV. Not atomic, which is acceptable for abuse throttling.
 * Only hashed identifiers are placed in keys.
 */
export async function enforceRateLimit(env, keyParts, limit) {
  if (!env.SECRETS_KV || !(limit > 0)) return;
  const minute = Math.floor(Date.now() / 60000);
  const key = `rate:${keyParts.join(':')}:${minute}`;
  const count = Number.parseInt((await env.SECRETS_KV.get(key)) ?? '0', 10) || 0;
  if (count >= limit) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests, try again later');
  await env.SECRETS_KV.put(key, String(count + 1), { expirationTtl: 120 });
}
