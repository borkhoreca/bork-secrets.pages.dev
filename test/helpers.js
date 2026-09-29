import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/** Minimal D1 stand-in backed by node:sqlite, running the real migration. */
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const clean = (args) => args.map((a) => (a === undefined ? null : a));
  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      const make = (args) => ({
        bind: (...a) => make(clean(a)),
        run: async () => ({ meta: { changes: Number(stmt.run(...args).changes) } }),
        first: async () => stmt.get(...args) ?? null,
        all: async () => ({ results: stmt.all(...args) }),
      });
      return make([]);
    },
  };
}

export function fakeKV() {
  const store = new Map();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v, opts) => { store.set(k, v); store.lastOptions = { ...(store.lastOptions ?? {}), [k]: opts }; },
    delete: async (k) => { store.delete(k); },
  };
}

export const TOKEN = 'hub-token-123';

export function makeEnv(overrides = {}) {
  return {
    DB: fakeD1(),
    SECRETS_KV: fakeKV(),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SENDGRID_API_KEY: 'SG.test-key',
    SUPPORT_HUB_API_TOKEN: TOKEN,
    FROM_EMAIL: 'noreply@bork.nl',
    FROM_NAME: 'Bork Support',
    PUBLIC_BASE_URL: 'https://secrets.test',
    DEFAULT_TTL_SECONDS: '604800',
    MAX_TTL_SECONDS: '1209600',
    MIN_TTL_SECONDS: '300',
    ALLOWED_SUPPORT_HUB_ORIGINS: 'https://support.bork.nl',
    ...overrides,
  };
}

export const SECRET = 'S3cr3t-P@ssw0rd-do-not-leak';

export function payload(extra = {}) {
  return {
    secretValue: SECRET,
    secretName: 'admin_pass',
    recipientEmail: 'recipient@example.com',
    customerId: 'cust_1',
    customerName: 'Example Customer',
    message: 'Hallo',
    sender: { id: 'u1', name: 'Agent', email: 'agent@bork.nl', role: 'admin' },
    ...extra,
  };
}

export function createRequest(body, { headers = {}, auth = true } = {}) {
  return new Request('https://secrets.test/api/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}), ...headers },
    body: JSON.stringify(body),
  });
}

/** Replaces global fetch with a SendGrid mock; returns the captured calls. */
export function mockSendGrid({ status = 202 } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(null, { status, headers: { 'x-message-id': 'msg-1' } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export function extractLink(call) {
  const text = call.body.content.find((c) => c.type === 'text/plain').value;
  const link = text.match(/https:\/\/\S+\/s\/\S+/)[0];
  const [, id, token] = link.match(/\/s\/([^#]+)#(.+)$/);
  return { link, id, token };
}

export function revealRequest(id, token) {
  return new Request(`https://secrets.test/api/shares/${id}/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(token === undefined ? {} : { token }),
  });
}
