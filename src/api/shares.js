import { HttpError, json, guard } from '../response.js';
import { requireSupportHub } from '../auth.js';
import { validateCreateRequest, maskEmail, intVar, MAX_BODY_BYTES } from '../validation.js';
import { encryptSecret, decryptSecret, generateRevealToken, randomId, sha256Hex, timingSafeEqualStrings } from '../crypto.js';
import { logEvent, logEventSafe } from '../logs.js';
import { enforceRateLimit, hashIp } from '../rate-limit.js';
import { fingerprint, lookupIdempotent, storeIdempotent } from '../idempotency.js';
import { sendShareEmail } from '../email-sendgrid.js';

const kvKey = (shareId) => `secret:${shareId}`;
const KV_GRACE_SECONDS = 3600;

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(400, 'VALIDATION_FAILED', 'Request body too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Request body must be valid JSON');
  }
}

export function createShare(request, env) {
  return guard(async () => {
    const bearer = await requireSupportHub(request, env);
    const ipHash = await hashIp(request, env);
    await enforceRateLimit(env, ['create', (await sha256Hex(bearer)).slice(0, 12), ipHash], intVar(env.CREATE_RATE_LIMIT_PER_MINUTE, 60));

    const input = validateCreateRequest(await readJson(request), env);

    const idemKey = request.headers.get('Idempotency-Key')?.trim() || null;
    if (idemKey && idemKey.length > 200) throw new HttpError(400, 'VALIDATION_FAILED', 'Idempotency-Key too long');
    const requestHash = await fingerprint(input);
    const replay = await lookupIdempotent(env, idemKey, requestHash);
    if (replay) return json(replay, 200, { 'Idempotent-Replayed': 'true' });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString();
    const shareId = randomId('shr_');
    const revealToken = generateRevealToken();

    const row = {
      id: shareId,
      token_hash: await sha256Hex(revealToken),
      kv_key: kvKey(shareId),
      status: 'active',
      created_at: now.toISOString(),
      expires_at: expiresAt,
      sender_id: input.sender.id,
      sender_name: input.sender.name,
      sender_email: input.sender.email,
      sender_role: input.sender.role,
      recipient_email: input.recipientEmail,
      customer_id: input.customerId,
      customer_name: input.customerName,
      secret_name: input.secretName,
      source_app: input.sourceApp,
      ttl_seconds: input.ttlSeconds,
      create_request_id: idemKey,
    };

    await logEvent(env, 'share.create.requested', row, 'requested', { ipHash, ttlSeconds: input.ttlSeconds, requestId: idemKey });

    let encrypted;
    try {
      encrypted = await encryptSecret(input.secretValue, env.APP_ENCRYPTION_KEY, shareId);
    } catch (err) {
      console.error('Encryption failed:', err?.message);
      await logEventSafe(env, 'share.create.failed', row, 'failed', { reason: 'ENCRYPTION_FAILED' });
      throw new HttpError(500, 'ENCRYPTION_FAILED', 'Could not encrypt secret');
    }

    await env.SECRETS_KV.put(
      row.kv_key,
      JSON.stringify({ version: 1, algorithm: 'AES-GCM', ...encrypted, createdAt: row.created_at, expiresAt }),
      { expirationTtl: input.ttlSeconds + KV_GRACE_SECONDS },
    );
    await env.DB.prepare(
      `INSERT INTO shares (id, token_hash, kv_key, status, created_at, expires_at, sender_id, sender_name, sender_email,
        sender_role, recipient_email, customer_id, customer_name, secret_name, source_app, ttl_seconds, email_status, create_request_id)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(row.id, row.token_hash, row.kv_key, row.created_at, row.expires_at, row.sender_id, row.sender_name, row.sender_email,
        row.sender_role, row.recipient_email, row.customer_id, row.customer_name, row.secret_name, row.source_app, row.ttl_seconds, row.create_request_id)
      .run();
    await logEvent(env, 'share.create.stored', row, 'active');

    const link = `${String(env.PUBLIC_BASE_URL).replace(/\/+$/, '')}/s/${shareId}#${revealToken}`;
    try {
      const { messageId } = await sendShareEmail(env, {
        to: input.recipientEmail,
        link,
        expiresAt,
        senderName: input.sender.name,
        customerName: input.customerName,
        message: input.message,
      });
      await env.DB.prepare("UPDATE shares SET email_status = 'sent', email_message_id = ? WHERE id = ?").bind(messageId, shareId).run();
      await logEvent(env, 'share.email.sent', row, 'sent', { messageId });
    } catch (err) {
      console.error('Email send failed:', err?.status ?? err?.message);
      await env.DB.prepare("UPDATE shares SET status = 'failed', email_status = 'failed' WHERE id = ?").bind(shareId).run();
      await env.SECRETS_KV.delete(row.kv_key).catch(() => {});
      await logEventSafe(env, 'share.email.failed', row, 'failed', { upstreamStatus: err?.status ?? null });
      throw new HttpError(502, 'EMAIL_SEND_FAILED', 'Could not send email');
    }

    const response = { shareId, status: 'email_sent', expiresAt, recipientEmail: input.recipientEmail };
    await storeIdempotent(env, idemKey, shareId, requestHash, response);
    return json(response, 201);
  });
}

async function loadShare(env, id) {
  return env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(id).first();
}

/** Lazily flips overdue active shares to expired and drops their payload. */
async function expireIfNeeded(env, share) {
  if (share.status !== 'active' || share.expires_at > new Date().toISOString()) return share;
  const res = await env.DB.prepare("UPDATE shares SET status = 'expired' WHERE id = ? AND status = 'active'").bind(share.id).run();
  await env.SECRETS_KV.delete(share.kv_key).catch(() => {});
  if (res.meta?.changes === 1) await logEventSafe(env, 'share.expired', share, 'expired');
  return { ...share, status: 'expired' };
}

export function getShareStatus(request, env, id) {
  return guard(async () => {
    let share = await loadShare(env, id);
    if (!share || share.status === 'failed') return json({ status: 'not_found' }, 404);
    share = await expireIfNeeded(env, share);
    const body = { shareId: share.id, status: share.status };
    if (share.status === 'active') {
      Object.assign(body, {
        expiresAt: share.expires_at,
        recipientEmailMasked: maskEmail(share.recipient_email),
        customerName: share.customer_name,
      });
    } else if (share.status === 'consumed') {
      body.consumedAt = share.consumed_at;
    }
    return json(body);
  });
}

export function revealShare(request, env, id) {
  return guard(async () => {
    const ipHash = await hashIp(request, env);
    await enforceRateLimit(env, ['reveal', id, ipHash], intVar(env.REVEAL_RATE_LIMIT_PER_MINUTE, 20));

    let body;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const token = typeof body?.token === 'string' ? body.token : '';
    if (!token || token.length > 512) throw new HttpError(400, 'VALIDATION_FAILED', 'token is required');

    let share = await loadShare(env, id);
    if (!share || share.status === 'failed') throw new HttpError(404, 'SHARE_NOT_FOUND', 'Share not found');

    const fail = async (reason) => logEventSafe(env, 'share.reveal.failed', share, share.status, { reason, ipHash });

    if (!(await timingSafeEqualStrings(await sha256Hex(token), share.token_hash))) {
      await fail('INVALID_TOKEN');
      throw new HttpError(401, 'INVALID_TOKEN', 'Invalid token');
    }

    share = await expireIfNeeded(env, share);
    if (share.status === 'expired') {
      await fail('SHARE_EXPIRED');
      throw new HttpError(410, 'SHARE_EXPIRED', 'This link has expired');
    }
    if (share.status !== 'active') {
      await fail(share.status === 'consumed' ? 'SHARE_CONSUMED' : 'SHARE_UNAVAILABLE');
      throw new HttpError(410, share.status === 'consumed' ? 'SHARE_CONSUMED' : 'SHARE_EXPIRED', 'This secret is no longer available');
    }

    // Atomic single-consume: only one concurrent request can flip active -> consumed.
    const consumedAt = new Date().toISOString();
    const res = await env.DB.prepare(
      `UPDATE shares SET status = 'consumed', consumed_at = ?, consumed_ip_hash = ?, consumed_user_agent = ?
       WHERE id = ? AND status = 'active' AND expires_at > ?`,
    )
      .bind(consumedAt, ipHash, (request.headers.get('User-Agent') ?? '').slice(0, 300), id, consumedAt)
      .run();
    if (res.meta?.changes !== 1) {
      await fail('SHARE_CONSUMED');
      throw new HttpError(410, 'SHARE_CONSUMED', 'This secret is no longer available');
    }

    let secretValue;
    try {
      const raw = await env.SECRETS_KV.get(share.kv_key);
      if (!raw) throw new Error('payload missing');
      secretValue = await decryptSecret(JSON.parse(raw), env.APP_ENCRYPTION_KEY, id);
    } catch (err) {
      console.error('Decrypt/storage failure:', err?.message);
      await env.SECRETS_KV.delete(share.kv_key).catch(() => {});
      await fail('DECRYPTION_FAILED');
      throw new HttpError(500, 'DECRYPTION_FAILED', 'Could not retrieve secret');
    }

    await env.SECRETS_KV.delete(share.kv_key).catch((err) => console.error('KV delete failed:', err?.message));
    await logEventSafe(env, 'share.reveal.consumed', share, 'consumed', { ipHash });
    return json({ secretValue, consumedAt });
  });
}
