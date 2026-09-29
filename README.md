# Bork Secret Share

One-time secret sharing for Bork Support Hub on Cloudflare Pages Functions, KV, D1 and SendGrid.

- `POST /api/shares` (bearer auth, server-to-server): encrypts the secret (AES-256-GCM) into KV, emails a one-time link `/s/<id>#<token>`.
- `GET /api/shares/:id/status`: public, never consumes.
- `POST /api/shares/:id/reveal`: consumes once (atomic D1 conditional update), deletes the KV payload.
- `GET /api/admin/logs`: bearer auth, metadata-only permanent log.
- UI: `public/` (plain HTML/JS, `_redirects` routes `/s/*` to `index.html`).

## Deploy

```bash
npm install
wrangler d1 create bork_secret_share        # put the id in wrangler.toml
wrangler kv namespace create SECRETS_KV     # put the ids in wrangler.toml
npm run migrate:remote
wrangler pages project create bork-secret-share --production-branch main
openssl rand -base64 32 | wrangler pages secret put APP_ENCRYPTION_KEY --project-name bork-secret-share
wrangler pages secret put SENDGRID_API_KEY --project-name bork-secret-share
wrangler pages secret put SUPPORT_HUB_API_TOKEN --project-name bork-secret-share
wrangler pages secret put FROM_EMAIL --project-name bork-secret-share
npm run deploy
```

After adding the `secrets.bork.nl` CNAME, change `PUBLIC_BASE_URL`; nothing else needs to change.

Never rotate `APP_ENCRYPTION_KEY` while unrevealed shares exist; they would become undecryptable.

## Test

`npm test` (Node 22+, uses `node:sqlite` to run the real migration against a D1 stand-in).
