import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createShare, getShareStatus, revealShare } from '../src/api/shares.js';
import { listLogs } from '../src/api/admin.js';
import { makeEnv, createRequest, payload, mockSendGrid, extractLink, revealRequest, SECRET, TOKEN } from './helpers.js';

let env, sg;
beforeEach(() => { env = makeEnv(); sg = mockSendGrid(); });
afterEach(() => sg.restore());

const secretKeys = () => [...env.SECRETS_KV.store.keys()].filter((k) => k.startsWith('secret:'));

async function create(body = payload(), opts) {
  return createShare(createRequest(body, opts), env);
}

async function created() {
  const res = await create();
  assert.equal(res.status, 201);
  return { res, ...extractLink(sg.calls.at(-1)), data: await res.json() };
}

const dump = (env) => JSON.stringify({
  shares: env.DB.raw.prepare('SELECT * FROM shares').all(),
  logs: env.DB.raw.prepare('SELECT * FROM permanent_secret_share_logs').all(),
  idem: env.DB.raw.prepare('SELECT * FROM idempotency_keys').all(),
  kv: [...env.SECRETS_KV.store.entries()].filter(([k]) => k.startsWith('secret:')).map(([, v]) => v),
});

test('1. create rejects missing bearer token', async () => {
  const res = await create(payload(), { auth: false });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'UNAUTHORIZED');
  assert.equal(sg.calls.length, 0);
});

test('1b. create rejects wrong token and disallowed origin', async () => {
  const bad = await createShare(new Request('https://x/api/shares', { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: '{}' }), env);
  assert.equal(bad.status, 401);
  const origin = await create(payload(), { headers: { Origin: 'https://evil.example' } });
  assert.equal(origin.status, 403);
  assert.equal((await origin.json()).code, 'ORIGIN_DENIED');
  const ok = await create(payload(), { headers: { Origin: 'https://support.bork.nl' } });
  assert.equal(ok.status, 201);
});

