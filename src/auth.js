import { HttpError } from './response.js';
import { timingSafeEqualStrings } from './crypto.js';

export async function requireSupportHub(request, env) {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!env.SUPPORT_HUB_API_TOKEN || !token || !(await timingSafeEqualStrings(token, env.SUPPORT_HUB_API_TOKEN))) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token');
  }
  // Defense in depth only; the bearer token above remains the authentication.
  const origin = request.headers.get('Origin');
  if (origin) {
    const allowed = (env.ALLOWED_SUPPORT_HUB_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    if (!allowed.includes(origin)) throw new HttpError(403, 'ORIGIN_DENIED', 'Origin not allowed');
  }
  return token;
}
