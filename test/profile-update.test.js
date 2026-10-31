const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'profile-update-test-secret';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';

const app = require('../app');
const { createLocalUserForTests } = require('../auth');

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

async function postJson(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function expectedAge(birthDate) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const [currentYear, currentMonth, currentDay] = new Date().toISOString().slice(0, 10).split('-').map(Number);
  return currentYear - year - (
    currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0
  );
}

test('public emergency endpoint returns 404 for an unknown profile token', async () => {
  const token = randomUUID();
  const response = await fetch(`${baseUrl}/api/v1/emergency/${token}`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: 'Perfil de emergencia no encontrado.',
  });
});

test('PUT updates an authenticated user profile without changing its ownership or omitted nested data', async () => {
  const docsResponse = await fetch(`${baseUrl}/api-docs.json`);
  assert.equal(docsResponse.status, 200);
  const spec = await docsResponse.json();
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.paths['/api/profiles/{id}'].put);
  assert.deepEqual(spec.paths['/api/profiles/{id}'].put.security, [{ bearerAuth: [] }]);
  assert.ok(spec.paths['/api/profiles/{id}/photo'].post);

  const swaggerResponse = await fetch(`${baseUrl}/api-docs/`);
  assert.equal(swaggerResponse.status, 200);
  assert.match(await swaggerResponse.text(), /swagger-ui/);
  const swaggerBundleResponse = await fetch(`${baseUrl}/api-docs/swagger-ui-bundle.js`);
  assert.equal(swaggerBundleResponse.status, 200);
  const swaggerInitResponse = await fetch(`${baseUrl}/api-docs/swagger-ui-init.js`);
  assert.equal(swaggerInitResponse.status, 200);

  const suffix = `${Date.now()}-${Math.random()}`;
  const password = 'test-password-123';
  await createLocalUserForTests({
    email: `profile-owner-${suffix}@example.com`,
    password,
    fullName: 'Profile Owner',
  });

  const { response: loginResponse, body: login } = await postJson('/api/auth/login', {
    email: `profile-owner-${suffix}@example.com`,
    password,
  });
  assert.equal(loginResponse.status, 200);
  const ownerHeaders = { Authorization: `Bearer ${login.token}` };

  await createLocalUserForTests({
    email: `profile-other-${suffix}@example.com`,
    password,
    fullName: 'Other User',
  });
  const { body: otherLogin } = await postJson('/api/auth/login', {
    email: `profile-other-${suffix}@example.com`,
    password,
  });

  const { response: createResponse, body: created } = await postJson('/api/profiles', {
    fullName: 'Original Name',
    bloodType: 'O+',
    birthDate: '2000-01-01',
    age: 1,
    organDonor: true,
    primaryContact: { name: 'Emergency Contact', phone: '+56912345678' },
    insurance: { company: 'Original Insurance', policyNumber: '123' },
    allergies: ['Pollen'],
  }, login.token);
  assert.equal(createResponse.status, 201);
  assert.equal(created.age, expectedAge('2000-01-01'));

  const futureBirthDate = await postJson('/api/profiles', {
    fullName: 'Future Patient',
    bloodType: 'O+',
    birthDate: '2999-01-01',
  }, login.token);
  assert.equal(futureBirthDate.response.status, 400);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=', 'base64');
  const unauthorizedPhoto = await fetch(`${baseUrl}/api/profiles/${created.id}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: png,
  });
  assert.equal(unauthorizedPhoto.status, 401);

  const foreignPhoto = await fetch(`${baseUrl}/api/profiles/${created.id}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: 'Bear' + 'er ' + otherLogin.token },
    body: png,
  });
  assert.equal(foreignPhoto.status, 404);

  const invalidPhoto = await fetch(`${baseUrl}/api/profiles/${created.id}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', ...ownerHeaders },
    body: Buffer.from('not an image'),
  });
  assert.equal(invalidPhoto.status, 415);

  const photoResponse = await fetch(`${baseUrl}/api/profiles/${created.id}/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', ...ownerHeaders },
    body: png,
  });
  assert.equal(photoResponse.status, 200);
  const profileWithPhoto = await photoResponse.json();
  assert.match(profileWithPhoto.photoUrl, /^data:image\/png;base64,/);

  const publicProfileResponse = await fetch(`${baseUrl}/api/v1/emergency/${created.public_token}`);
  assert.equal(publicProfileResponse.status, 200);
  assert.match((await publicProfileResponse.json()).photo_url, /^data:image\/png;base64,/);

  const unauthorizedUpdate = await fetch(`${baseUrl}/api/profiles/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Unauthorized' }),
  });
  assert.equal(unauthorizedUpdate.status, 401);

  const foreignUpdate = await fetch(`${baseUrl}/api/profiles/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherLogin.token}` },
    body: JSON.stringify({ fullName: 'Foreign Update' }),
  });
  assert.equal(foreignUpdate.status, 404);

  const invalidResponse = await fetch(`${baseUrl}/api/profiles/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders },
    body: JSON.stringify({ fullName: '   ' }),
  });
  assert.equal(invalidResponse.status, 400);

  const updateResponse = await fetch(`${baseUrl}/api/profiles/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders },
    body: JSON.stringify({
      fullName: 'Updated Name',
      age: 0,
      primaryContact: { name: 'Updated Contact', phone: '+56911112222' },
      insurance: { company: 'Updated Insurance' },
      allergies: 'Latex\n  Pollen  ',
      user_id: 'another-user',
      public_token: 'replacement-token',
      is_active: false,
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();

  assert.equal(updated.fullName, 'Updated Name');
  assert.equal(updated.age, 0);
  assert.equal(updated.user_id, login.user.id);
  assert.equal(updated.public_token, created.public_token);
  assert.equal(updated.is_active, true);
  assert.deepEqual(updated.primaryContact, {
    name: 'Updated Contact',
    relationship: '',
    phone: '+56911112222',
    whatsapp: '56911112222',
  });
  assert.deepEqual(updated.insurance, {
    company: 'Updated Insurance',
    policyNumber: '123',
    emergencyLine: '',
  });
  assert.deepEqual(updated.allergies, ['Latex', 'Pollen']);

  const aliasUpdateResponse = await fetch(`${baseUrl}/api/profiles/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders },
    body: JSON.stringify({ profile_name: 'Alias Updated', organ_donor: false, age: 131 }),
  });
  assert.equal(aliasUpdateResponse.status, 400);

  const aliasSuccessResponse = await fetch(`${baseUrl}/api/profiles/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders },
    body: JSON.stringify({ profile_name: 'Alias Updated', organ_donor: false }),
  });
  assert.equal(aliasSuccessResponse.status, 200);
  const aliasUpdated = await aliasSuccessResponse.json();
  assert.equal(aliasUpdated.fullName, 'Alias Updated');
  assert.equal(aliasUpdated.organDonor, false);

  const birthDateUpdate = await fetch(`${baseUrl}/api/profiles/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders },
    body: JSON.stringify({ birthDate: '2010-12-31', age: 131 }),
  });
  assert.equal(birthDateUpdate.status, 200);
  assert.equal((await birthDateUpdate.json()).age, expectedAge('2010-12-31'));

  const invalidBirthDateUpdate = await fetch(`${baseUrl}/api/profiles/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders },
    body: JSON.stringify({ birthDate: '2999-01-01' }),
  });
  assert.equal(invalidBirthDateUpdate.status, 400);

  const getResponse = await fetch(`${baseUrl}/api/profiles/${created.id}`, { headers: ownerHeaders });
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).fullName, 'Alias Updated');
});
