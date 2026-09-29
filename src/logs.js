import { randomId } from './crypto.js';

/**
 * Appends a metadata-only row to the permanent log. `row` is a shares-table shaped
 * object. Callers must never put secret values, ciphertext or tokens in `details`.
 */
export async function logEvent(env, eventType, row, status, details = null) {
  await env.DB.prepare(
    `INSERT INTO permanent_secret_share_logs
      (id, at, event_type, share_id, sender_id, sender_name, sender_email, sender_role,
       recipient_email, customer_id, customer_name, secret_name, status, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId('log_'),
      new Date().toISOString(),
      eventType,
      row.id,
      row.sender_id ?? null,
      row.sender_name ?? null,
      row.sender_email ?? null,
      row.sender_role ?? null,
      row.recipient_email,
      row.customer_id ?? null,
      row.customer_name ?? null,
      row.secret_name,
      status,
      details ? JSON.stringify(details) : null,
    )
    .run();
}

/** For paths where a logging failure must not lose or block the user-visible result. */
export async function logEventSafe(...args) {
  try {
    await logEvent(...args);
  } catch (err) {
    console.error('Permanent log write failed:', err?.message);
  }
}
