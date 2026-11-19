/**
 * Regresión de seguridad (hallazgo 8): registro de accesos a fichas médicas.
 *  - Se registran escaneos (con su resultado) y acciones de titular/admin.
 *  - El titular ve los escaneos de sus fichas, sin datos de quien escaneó.
 *  - Solo el admin ve el registro completo; nunca se guarda la IP real.
 *  - Lo anterior a 180 días no se muestra.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'access-logs-test-secret';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';

const app = require('../app');
const { createLocalUserForTests } = require('../auth');
const accessLog = require('../accessLog');

const PASSWORD = 'access-logs-secure-password';
const DAY = 24 * 60 * 60 * 1000;

let server;
let baseUrl;
let owner;
let other;
let admin;

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, body: await response.json().catch(() => null) };
}

async function createUser(role) {
  const email = `${role}-${randomUUID()}@example.com`;
  const user = await createLocalUserForTests({ email, password: PASSWORD, fullName: `Logs ${role}`, role });
  const login = await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  return { ...user, token: login.body.token };
}

async function createProfile(token) {
  const created = await request('/api/profiles', { method: 'POST', body: { fullName: 'Paciente Logs', bloodType: 'A-' }, token });
  assert.equal(created.response.status, 201);
  return created.body;
}

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  owner = await createUser('user');
  other = await createUser('user');
  admin = await createUser('admin');
});

after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('scans are logged with their outcome and the owner sees them without scanner data', async () => {
  const profile = await createProfile(owner.token);

  assert.equal((await request(`/api/v1/emergency/${profile.public_token}`)).response.status, 200);
  await request(`/api/profiles/${profile.id}/status`, { method: 'PATCH', body: { is_active: false }, token: owner.token });
  assert.equal((await request(`/api/v1/emergency/${profile.public_token}`)).response.status, 403);

  const logs = await request(`/api/profiles/${profile.id}/access-logs`, { token: owner.token });
  assert.equal(logs.response.status, 200);
  assert.deepEqual(logs.body.map(entry => [entry.event, entry.outcome]), [
    ['public_scan', 'paused'],
    ['public_scan', 'ok'],
  ]);
  for (const entry of logs.body) {
    assert.deepEqual(Object.keys(entry).sort(), ['createdAt', 'event', 'outcome'], 'sin huella de IP ni IDs');
  }
});

test('unknown tokens are not logged', async () => {
  const before = (await request('/api/admin/access-logs?limit=500', { token: admin.token })).body.length;
  assert.equal((await request(`/api/v1/emergency/${randomUUID()}`)).response.status, 404);
  const afterScan = (await request('/api/admin/access-logs?limit=500', { token: admin.token })).body.length;
  assert.equal(afterScan, before);
});

test('owners cannot read other profiles logs; anonymous users cannot read any', async () => {
  const profile = await createProfile(owner.token);
  assert.equal((await request(`/api/profiles/${profile.id}/access-logs`, { token: other.token })).response.status, 404);
  assert.equal((await request(`/api/profiles/${profile.id}/access-logs`)).response.status, 401);
  assert.equal((await request('/api/admin/access-logs', { token: other.token })).response.status, 403);
  assert.equal((await request('/api/admin/access-logs')).response.status, 401);
});

test('admin and owner actions are logged with the actor; owners only see scans and QR regenerations', async () => {
  const profile = await createProfile(owner.token);

  await request(`/api/admin/profiles/${profile.id}`, { token: admin.token });
  await request(`/api/admin/profiles/${profile.id}/qr`, { token: admin.token });
  await request(`/api/admin/profiles/${profile.id}/rotate-token`, { method: 'POST', token: admin.token });
  await request(`/api/profiles/${profile.id}/rotate-token`, { method: 'POST', token: owner.token });

  const adminView = await request(`/api/admin/access-logs?profileId=${profile.id}`, { token: admin.token });
  assert.equal(adminView.response.status, 200);
  assert.deepEqual(adminView.body.map(entry => [entry.event, entry.actorUserId]), [
    ['owner_rotate_qr', owner.id],
    ['admin_rotate_qr', admin.id],
    ['admin_view_qr', admin.id],
    ['admin_view_profile', admin.id],
  ]);
  assert.ok(adminView.body.every(entry => entry.profileOwnerId === owner.id));

  const ownerView = await request(`/api/profiles/${profile.id}/access-logs`, { token: owner.token });
  assert.deepEqual(ownerView.body.map(entry => entry.event), ['owner_rotate_qr', 'admin_rotate_qr']);

  await request(`/api/admin/profiles/${profile.id}`, { method: 'DELETE', token: admin.token });
  const afterDelete = await request(`/api/admin/access-logs?profileId=${profile.id}`, { token: admin.token });
  assert.equal(afterDelete.body[0].event, 'admin_delete_profile', 'el registro sobrevive a la eliminación');
});

test('the real IP is never stored or returned, only a 16-character fingerprint', async () => {
  const profile = await createProfile(owner.token);
  await request(`/api/v1/emergency/${profile.public_token}`);

  const logs = await request(`/api/admin/access-logs?profileId=${profile.id}`, { token: admin.token });
  const scan = logs.body.find(entry => entry.event === 'public_scan');
  assert.equal(scan.actorUserId, null);
  assert.match(scan.ipHash, /^[0-9a-f]{16}$/);
  assert.equal(scan.ipHash, accessLog.ipFingerprint('127.0.0.1'));
  assert.doesNotMatch(JSON.stringify(logs.body), /127\.0\.0\.1|::1|::ffff/);
});

test('entries older than 180 days are not returned', async () => {
  const profileId = randomUUID();
  await accessLog.recordAccess({ event: 'public_scan', profileId, at: new Date(Date.now() - 181 * DAY) });
  await accessLog.recordAccess({ event: 'public_scan', profileId, at: new Date(Date.now() - 179 * DAY) });

  const entries = await accessLog.listAccessLogs({ profileId });
  assert.equal(entries.length, 1);
  assert.ok(Date.now() - new Date(entries[0].createdAt) < 180 * DAY);
});

test('invalid events are ignored and logging never throws', async () => {
  await assert.doesNotReject(accessLog.recordAccess({ event: 'made_up_event' }));
  await assert.doesNotReject(accessLog.recordAccess({ event: 'public_scan', outcome: 'weird' }));
  assert.equal((await request('/api/admin/access-logs?profileId=not-a-uuid', { token: admin.token })).response.status, 400);
});

test('account deletion by an admin is logged', async () => {
  const doomed = await createUser('user');
  const deleted = await request(`/api/auth/admin/users/${doomed.id}`, { method: 'DELETE', token: admin.token });
  assert.equal(deleted.response.status, 200);

  const logs = await request(`/api/admin/access-logs?ownerId=${doomed.id}`, { token: admin.token });
  assert.deepEqual(logs.body.map(entry => [entry.event, entry.actorUserId]), [['admin_delete_user', admin.id]]);
});
