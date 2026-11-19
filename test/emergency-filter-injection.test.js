/**
 * Regresión: el endpoint público /api/v1/emergency/:publicToken no debe permitir
 * inyectar filtros de PostgREST (p. ej. `<uuid>,id.gt.<uuid>`) para leer fichas ajenas.
 *
 * Las demás pruebas usan el modo memoria, donde este fallo no existe. Aquí se
 * sustituye @supabase/supabase-js por un cliente falso que registra cada filtro
 * enviado, para verificar la consulta que llegaría realmente a Supabase.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, beforeEach, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'emergency-filter-injection-test-secret';
process.env.SUPABASE_URL = 'https://fake-project.supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';

const KNOWN_TOKEN = randomUUID();
const KNOWN_ROW = {
  id: randomUUID(),
  user_id: null,
  public_token: KNOWN_TOKEN,
  is_active: true,
  full_name: 'Paciente Conocido',
  blood_type: 'O+',
};

const calls = [];

function fakeQuery(table) {
  const filters = [];
  const builder = {
    select() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    or(expression) {
      filters.push(['or', expression]);
      calls.push({ table, method: 'or', args: [expression] });
      return builder;
    },
    eq(column, value) {
      filters.push(['eq', column, value]);
      calls.push({ table, method: 'eq', args: [column, value] });
      return builder;
    },
    async maybeSingle() {
      // Simula PostgREST: un `or` que contiene `id.gt.` coincide con cualquier ficha.
      // Un `or` con `id.eq.<id interno>` también coincide (búsqueda por ID interno).
      const injected = filters.some(([op, expr]) =>
        op === 'or' && (/id\.gt\./.test(expr) || expr.includes(`id.eq.${KNOWN_ROW.id}`)));
      const byToken = filters.some(([op, col, val]) => op === 'eq' && col === 'public_token' && val === KNOWN_TOKEN);
      if (table === 'profiles' && (injected || byToken)) return { data: KNOWN_ROW, error: null };
      return { data: null, error: null };
    },
  };
  return builder;
}

const supabaseModulePath = require.resolve('@supabase/supabase-js');
require.cache[supabaseModulePath] = {
  id: supabaseModulePath,
  filename: supabaseModulePath,
  loaded: true,
  exports: { createClient: () => ({ from: table => fakeQuery(table) }) },
};

const app = require('../app');
const db = require('../db');

const ZERO = '00000000-0000-0000-0000-000000000000';
const INJECTION_PAYLOADS = [
  `${ZERO},id.gt.${ZERO}`,
  `${ZERO},and(id.gt.${ZERO},id.lt.ffffffff-ffff-ffff-ffff-ffffffffffff)`,
  `${KNOWN_TOKEN},is_active.eq.true`,
  'not-a-uuid',
];

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

beforeEach(() => {
  calls.length = 0;
});

for (const payload of INJECTION_PAYLOADS) {
  test(`public emergency endpoint rejects filter injection: ${payload}`, async () => {
    const response = await fetch(`${baseUrl}/api/v1/emergency/${encodeURIComponent(payload)}`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Perfil de emergencia no encontrado.' });
    assert.deepEqual(
      calls.filter(call => call.table === 'profiles'),
      [],
      'el valor inyectado no debe llegar a ninguna consulta de fichas'
    );
  });
}

test('public emergency endpoint looks up only by public_token with an equality filter', async () => {
  const response = await fetch(`${baseUrl}/api/v1/emergency/${KNOWN_TOKEN}`);
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.public_token, KNOWN_TOKEN);
  assert.equal(body.fullName, 'Paciente Conocido');
  assert.equal(Object.hasOwn(body, 'id'), false, 'la ficha pública no debe exponer el ID interno');

  const profileCalls = calls.filter(call => call.table === 'profiles');
  assert.deepEqual(profileCalls, [{ table: 'profiles', method: 'eq', args: ['public_token', KNOWN_TOKEN] }]);
});

test('public emergency endpoint does not accept the internal profile id', async () => {
  const response = await fetch(`${baseUrl}/api/v1/emergency/${KNOWN_ROW.id}`);
  assert.equal(response.status, 404);
});

test('getProfileByIdOrToken never builds an `or` filter from a non-UUID identifier', async () => {
  for (const payload of INJECTION_PAYLOADS) {
    assert.equal(await db.getProfileByIdOrToken(payload), null);
  }
  assert.deepEqual(calls.filter(call => call.method === 'or'), []);
});
