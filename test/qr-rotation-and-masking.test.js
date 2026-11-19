/**
 * Regresión de seguridad (hallazgo 3 del modelo de amenazas):
 *  - La ficha pública enmascara el RUT y el número de póliza.
 *  - El titular y el admin pueden regenerar el QR; el anterior deja de funcionar.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'qr-rotation-test-secret';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';

const app = require('../app');
const { createLocalUserForTests } = require('../auth');

const PASSWORD = 'qr-rotation-secure-password';

let server;
let baseUrl;
let ownerToken;
let otherToken;
let adminToken;

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

async function userToken(role) {
  const email = `${role}-${randomUUID()}@example.com`;
  await createLocalUserForTests({ email, password: PASSWORD, fullName: `QR ${role}`, role });
  const login = await request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  assert.equal(login.response.status, 200);
  return login.body.token;
}

async function createProfile(token, extra = {}) {
  const created = await request('/api/profiles', {
    method: 'POST',
    body: { fullName: 'Paciente QR', bloodType: 'B+', ...extra },
    token,
  });
  assert.equal(created.response.status, 201);
  return created.body;
}

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  ownerToken = await userToken('user');
  otherToken = await userToken('user');
  adminToken = await userToken('admin');
});

after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('public emergency profile masks national id and policy number but keeps the rest', async () => {
  const profile = await createProfile(ownerToken, {
    nationalId: '12.345.678-9',
    insurance: { company: 'Isapre Salud', policyNumber: 'POL-99887766', emergencyLine: '600 123 4567' },
    preferredHospital: 'Hospital Central',
  });

  const publicView = await request(`/api/v1/emergency/${profile.public_token}`);
  assert.equal(publicView.response.status, 200);
  const body = publicView.body;

  assert.equal(body.nationalId, '•••••5.678-9');
  assert.equal(body.national_id, '•••••5.678-9');
  assert.equal(body.insurance.policyNumber, '•••••7766');
  assert.equal(body.insurance.company, 'Isapre Salud');
  assert.equal(body.insurance.emergencyLine, '600 123 4567');
  assert.equal(body.preferredHospital, 'Hospital Central');
  assert.equal(body.bloodType, 'B+');

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('12.345.678-9'), false, 'el RUT completo no debe aparecer');
  assert.equal(serialized.includes('POL-99887766'), false, 'la póliza completa no debe aparecer');

  // El titular sigue viendo los datos completos en su panel.
  const ownerView = await request(`/api/profiles/${profile.id}`, { token: ownerToken });
  assert.equal(ownerView.body.nationalId, '12.345.678-9');
  assert.equal(ownerView.body.insurance.policyNumber, 'POL-99887766');
});

test('masking handles empty and short values without revealing them', async () => {
  const profile = await createProfile(ownerToken, { nationalId: '', insurance: { policyNumber: '123' } });
  const body = (await request(`/api/v1/emergency/${profile.public_token}`)).body;
  assert.equal(body.nationalId, '');
  assert.equal(body.insurance.policyNumber, '•••••3');
});

test('owner can rotate the QR token: the old QR stops working and the new one works', async () => {
  const profile = await createProfile(ownerToken);
  const oldToken = profile.public_token;

  const rotated = await request(`/api/profiles/${profile.id}/rotate-token`, { method: 'POST', token: ownerToken });
  assert.equal(rotated.response.status, 200);
  assert.match(rotated.body.public_token, /^[0-9a-f-]{36}$/);
  assert.notEqual(rotated.body.public_token, oldToken);

  assert.equal((await request(`/api/v1/emergency/${oldToken}`)).response.status, 404);
  assert.equal((await request(`/api/v1/emergency/${rotated.body.public_token}`)).response.status, 200);

  // Una edición posterior no restaura el token anterior.
  const edited = await request(`/api/profiles/${profile.id}`, {
    method: 'PUT',
    body: { fullName: 'Paciente QR Editado' },
    token: ownerToken,
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.body.public_token, rotated.body.public_token);
  assert.equal((await request(`/api/v1/emergency/${oldToken}`)).response.status, 404);
});

test('the old QR token cannot be used to rotate or reach the profile', async () => {
  const profile = await createProfile(ownerToken);
  const oldToken = profile.public_token;
  await request(`/api/profiles/${profile.id}/rotate-token`, { method: 'POST', token: ownerToken });

  const viaOldToken = await request(`/api/profiles/${oldToken}/rotate-token`, { method: 'POST', token: ownerToken });
  assert.equal(viaOldToken.response.status, 404);
});

test('other users cannot rotate a profile they do not own; unauthenticated requests are rejected', async () => {
  const profile = await createProfile(ownerToken);

  const foreign = await request(`/api/profiles/${profile.id}/rotate-token`, { method: 'POST', token: otherToken });
  assert.equal(foreign.response.status, 404);

  const anonymous = await request(`/api/profiles/${profile.id}/rotate-token`, { method: 'POST' });
  assert.equal(anonymous.response.status, 401);

  const memberAsAdmin = await request(`/api/admin/profiles/${profile.id}/rotate-token`, { method: 'POST', token: otherToken });
  assert.equal(memberAsAdmin.response.status, 403);

  assert.equal((await request(`/api/v1/emergency/${profile.public_token}`)).response.status, 200, 'el QR sigue intacto');
});

test('admin can rotate any profile QR and the admin QR points to the new token', async () => {
  const profile = await createProfile(ownerToken);

  const rotated = await request(`/api/admin/profiles/${profile.id}/rotate-token`, { method: 'POST', token: adminToken });
  assert.equal(rotated.response.status, 200);
  assert.notEqual(rotated.body.public_token, profile.public_token);
  assert.equal((await request(`/api/v1/emergency/${profile.public_token}`)).response.status, 404);

  const qr = await request(`/api/admin/profiles/${profile.id}/qr`, { token: adminToken });
  assert.equal(qr.response.status, 200);
  assert.ok(qr.body.targetUrl.endsWith(`token=${rotated.body.public_token}`));

  const missing = await request(`/api/admin/profiles/${randomUUID()}/rotate-token`, { method: 'POST', token: adminToken });
  assert.equal(missing.response.status, 404);
});
