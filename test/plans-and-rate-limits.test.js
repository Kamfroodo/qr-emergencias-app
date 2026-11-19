/**
 * Regresión de seguridad:
 *  - Los planes pagados los asigna el administrador al invitar; el usuario no
 *    puede elegirlos al aceptar la invitación ni cambiarlos después.
 *  - Límite de intentos en login, invitaciones y ficha pública de emergencia.
 *
 * Cada archivo de prueba corre en su propio proceso, así que los contadores
 * de los limitadores empiezan en cero aquí.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'plans-and-rate-limits-test-secret';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';

const app = require('../app');
const { createLocalUserForTests } = require('../auth');

const ADMIN_EMAIL = 'plans-admin@example.com';
const ADMIN_PASSWORD = 'admin-secure-password';

let server;
let baseUrl;
let adminToken;

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'X-Auth-Mode': 'bearer', // clientes de API: reciben el token en la respuesta del login
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, body: await response.json().catch(() => null) };
}

async function login(email, password) {
  return request('/api/auth/login', { method: 'POST', body: { email, password } });
}

async function inviteAndAccept({ email, plan, clientPlan }) {
  const created = await request('/api/auth/admin/invitations', {
    method: 'POST',
    body: { email, fullName: 'Plan Tester', plan },
    token: adminToken,
  });
  assert.equal(created.response.status, 201);
  const token = new URL(created.body.invitationUrl).searchParams.get('token');
  const accepted = await request('/api/auth/invitation/accept', {
    method: 'POST',
    body: { token, password: 'member-secure-password', ...(clientPlan ? { plan: clientPlan } : {}) },
  });
  assert.equal(accepted.response.status, 201);
  return { created, token, user: accepted.body.user };
}

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await createLocalUserForTests({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, fullName: 'Plans Admin', role: 'admin' });
  adminToken = (await login(ADMIN_EMAIL, ADMIN_PASSWORD)).body.token;
});

after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

// ------------------------------------------------------------------
// Planes
// ------------------------------------------------------------------

test('admin must choose a valid plan when creating an invitation', async () => {
  for (const plan of [undefined, '', 'gratis', 'premium']) {
    const result = await request('/api/auth/admin/invitations', {
      method: 'POST',
      body: { email: `no-plan-${randomUUID()}@example.com`, fullName: 'No Plan', ...(plan !== undefined ? { plan } : {}) },
      token: adminToken,
    });
    assert.equal(result.response.status, 400, `plan=${plan}`);
  }
});

test('the invitation plan is applied on acceptance and the client cannot override it', async () => {
  const email = `individual-${randomUUID()}@example.com`;
  const { created, token, user } = await inviteAndAccept({ email, plan: 'individual', clientPlan: 'institucion' });

  assert.equal(created.body.invitation.plan, 'individual');
  assert.equal(user.maxProfiles, 1, 'el plan enviado por el cliente debe ignorarse');
  const expiresInDays = (new Date(user.accountExpiresAt) - Date.now()) / 86_400_000;
  assert.ok(expiresInDays > 360 && expiresInDays < 370, `vence en ~1 año (${expiresInDays} días)`);

  // El enlace ya usado no revela el plan ni sirve otra vez.
  assert.equal((await request(`/api/auth/invitation/${token}`)).response.status, 410);
});

test('invitation details show the assigned plan before acceptance', async () => {
  const created = await request('/api/auth/admin/invitations', {
    method: 'POST',
    body: { email: `familiar-${randomUUID()}@example.com`, fullName: 'Familiar Tester', plan: 'familiar' },
    token: adminToken,
  });
  const token = new URL(created.body.invitationUrl).searchParams.get('token');
  const details = await request(`/api/auth/invitation/${token}`);
  assert.equal(details.response.status, 200);
  assert.equal(details.body.plan, 'familiar');

  const listed = await request('/api/auth/admin/invitations', { token: adminToken });
  assert.equal(listed.body.find(invitation => invitation.id === created.body.invitation.id).plan, 'familiar');
});

test('users cannot assign or renew their own plan', async () => {
  const email = `self-plan-${randomUUID()}@example.com`;
  await inviteAndAccept({ email, plan: 'individual' });
  const memberToken = (await login(email, 'member-secure-password')).body.token;
  const before = await request('/api/auth/me', { token: memberToken });

  for (const plan of ['institucion', 'familiar', 'individual']) {
    const attempt = await request('/api/auth/select-plan', { method: 'POST', body: { plan }, token: memberToken });
    assert.equal(attempt.response.status, 403);
    assert.equal(attempt.body.code, 'PLAN_ASSIGNED_BY_ADMIN');
  }

  const afterAttempts = await request('/api/auth/me', { token: memberToken });
  assert.equal(afterAttempts.body.maxProfiles, 1);
  assert.equal(afterAttempts.body.accountExpiresAt, before.body.accountExpiresAt);
});

// ------------------------------------------------------------------
// Límites de intentos
// ------------------------------------------------------------------

test('login locks an account after 10 failed attempts from the same IP, without blocking other accounts', async () => {
  const email = `bruteforce-${randomUUID()}@example.com`;
  await inviteAndAccept({ email, plan: 'individual' });

  for (let attempt = 1; attempt <= 10; attempt++) {
    const failed = await login(email, `wrong-password-${attempt}`);
    assert.equal(failed.response.status, 401, `intento ${attempt}`);
  }

  const blocked = await login(email, 'member-secure-password');
  assert.equal(blocked.response.status, 429, 'incluso la contraseña correcta queda bloqueada');
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.ok(blocked.response.headers.get('retry-after'), 'indica cuándo reintentar');

  const otherAccount = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(otherAccount.response.status, 200, 'otras cuentas siguen funcionando');
});

test('successful logins do not count toward the limit', async () => {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const result = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.equal(result.response.status, 200, `inicio de sesión ${attempt}`);
  }
});

test('invitation endpoints are rate limited', async () => {
  const fakeToken = 'A'.repeat(43);
  let last;
  for (let attempt = 1; attempt <= 25; attempt++) {
    last = await request(`/api/auth/invitation/${fakeToken}`);
  }
  assert.equal(last.response.status, 429);
  assert.equal(last.body.code, 'RATE_LIMITED');

  const accept = await request('/api/auth/invitation/accept', {
    method: 'POST',
    body: { token: fakeToken, password: 'member-secure-password' },
  });
  assert.equal(accept.response.status, 429);
});

test('public emergency endpoint allows 120 requests per minute and then returns 429', async () => {
  const unknownToken = randomUUID();
  for (let attempt = 1; attempt <= 120; attempt++) {
    const result = await request(`/api/v1/emergency/${unknownToken}`);
    assert.equal(result.response.status, 404, `consulta ${attempt}`);
  }
  const blocked = await request(`/api/v1/emergency/${unknownToken}`);
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
});
