const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function formatExpiry(iso) {
  return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(iso));
}

export function buildEmail({ link, expiresAt, senderName, customerName, message }) {
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

  const html = `<!doctype html><html lang="nl"><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#000015">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #d9dee5">
<tr><td style="background:#004070;padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold">Bork Support</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">
<p style="margin:0 0 12px">${esc(who)} heeft een geheim met je gedeeld.</p>
${customerName ? `<p style="margin:0 0 12px">Klant: <strong>${esc(customerName)}</strong></p>` : ''}
${message ? `<p style="margin:0 0 12px;padding:10px 12px;background:#f3f5f8;white-space:pre-wrap">${esc(message)}</p>` : ''}
<p style="margin:0 0 12px">De link kan <strong>slechts één keer</strong> worden geopend. De link verloopt op <strong>${esc(expiry)}</strong>.</p>
<p style="margin:20px 0"><a href="${esc(link)}" style="background:#ffcc00;color:#000015;padding:12px 20px;text-decoration:none;font-weight:bold;display:inline-block">Geheim bekijken</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#4a5568">Werkt de knop niet? Kopieer deze link:<br>${esc(link)}</p>
<p style="margin:0;font-size:13px;color:#4a5568"><strong>Stuur deze e-mail niet door.</strong> Wie de link heeft, kan het geheim tonen.</p>
</td></tr></table></td></tr></table></body></html>`;

  return { text, html };
}

/** Returns { messageId }. Throws an Error with `status` (never the response body) on failure. */
export async function sendShareEmail(env, { to, link, expiresAt, senderName, customerName, message }) {
  const { text, html } = buildEmail({ link, expiresAt, senderName, customerName, message });
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