test('2. create rejects invalid email', async () => {
  const res = await create(payload({ recipientEmail: 'not-an-email' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'VALIDATION_FAILED');
});

test('3. create rejects empty and oversized secret', async () => {
  assert.equal((await create(payload({ secretValue: '' }))).status, 400);
  assert.equal((await create(payload({ secretValue: 'a'.repeat(64 * 1024 + 1) }))).status, 400);
});

test('4. create clamps TTL', async () => {
  await create(payload({ ttlSeconds: 1 }));
  await create(payload({ ttlSeconds: 99999999 }));
  await create(payload({ secretName: 'default' }));
  const ttls = env.DB.raw.prepare('SELECT ttl_seconds FROM shares ORDER BY created_at, rowid').all().map((r) => r.ttl_seconds);
  assert.deepEqual(ttls, [300, 1209600, 604800]);
  const kvTtl = Object.entries(env.SECRETS_KV.store.lastOptions).filter(([k]) => k.startsWith('secret:')).map(([, o]) => o.expirationTtl);
  assert.deepEqual(kvTtl.sort((a, b) => a - b), [300 + 3600, 604800 + 3600, 1209600 + 3600]);
});

test('5. stored payload is encrypted and plaintext never stored', async () => {
  const { id } = await created();
  const kv = JSON.parse(env.SECRETS_KV.store.get(`secret:${id}`));
  assert.equal(kv.algorithm, 'AES-GCM');
  assert.equal(kv.version, 1);
  assert.ok(kv.iv && kv.ciphertext);
  assert.ok(!dump(env).includes(SECRET));
});

test('6. create sends email through SendGrid with link but no secret', async () => {
  const { id, token, data } = await created();
  assert.equal(data.status, 'email_sent');
  assert.equal(sg.calls.length, 1);
  const { url, init, body } = sg.calls[0];
  assert.equal(url, 'https://api.sendgrid.com/v3/mail/send');
  assert.equal(init.headers.Authorization, 'Bearer SG.test-key');
  assert.equal(body.personalizations[0].to[0].email, 'recipient@example.com');
  assert.equal(body.subject, 'Bork Support heeft een veilig geheim met je gedeeld');
  assert.ok(token.length >= 43);
  assert.match(sg.calls[0].init.body, new RegExp(`/s/${id}#`));
  assert.ok(!sg.calls[0].init.body.includes(SECRET));
  // response never leaks token or link
  assert.ok(!JSON.stringify(data).includes(token));
  assert.equal(env.DB.raw.prepare('SELECT email_status, email_message_id FROM shares').get().email_status, 'sent');
});

test('6b. SendGrid failure -> 502, share failed, KV deleted, failure logged', async () => {
  sg.restore();
  sg = mockSendGrid({ status: 500 });
  const res = await create();
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'EMAIL_SEND_FAILED');
  assert.equal(secretKeys().length, 0);
  const share = env.DB.raw.prepare('SELECT status, email_status FROM shares').get();
  assert.deepEqual({ ...share }, { status: 'failed', email_status: 'failed' });
  const events = env.DB.raw.prepare('SELECT event_type FROM permanent_secret_share_logs').all().map((r) => r.event_type);
  assert.ok(events.includes('share.email.failed'));
});

test('7. permanent log has sender/recipient metadata and no secret or token', async () => {
  const { id, token } = await created();
  const logs = env.DB.raw.prepare('SELECT * FROM permanent_secret_share_logs WHERE share_id = ?').all(id);
  assert.deepEqual(logs.map((l) => l.event_type), ['share.create.requested', 'share.create.stored', 'share.email.sent']);
  for (const l of logs) {
    assert.equal(l.sender_email, 'agent@bork.nl');
    assert.equal(l.recipient_email, 'recipient@example.com');
    assert.equal(l.customer_id, 'cust_1');
    assert.equal(l.secret_name, 'admin_pass');
  }
  const all = dump(env);
  assert.ok(!all.includes(SECRET));
  assert.ok(!all.includes(token));
  assert.ok(!all.includes(TOKEN));
});

test('7b. reveal token is stored only as SHA-256 hash', async () => {
  const { token } = await created();
  const { token_hash } = env.DB.raw.prepare('SELECT token_hash FROM shares').get();
  assert.match(token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(token_hash, token);
});

test('8. idempotency key replays same response, one email, conflict on different payload', async () => {
  const headers = { 'Idempotency-Key': 'key-1' };
  const a = await create(payload(), { headers });
  const b = await create(payload(), { headers });
  assert.equal(b.status, 200);
  assert.deepEqual(await b.json(), await a.json());
  assert.equal(sg.calls.length, 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) c FROM shares').get().c, 1);
  const c = await create(payload({ secretValue: 'different' }), { headers });
  assert.equal(c.status, 409);
  assert.equal(sg.calls.length, 1);
});

test('9. status does not reveal or consume', async () => {
  const { id, token } = await created();
  for (let i = 0; i < 3; i++) {
    const res = await getShareStatus(new Request('https://x'), env, id);
    const body = await res.json();
    assert.equal(body.status, 'active');
    assert.equal(body.recipientEmailMasked, 'r***@example.com');
    assert.equal(body.customerName, 'Example Customer');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.ok(!JSON.stringify(body).includes(SECRET));
  }
  assert.equal(env.DB.raw.prepare('SELECT status FROM shares').get().status, 'active');
  assert.equal(secretKeys().length, 1);
  assert.equal((await revealShare(revealRequest(id, token), env, id)).status, 200);
  const notFound = await getShareStatus(new Request('https://x'), env, 'shr_nope');
  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), { status: 'not_found' });
});

