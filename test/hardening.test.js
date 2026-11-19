/**
 * Regresión de seguridad (hallazgos de prioridad baja):
 *  - Los errores internos de la base de datos no llegan al navegador.
 *  - CORS solo permite los orígenes configurados en CORS_ORIGINS.
 *  - La documentación de la API se puede desactivar (API_DOCS_ENABLED=false;
 *    en producción está desactivada por defecto).
 *
 * Se usa un cliente de Supabase falso cuyas operaciones fallan con un mensaje
 * que no debe aparecer en ninguna respuesta.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'hardening-test-secret';
process.env.SUPABASE_URL = 'https://fake-project.supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
process.env.CORS_ORIGINS = 'https://partner.example/, https://otro.example';
process.env.API_DOCS_ENABLED = 'false';

const SECRET_DETAIL = 'relation "profiles" column internal_secret_detail violates constraint xyz';
const USER = { id: randomUUID(), email: 'hardening@example.com', full_name: 'Hardening', role: 'user', is_active: true, max_profiles: null, account_expires_at: null };

function fakeQuery(table) {
  const failure = { data: null, error: { message: SECRET_DETAIL, code: 'XX000' } };
  const builder = {
    select() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    eq() { return builder; },
    or() { return builder; },
    in() { return builder; },
    gte() { return builder; },
    lt() { return builder; },
    delete() { return builder; },
    update() { return builder; },
    insert() { return builder; },
    async maybeSingle() { return table === 'users' ? { data: USER, error: null } : failure; },
    then(resolve, reject) {
      return Promise.resolve(table === 'users' ? { data: [USER], error: null } : failure).then(resolve, reject);
    },
  };
  return builder;
}

const supabaseModulePath = require.resolve('@supabase/supabase-js');
require.cache[supabaseModulePath] = {
  id: supabaseModulePath,
  filename: supabaseModulePath,
  loaded: true,
  exports: {
    createClient: () => ({
      from: table => fakeQuery(table),
      rpc: async () => ({ data: null, error: { message: SECRET_DETAIL, code: 'XX000' } }),
      storage: { from: () => ({}) },
    }),
  },
};

const app = require('../app');

let server;
let baseUrl;
const token = jwt.sign({ userId: USER.id, email: USER.email, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

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

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, text: await response.text() };
}

test('database errors are not leaked to the client', async () => {
  const created = await call('/api/profiles', { method: 'POST', body: { fullName: 'Paciente', bloodType: 'O+' } });
  assert.equal(created.response.status, 500);
  assert.doesNotMatch(created.text, /internal_secret_detail|relation|constraint|Supabase/i);
  assert.match(JSON.parse(created.text).error, /No se pudo crear la ficha médica/);

  const deleted = await call(`/api/profiles/${randomUUID()}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 500);
  assert.doesNotMatch(deleted.text, /internal_secret_detail|relation|constraint|Supabase/i);
});

test('CORS only allows configured origins', async () => {
  const evil = await call('/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.response.headers.get('access-control-allow-origin'), null);

  const partner = await call('/health', { headers: { Origin: 'https://partner.example' } });
  assert.equal(partner.response.headers.get('access-control-allow-origin'), 'https://partner.example');

  const preflight = await call('/api/profiles', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(preflight.response.headers.get('access-control-allow-origin'), null);
});

test('API docs can be disabled', async () => {
  assert.equal((await call('/api-docs.json')).response.status, 404);
  assert.equal((await call('/api-docs/')).response.status, 404);
});
