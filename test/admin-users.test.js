const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'admin-users-test-secret';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';

const app = require('../app');
const { setLocalUserRoleForTests } = require('../auth');

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

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, body: await response.json() };
}

async function register(email, fullName) {
  const { response, body } = await request('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'secure-test-password', fullName },
  });
  assert.equal(response.status, 201);
  return body.user;
}

async function login(email) {
  const { response, body } = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'secure-test-password' },
  });
  assert.equal(response.status, 200);
  return body.token;
}

test('only admins can administer accounts, and account actions immediately affect sessions and profiles', async () => {
  const adminPage = await fetch(`${baseUrl}/admin.html`);
  assert.equal(adminPage.status, 200);
  const adminStyle = await fetch(`${baseUrl}/css/admin.css`);
  assert.equal(adminStyle.status, 200);
  const adminScript = await fetch(`${baseUrl}/js/admin.js`);
  assert.equal(adminScript.status, 200);

  const docsResponse = await fetch(`${baseUrl}/api-docs.json`);
  const docs = await docsResponse.json();
  for (const path of [
    '/api/auth/admin/users',
    '/api/auth/admin/users/{id}/status',
    '/api/auth/admin/users/{id}/role',
    '/api/auth/admin/users/{id}',
  ]) {
    assert.ok(docs.paths[path]);
  }

  const suffix = randomUUID();
  const adminEmail = `admin-${suffix}@example.com`;
  const memberEmail = `member-${suffix}@example.com`;
  const admin = await register(adminEmail, 'Platform Admin');
  const member = await register(memberEmail, 'Platform Member');

  setLocalUserRoleForTests(admin.id, 'admin');
  const adminToken = await login(adminEmail);
  const memberToken = await login(memberEmail);

  const unauthenticated = await request('/api/auth/admin/users');
  assert.equal(unauthenticated.response.status, 401);

  const forbidden = await request('/api/auth/admin/users', { token: memberToken });
  assert.equal(forbidden.response.status, 403);

  const listed = await request('/api/auth/admin/users', { token: adminToken });
  assert.equal(listed.response.status, 200);
  assert.ok(listed.body.some(user => user.id === member.id));
  assert.ok(listed.body.every(user => !Object.hasOwn(user, 'password_hash')));

  const selfRole = await request(`/api/auth/admin/users/${admin.id}/role`, {
    method: 'PATCH',
    body: { role: 'user' },
    token: adminToken,
  });
  assert.equal(selfRole.response.status, 400);

  const createProfile = await request('/api/profiles', {
    method: 'POST',
    body: { fullName: 'Member Emergency Profile', bloodType: 'O+' },
    token: memberToken,
  });
  assert.equal(createProfile.response.status, 201);

  const suspended = await request(`/api/auth/admin/users/${member.id}/status`, {
    method: 'PATCH',
    body: { isActive: false },
    token: adminToken,
  });
  assert.equal(suspended.response.status, 200);
  assert.equal(suspended.body.isActive, false);

  const suspendedSession = await request('/api/profiles', { token: memberToken });
  assert.equal(suspendedSession.response.status, 401);
  const suspendedLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: memberEmail, password: 'secure-test-password' },
  });
  assert.equal(suspendedLogin.response.status, 403);

  const reactivated = await request(`/api/auth/admin/users/${member.id}/status`, {
    method: 'PATCH',
    body: { isActive: true },
    token: adminToken,
  });
  assert.equal(reactivated.response.status, 200);
  assert.equal(reactivated.body.isActive, true);

  const promoted = await request(`/api/auth/admin/users/${member.id}/role`, {
    method: 'PATCH',
    body: { role: 'admin' },
    token: adminToken,
  });
  assert.equal(promoted.response.status, 200);
  assert.equal(promoted.body.role, 'admin');
  const promotedAccess = await request('/api/auth/admin/users', { token: memberToken });
  assert.equal(promotedAccess.response.status, 200);

  const deleted = await request(`/api/auth/admin/users/${member.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(deleted.response.status, 200);
  assert.match(deleted.body.message, /perfiles asociados eliminados/);

  const deletedAccountCannotLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: memberEmail, password: 'secure-test-password' },
  });
  assert.equal(deletedAccountCannotLogin.response.status, 401);
  const deletedProfileCannotBeFetched = await request(`/api/v1/emergency/${createProfile.body.public_token}`);
  assert.equal(deletedProfileCannotBeFetched.response.status, 404);

  const selfDelete = await request(`/api/auth/admin/users/${admin.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(selfDelete.response.status, 400);
});