test('10. reveal rejects missing and invalid token without consuming', async () => {
  const { id, token } = await created();
  assert.equal((await revealShare(revealRequest(id), env, id)).status, 400);
  const bad = await revealShare(revealRequest(id, 'wrong'), env, id);
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).code, 'INVALID_TOKEN');
  assert.equal((await revealShare(revealRequest('shr_nope', token), env, 'shr_nope')).status, 404);
  assert.equal(env.DB.raw.prepare('SELECT status FROM shares').get().status, 'active');
});

test('11+12+14+15. reveal returns secret once, deletes KV, logs consumed; second reveal is 410', async () => {
  const { id, token } = await created();
  const res = await revealShare(revealRequest(id, token), env, id);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.equal(body.secretValue, SECRET);
  assert.ok(body.consumedAt);

  assert.equal(env.SECRETS_KV.store.has(`secret:${id}`), false);

  const again = await revealShare(revealRequest(id, token), env, id);
  assert.equal(again.status, 410);
  assert.equal((await again.json()).code, 'SHARE_CONSUMED');

  const consumedLog = env.DB.raw.prepare("SELECT * FROM permanent_secret_share_logs WHERE event_type = 'share.reveal.consumed'").all();
  assert.equal(consumedLog.length, 1);
  assert.equal(consumedLog[0].sender_email, 'agent@bork.nl');
  assert.ok(!dump(env).includes(SECRET));

  const status = await (await getShareStatus(new Request('https://x'), env, id)).json();
  assert.equal(status.status, 'consumed');
});

test('11b. concurrent reveals: exactly one succeeds', async () => {
  const { id, token } = await created();
  const results = await Promise.all(Array.from({ length: 5 }, () => revealShare(revealRequest(id, token), env, id)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 410, 410, 410, 410]);
});

test('13. expired share returns 410 and is not revealed', async () => {
  const { id, token } = await created();
  env.DB.raw.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
  const res = await revealShare(revealRequest(id, token), env, id);
  assert.equal(res.status, 410);
  assert.equal((await res.json()).code, 'SHARE_EXPIRED');
  assert.equal(env.SECRETS_KV.store.has(`secret:${id}`), false);
  assert.equal((await (await getShareStatus(new Request('https://x'), env, id)).json()).status, 'expired');
});

test('logs survive reveal and cannot be updated or deleted', async () => {
  const { id, token } = await created();
  await revealShare(revealRequest(id, token), env, id);
  assert.throws(() => env.DB.raw.prepare('DELETE FROM permanent_secret_share_logs').run(), /append-only/);
  assert.throws(() => env.DB.raw.prepare("UPDATE permanent_secret_share_logs SET status = 'x'").run(), /append-only/);
});

test('reveal is rate limited per share and IP', async () => {
  env = makeEnv({ REVEAL_RATE_LIMIT_PER_MINUTE: '2' });
  const { id } = await created();
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await revealShare(revealRequest(id, 'wrong'), env, id)).status);
  assert.deepEqual(statuses, [401, 401, 429]);
});

test('admin logs require auth, filter, paginate, and expose no secrets', async () => {
  const { id, token } = await created();
  await revealShare(revealRequest(id, token), env, id);
  const url = 'https://secrets.test/api/admin/logs';

  assert.equal((await listLogs(new Request(url), env)).status, 401);

  const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };
  const page1 = await (await listLogs(new Request(`${url}?limit=2&recipientEmail=recipient@example.com`, auth), env)).json();
  assert.equal(page1.items.length, 2);
  assert.ok(page1.nextCursor);
  const page2 = await (await listLogs(new Request(`${url}?limit=50&cursor=${encodeURIComponent(page1.nextCursor)}`, auth), env)).json();
  assert.equal(page1.items.length + page2.items.length, 4);
  assert.equal(page2.nextCursor, null);
  assert.equal((await (await listLogs(new Request(`${url}?customerId=other`, auth), env)).json()).items.length, 0);
  assert.ok(!JSON.stringify([page1, page2]).includes(SECRET));
});
