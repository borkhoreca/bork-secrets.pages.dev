const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function formatExpiry(iso) {
  return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(iso));
}

export function buildEmail({ link, expiresAt, senderName, customerName, message, baseUrl = 'https://bork-secret-share.pages.dev' }) {
  const expiry = formatExpiry(expiresAt);
  const who = senderName ? `${senderName} van Bork Support` : 'Bork Support';

  const text = [
    `${who} heeft een geheim met je gedeeld (Bork Support sent a one-time secret).`,
    customerName ? `Klant: ${customerName}` : null,
    message ? `\nBericht:\n${message}` : null,
    '',
    'De link kan slechts één keer worden geopend. Daarna is het geheim niet meer beschikbaar.',
    `De link verloopt op ${expiry} (Nederlandse tijd).`,
    '',
    link,
    '',
    'Stuur deze e-mail niet door. Wie de link heeft, kan het geheim tonen.',
  ].filter((l) => l !== null).join('\n');

  const logo = `${baseUrl}/assets/email-logo-white.png`;
  const font = "Gotham,'Helvetica Neue',Arial,sans-serif";
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Bork Support</title></head>
<body style="margin:0;padding:0;background:#000015;font-family:${font};color:#000000">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(who)} heeft een geheim met je gedeeld. De link kan één keer worden geopend.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000015"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td bgcolor="#000015" style="background:#000015;background-image:linear-gradient(135deg,#004070 0%,#000015 60%,#000000 100%);padding:40px 40px 44px;border-radius:6px 6px 0 0">
<img src="${esc(logo)}" width="140" alt="Bork" style="display:block;border:0;width:140px;height:auto;margin:0 0 48px">
<div style="font-family:${font};font-size:14px;font-weight:900;color:#ffcc00;margin:0 0 6px">Veilig gedeeld</div>
<div style="font-family:${font};font-size:32px;line-height:36px;font-weight:900;color:#ffffff;text-transform:uppercase;margin:0">Een geheim<br>voor jou</div>
</td></tr>
<tr><td style="background:#ffffff;padding:36px 40px 12px;font-family:${font};font-size:16px;line-height:24px;font-weight:300;color:#000000">
<p style="margin:0 0 16px"><strong>${esc(who)}</strong> heeft een geheim met je gedeeld.</p>
${customerName ? `<p style="margin:0 0 16px;font-size:14px;color:#004070;font-weight:bold;text-transform:uppercase;letter-spacing:.5px">Klant: ${esc(customerName)}</p>` : ''}
${message ? `<p style="margin:0 0 20px;padding:12px 16px;background:#f3f5f8;border-left:4px solid #ffcc00;white-space:pre-wrap">${esc(message)}</p>` : ''}
<p style="margin:0 0 28px">De link kan <strong>slechts één keer</strong> worden geopend en verloopt op <strong>${esc(expiry)}</strong>.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px"><tr><td bgcolor="#ffcc00" style="background:#ffcc00;border-radius:4px">
<a href="${esc(link)}" style="display:inline-block;padding:16px 32px;font-family:${font};font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:#000000;text-decoration:none">Geheim bekijken</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:#4a5568">Werkt de knop niet? Kopieer deze link in je browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p style="margin:0 0 24px;padding:12px 16px;background:#fff9e0;border-left:4px solid #ffcc00;font-size:14px;line-height:20px"><strong>Stuur deze e-mail niet door.</strong> Wie de link heeft, kan het geheim tonen.</p>
</td></tr>
<tr><td bgcolor="#000000" style="background:#000000;padding:24px 40px 28px;border-radius:0 0 6px 6px;font-family:${font};font-size:12px;line-height:18px;color:#a9b3c1">
<div style="font-size:13px;font-weight:900;text-transform:uppercase;color:#ffffff;margin:0 0 12px">Happy guests, <span style="font-weight:300;color:#ffcc00">better business</span></div>
24/7 support via 0161 70 00 10<br>Nerhoven 8a, 5126 TB Gilze &middot; <a href="https://www.bork.nl" style="color:#a9b3c1">www.bork.nl</a>
</td></tr>
</table></td></tr></table></body></html>`;

  return { text, html };
}

/** Returns { messageId }. Throws an Error with `status` (never the response body) on failure. */
export async function sendShareEmail(env, { to, link, expiresAt, senderName, customerName, message }) {
  const baseUrl = String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') || undefined;
  const { text, html } = buildEmail({ link, expiresAt, senderName, customerName, message, baseUrl });
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: env.FROM_EMAIL, name: env.FROM_NAME || 'Bork Support' },
    subject: 'Bork Support heeft een veilig geheim met je gedeeld',
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html', value: html },
    ],
    // Keep the one-time link out of SendGrid click-tracking redirects.
    tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
  };
  if (env.REPLY_TO_EMAIL) payload.reply_to = { email: env.REPLY_TO_EMAIL };

  const res = await fetch(SENDGRID_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = new Error(`SendGrid responded with status ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return { messageId: res.headers.get('x-message-id') };
}
