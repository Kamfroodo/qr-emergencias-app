/**
 * Regresión de seguridad (hallazgo 5): la foto solo se asigna subiendo una
 * imagen. Una URL enviada por el cliente se ignora, para que la ficha pública
 * no cargue imágenes externas (que revelarían la IP de quien escanea el QR).
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'profile-photos-local-test-secret';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';

const app = require('../app');
const { createLocalUserForTests } = require('../auth');

const TRACKER = 'https://tracker.example/pixel.png';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4520000000049454e44ae426082', 'hex');

let server;
let baseUrl;
let token;

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && !isBuffer ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? (isBuffer ? body : JSON.stringify(body)) : undefined,
  });
  return { response, body: await response.json().catch(() => null) };
}

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const email = `photos-${randomUUID()}@example.com`;
  await createLocalUserForTests({ email, password: 'photos-secure-password', fullName: 'Photos', role: 'user' });
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'photos-secure-password' }),
  });
  token = (await login.json()).token;
});

after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('creating a profile ignores a client-supplied photo URL', async () => {
  const created = await request('/api/profiles', {
    method: 'POST',
    body: { fullName: 'Foto Externa', bloodType: 'A+', photoUrl: TRACKER, photo_url: TRACKER },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.photoUrl, '');

  const publicView = await fetch(`${baseUrl}/api/v1/emergency/${created.body.public_token}`).then(r => r.json());
  assert.equal(publicView.photoUrl, '');
  assert.equal(publicView.photo_url, '');
});

test('updating a profile cannot set or clear the photo; only an upload changes it', async () => {
  const created = await request('/api/profiles', { method: 'POST', body: { fullName: 'Foto Subida', bloodType: 'O-' } });

  const uploaded = await request(`/api/profiles/${created.body.id}/photo`, {
    method: 'POST',
    body: PNG,
    headers: { 'Content-Type': 'image/png' },
  });
  assert.equal(uploaded.response.status, 200);
  assert.match(uploaded.body.photoUrl, /^data:image\/png;base64,/);

  for (const body of [{ photoUrl: TRACKER }, { photo_url: TRACKER }, { photoUrl: '' }]) {
    const updated = await request(`/api/profiles/${created.body.id}`, { method: 'PUT', body: { ...body, fullName: 'Foto Subida' } });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.photoUrl, uploaded.body.photoUrl, `PUT ${JSON.stringify(body)} no cambia la foto`);
  }

  const publicView = await fetch(`${baseUrl}/api/v1/emergency/${created.body.public_token}`).then(r => r.json());
  assert.equal(publicView.photoUrl, uploaded.body.photoUrl);
  assert.equal(JSON.stringify(publicView).includes('tracker.example'), false);
});
