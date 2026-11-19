/**
 * Regresión de seguridad (hallazgo 7): la CSP solo permite scripts propios, y
 * ninguna página depende de scripts inline, manejadores on*="" ni CDN de terceros.
 * Así un texto inyectado no se ejecuta ni puede leer el token de sesión.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'csp-test-secret';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';

const app = require('../app');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PAGES = fs.readdirSync(PUBLIC_DIR).filter(file => file.endsWith('.html'));

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

function parseCsp(header) {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const [name, ...values] = part.split(/\s+/);
    return [name, values];
  }));
}

test('CSP only allows same-origin scripts and blocks inline handlers, plugins and framing', async () => {
  const response = await fetch(`${baseUrl}/emergency.html`);
  const csp = parseCsp(response.headers.get('content-security-policy'));

  assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.deepEqual(csp['script-src-attr'], ["'none'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['connect-src'], ["'self'"]);
  assert.deepEqual(csp['img-src'], ["'self'", 'data:', 'blob:'], 'sin imágenes de cualquier dominio');
});

test('every HTML page loads only same-origin scripts, without inline code or on*= handlers', async () => {
  assert.ok(PAGES.length >= 5, `páginas encontradas: ${PAGES.join(', ')}`);
  for (const page of PAGES) {
    const response = await fetch(`${baseUrl}/${page}`);
    assert.equal(response.status, 200, page);
    const html = await response.text();

    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attributes, body] of scripts) {
      const src = attributes.match(/\bsrc="([^"]+)"/)?.[1];
      assert.ok(src, `${page}: script inline no permitido`);
      assert.equal(body.trim(), '', `${page}: un script con src no debe tener código`);
      assert.match(src, /^\/[^/]/, `${page}: script externo no permitido (${src})`);

      const file = await fetch(`${baseUrl}${src}`);
      assert.equal(file.status, 200, `${page}: ${src} existe`);
    }
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${page}: manejador on*="" no permitido`);
    assert.doesNotMatch(html, /tailwindcss|unpkg\.com|jsdelivr|cdnjs/i, `${page}: sin CDN de scripts`);
  }
});

test('API docs page works under the strict CSP (no inline scripts)', async () => {
  const response = await fetch(`${baseUrl}/api-docs/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc=/.test(attributes));
  assert.deepEqual(inline, []);
});

test('the unused legacy dashboard script (unescaped innerHTML) is no longer served', async () => {
  const response = await fetch(`${baseUrl}/js/dashboard.js`);
  assert.equal(response.status, 404);
});
