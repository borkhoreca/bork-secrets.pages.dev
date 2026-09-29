import { HttpError, json, guard } from '../response.js';
import { requireSupportHub } from '../auth.js';

const COLUMNS = `id, at, event_type, share_id, sender_id, sender_name, sender_email, sender_role,
  recipient_email, customer_id, customer_name, secret_name, status, details_json`;

export function listLogs(request, env) {
  return guard(async () => {
    await requireSupportHub(request, env);
    const q = new URL(request.url).searchParams;

    const limit = Math.min(Math.max(Number.parseInt(q.get('limit') ?? '50', 10) || 50, 1), 200);
    const where = [];
    const args = [];
    for (const [param, column] of [['recipientEmail', 'recipient_email'], ['customerId', 'customer_id'], ['senderEmail', 'sender_email']]) {
      if (q.get(param)) { where.push(`${column} = ?`); args.push(q.get(param)); }
    }
    if (q.get('from')) { where.push('at >= ?'); args.push(q.get('from')); }
    if (q.get('to')) { where.push('at <= ?'); args.push(q.get('to')); }

    // Keyset cursor "<at>|<id>" over (at DESC, id DESC).
    const cursor = q.get('cursor');
    if (cursor) {
      const [cAt, cId] = cursor.split('|');
      if (!cAt || !cId) throw new HttpError(400, 'VALIDATION_FAILED', 'Invalid cursor');
      where.push('(at < ? OR (at = ? AND id < ?))');
      args.push(cAt, cAt, cId);
    }

    const sql = `SELECT ${COLUMNS} FROM permanent_secret_share_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY at DESC, id DESC LIMIT ?`;
    const { results } = await env.DB.prepare(sql).bind(...args, limit + 1).all();

    const page = results.slice(0, limit);
    const last = page[page.length - 1];
    return json({
      items: page.map((r) => ({ ...r, details: r.details_json ? JSON.parse(r.details_json) : null, details_json: undefined })),
      nextCursor: results.length > limit ? `${last.at}|${last.id}` : null,
    });
  });
}
