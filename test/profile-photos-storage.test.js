/**
 * Regresión de seguridad (hallazgo 5): con Supabase, las fotos viven en un
 * bucket privado. Se guarda solo la ruta, se entregan URL firmadas que vencen,
 * nunca se firman URL ajenas y la foto se borra al eliminar la ficha o la cuenta.
 *
 * Se sustituye @supabase/supabase-js por un cliente falso en memoria.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { beforeEach, test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://fake-project.supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
process.env.SUPABASE_PHOTO_BUCKET = 'medical-photos';

let rows = [];
let storageCalls = [];

function matches(row, filters) {
  return filters.every(filter => {
    if (filter.type === 'eq') return row[filter.column] === filter.value;
    // `or` simplificado: "id.eq.X,public_token.eq.X"
    return filter.expression.split(',').some(part => {
      const [column, , value] = part.split('.');
      return String(row[column]) === value;
    });
  });
}

function fakeQuery() {
  const filters = [];
  let action = 'select';
  let patch = null;
  const run = () => {
    const matched = rows.filter(row => matches(row, filters));
    if (action === 'delete') rows = rows.filter(row => !matched.includes(row));
    if (action === 'update') matched.forEach(row => Object.assign(row, patch));
    return matched.map(row => ({ ...row }));
  };
  const builder = {
    select() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    eq(column, value) { filters.push({ type: 'eq', column, value }); return builder; },
    or(expression) { filters.push({ type: 'or', expression }); return builder; },
    delete() { action = 'delete'; return builder; },
    update(values) { action = 'update'; patch = values; return builder; },
    async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
    then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
  };
  return builder;
}

const fakeStorage = bucket => ({
  async upload(path, file, options) {
    storageCalls.push({ op: 'upload', bucket, path, contentType: options.contentType });
    return { error: null };
  },
  async createSignedUrl(path, expiresIn) {
    storageCalls.push({ op: 'sign', bucket, path, expiresIn });
    return { data: { signedUrl: `https://fake-project.supabase.invalid/storage/v1/object/sign/${bucket}/${path}?token=signed` }, error: null };
  },
  async remove(paths) {
    storageCalls.push({ op: 'remove', bucket, paths });
    return { data: [], error: null };
  },
  getPublicUrl() {
    throw new Error('No se deben generar URL públicas');
  },
});

const supabaseModulePath = require.resolve('@supabase/supabase-js');
require.cache[supabaseModulePath] = {
  id: supabaseModulePath,
  filename: supabaseModulePath,
  loaded: true,
  exports: { createClient: () => ({ from: () => fakeQuery(), storage: { from: fakeStorage } }) },
};

const db = require('../db');

function addProfile(userId, extra = {}) {
  const row = {
    id: randomUUID(),
    user_id: userId,
    public_token: randomUUID(),
    is_active: true,
    full_name: 'Paciente Foto',
    blood_type: 'O+',
    photo_url: '',
    ...extra,
  };
  rows.push(row);
  return row;
}

beforeEach(() => {
  rows = [];
  storageCalls = [];
});

test('a stored path is served as a signed URL that expires in one hour', async () => {
  const id = randomUUID();
  const url = await db.resolvePhotoUrl(`${id}/profile-photo`);

  assert.match(url, /\/object\/sign\/medical-photos\/.+\?token=signed$/);
  assert.deepEqual(storageCalls, [{ op: 'sign', bucket: 'medical-photos', path: `${id}/profile-photo`, expiresIn: 3600 }]);
});

test('legacy public URLs of the bucket are converted and signed', async () => {
  const id = randomUUID();
  const legacy = `https://fake-project.supabase.invalid/storage/v1/object/public/medical-photos/${id}/profile-photo?v=1731000000000`;
  const url = await db.resolvePhotoUrl(legacy);

  assert.notEqual(url, legacy);
  assert.equal(storageCalls[0].path, `${id}/profile-photo`);
});

test('foreign, other-bucket and unexpected values are never signed nor returned', async () => {
  const id = randomUUID();
  for (const value of [
    'https://tracker.example/pixel.png',
    `https://fake-project.supabase.invalid/storage/v1/object/public/other-bucket/${id}/profile-photo`,
    `https://fake-project.supabase.invalid/storage/v1/object/public/medical-photos/${id}/../../secret.png`,
    'data:image/png;base64,AAAA',
    '',
    null,
  ]) {
    assert.equal(await db.resolvePhotoUrl(value), '', String(value));
  }
  assert.deepEqual(storageCalls, []);
});

test('uploading a photo stores the bucket path, not a public URL', async () => {
  const owner = randomUUID();
  const profile = addProfile(owner);

  const updated = await db.saveProfilePhoto(profile.id, owner, Buffer.from('img'), 'image/webp');

  assert.deepEqual(storageCalls, [{ op: 'upload', bucket: 'medical-photos', path: `${profile.id}/profile-photo`, contentType: 'image/webp' }]);
  assert.equal(rows[0].photo_url, `${profile.id}/profile-photo`);
  assert.equal(updated.photoUrl, `${profile.id}/profile-photo`);
});

test('deleting a profile also deletes its photo; a missing profile deletes nothing', async () => {
  const owner = randomUUID();
  const profile = addProfile(owner);

  assert.equal(await db.deleteProfile(profile.id, owner), true);
  assert.deepEqual(storageCalls, [{ op: 'remove', bucket: 'medical-photos', paths: [`${profile.id}/profile-photo`] }]);

  storageCalls = [];
  assert.equal(await db.deleteProfile(randomUUID(), owner), false);
  assert.deepEqual(storageCalls, []);
});

test('deleting all profiles of a user deletes all their photos', async () => {
  const owner = randomUUID();
  const first = addProfile(owner);
  const second = addProfile(owner);
  const other = addProfile(randomUUID());

  await db.deleteProfilesForUser(owner);

  assert.deepEqual(rows.map(row => row.id), [other.id]);
  assert.deepEqual(storageCalls, [{
    op: 'remove',
    bucket: 'medical-photos',
    paths: [`${first.id}/profile-photo`, `${second.id}/profile-photo`],
  }]);
});
