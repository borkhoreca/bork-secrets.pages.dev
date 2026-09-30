const app = document.getElementById('app');

// Read the reveal token from the fragment, then remove it from the address bar/history.
const shareId = location.pathname.match(/^\/s\/([^/]+)\/?$/)?.[1] ?? null;
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);

let secret = null; // in page memory only

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function show(title, ...body) {
  app.replaceChildren(el('p', { className: 'eyebrow' }, 'Bork Support'), el('h1', {}, title), ...body);
}

const info = (text) => el('p', {}, text);
const fmt = (iso) => new Intl.DateTimeFormat('nl-NL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));

const invalid = () => show('Ongeldige link', info('Deze link is ongeldig. Vraag Bork Support om een nieuwe link.'));
const consumed = () => show('Al bekeken', info('Dit geheim is al getoond en kan niet opnieuw worden opgevraagd. Vraag Bork Support om een nieuwe link als dat nodig is.'));
const expired = () => show('Link verlopen', info('Deze link is verlopen. Vraag Bork Support om een nieuwe link.'));
const failure = () => show('Er ging iets mis', info('Het geheim kon niet worden opgehaald. Probeer het later opnieuw of neem contact op met Bork Support.'));

function revealed(value) {
  secret = value;
  const copy = el('button', { type: 'button', className: 'secondary' }, 'Kopieer');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(secret);
      copy.textContent = 'Gekopieerd';
    } catch {
      copy.textContent = 'Kopiëren mislukt, selecteer de tekst handmatig';
    }
  });
  show(
    'Je geheim',
    el('div', { className: 'secret' }, secret),
    el('div', { className: 'actions' }, copy),
    el('p', { className: 'warn' }, 'Kopieer het geheim nu. Als je deze pagina ververst of verlaat, kun je het niet opnieuw bekijken.'),
  );
}

function ready(status) {
  const button = el('button', { type: 'button' }, 'Toon geheim');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const res = await fetch(`/api/shares/${encodeURIComponent(shareId)}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return revealed(data.secretValue);
      if (data.code === 'SHARE_CONSUMED') return consumed();
      if (data.code === 'SHARE_EXPIRED') return expired();
      if (res.status === 401 || res.status === 404 || res.status === 400) return invalid();
      failure();
    } catch {
      failure();
    }
  });
  show(
    'Bork Support heeft een geheim met je gedeeld',
    status.customerName ? el('p', {}, el('span', { className: 'customer' }, `Klant: ${status.customerName}`)) : '',
    info('Dit geheim kan slechts één keer worden getoond. Zorg dat je klaar bent om het direct te kopiëren.'),
    el('p', { className: 'muted' }, `Beschikbaar tot ${fmt(status.expiresAt)}.`),
    button,
  );
}

async function init() {
  if (!shareId || !token) return invalid();
  try {
    const res = await fetch(`/api/shares/${encodeURIComponent(shareId)}/status`, { cache: 'no-store' });
    const status = await res.json();
    if (status.status === 'active') return ready(status);
    if (status.status === 'consumed') return consumed();
    if (status.status === 'expired') return expired();
    invalid();
  } catch {
    failure();
  }
}

init();
