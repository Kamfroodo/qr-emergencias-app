/**
 * Sesión en cookie httpOnly:
 *  - El login del navegador pone una cookie httpOnly + SameSite=Strict y no
 *    devuelve el token en el cuerpo (salvo X-Auth-Mode: bearer, para APIs).
 *  - Con cookie, las acciones que modifican datos exigen X-Requested-With (CSRF).
 *  - El login solo acepta JSON (evita iniciar sesión desde un formulario ajeno).
 *  - El frontend ya no guarda el token en localStorage.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'session-cookie-test-secret';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';

const app = require('../app');
const { createLocalUserForTests, SESSION_COOKIE } = require('../auth');

const EMAIL = `cookie-${randomUUID()}@example.com`;
const PASSWORD = 'cookie-secure-password';
const CSRF = { 'X-Requested-With': 'fetch' };

let server;
let baseUrl;

async function call(urlPath, { method = 'GET', body, headers = {}, rawBody } = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: rawBody ?? (body ? JSON.stringify(body) : undefined),
  });
  return { response, body: await response.json().catch(() => null) };
}

function sessionCookieFrom(response) {
  const header = response.headers.getSetCookie().find(value => value.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(header, 'la respuesta pone la cookie de sesión');
  return header;
}

async function loginCookie() {
  const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD }, headers: CSRF });
  assert.equal(login.response.status, 200);
  return sessionCookieFrom(login.response).split(';')[0];
}

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await createLocalUserForTests({ email: EMAIL, password: PASSWORD, fullName: 'Cookie User', role: 'user' });
});

after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('browser login sets an httpOnly, SameSite=Strict session cookie and does not return the token', async () => {
  const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD }, headers: CSRF });
  assert.equal(login.response.status, 200);
  assert.equal(Object.hasOwn(login.body, 'token'), false, 'el navegador no recibe el token');
  assert.equal(login.body.user.email, EMAIL);

  const cookie = sessionCookieFrom(login.response);
  assert.match(cookie, /;\s*HttpOnly/i);
  assert.match(cookie, /;\s*SameSite=Strict/i);
  assert.match(cookie, /;\s*Path=\//i);
  const maxAge = Number(cookie.match(/Max-Age=(\d+)/i)?.[1]);
  assert.ok(maxAge > 23 * 3600 && maxAge <= 24 * 3600, `vence con el JWT (${maxAge}s)`);
});

test('API clients can still ask for a bearer token', async () => {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
    headers: { 'X-Auth-Mode': 'bearer' },
  });
  assert.equal(login.response.status, 200);
  assert.match(login.body.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);

  const me = await call('/api/auth/me', { headers: { Authorization: `Bearer ${login.body.token}` } });
  assert.equal(me.response.status, 200);

  // Con Bearer no hace falta la cabecera anti-CSRF (no la envía el navegador solo).
  const created = await call('/api/profiles', {
    method: 'POST',
    body: { fullName: 'Ficha API', bloodType: 'O+' },
    headers: { Authorization: `Bearer ${login.body.token}` },
  });
  assert.equal(created.response.status, 201);
});

test('the session cookie authenticates reads', async () => {
  const cookie = await loginCookie();
  assert.equal((await call('/api/auth/me', { headers: { Cookie: cookie } })).response.status, 200);
  assert.equal((await call('/api/profiles', { headers: { Cookie: cookie } })).response.status, 200);
  assert.equal((await call('/api/profiles')).response.status, 401, 'sin cookie ni token no hay acceso');
});

test('with a cookie, state-changing requests require the anti-CSRF header', async () => {
  const cookie = await loginCookie();

  const forged = await call('/api/profiles', { method: 'POST', body: { fullName: 'CSRF', bloodType: 'A+' }, headers: { Cookie: cookie } });
  assert.equal(forged.response.status, 403);
  assert.equal(forged.body.code, 'CSRF_HEADER_REQUIRED');

  const created = await call('/api/profiles', {
    method: 'POST',
    body: { fullName: 'Ficha Navegador', bloodType: 'A+' },
    headers: { Cookie: cookie, ...CSRF },
  });
  assert.equal(created.response.status, 201);

  for (const [method, urlPath] of [
    ['PUT', `/api/profiles/${created.body.id}`],
    ['PATCH', `/api/profiles/${created.body.id}/status`],
    ['POST', `/api/profiles/${created.body.id}/rotate-token`],
    ['DELETE', `/api/profiles/${created.body.id}`],
  ]) {
    const result = await call(urlPath, { method, body: { fullName: 'X' }, headers: { Cookie: cookie } });
    assert.equal(result.response.status, 403, `${method} ${urlPath}`);
  }
  assert.equal((await call(`/api/profiles/${created.body.id}`, { headers: { Cookie: cookie } })).response.status, 200, 'la ficha sigue intacta');
});

test('login only accepts JSON, so a cross-site form cannot log the victim in', async () => {
  const form = await call('/api/auth/login', {
    method: 'POST',
    rawBody: new URLSearchParams({ email: EMAIL, password: PASSWORD }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(form.response.status, 415);
  assert.equal(form.response.headers.getSetCookie().length, 0);
});

test('logout clears the cookie and requires the anti-CSRF header', async () => {
  assert.equal((await call('/api/auth/logout', { method: 'POST' })).response.status, 403);

  const logout = await call('/api/auth/logout', { method: 'POST', headers: CSRF });
  assert.equal(logout.response.status, 200);
  const cleared = sessionCookieFrom(logout.response);
  assert.match(cleared, new RegExp(`^${SESSION_COOKIE}=;`));
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/i);
});

test('a tampered cookie is rejected', async () => {
  const result = await call('/api/auth/me', { headers: { Cookie: `${SESSION_COOKIE}=not.a.jwt` } });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.code, 'TOKEN_INVALID');
});

test('the frontend no longer stores the session token in localStorage', () => {
  for (const file of ['auth.js', 'login.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8');
    assert.doesNotMatch(source, /setItem\([^)]*token/i, `${file}: no guarda el token`);
    assert.doesNotMatch(source, /Authorization/, `${file}: no arma cabeceras Bearer`);
    assert.match(source, /X-Requested-With/, `${file}: envía la cabecera anti-CSRF`);
  }
});
