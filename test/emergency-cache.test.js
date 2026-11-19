/**
 * Regresión de seguridad (hallazgo 4 del modelo de amenazas): la copia de la
 * ficha que queda en el teléfono de quien escanea el QR debe vencer y borrarse
 * cuando la ficha deja de estar disponible.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const EmergencyCache = require('../public/js/emergency-cache');

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const PROFILE = { fullName: 'Paciente', bloodType: 'O+', nationalId: '•••••5.678-9' };

// localStorage mínimo compatible (length, key, getItem, setItem, removeItem).
function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    keys: () => [...map.keys()],
  };
}

test('saved copy is returned with its timestamp while it is fresh', () => {
  const storage = createStorage();
  EmergencyCache.save(storage, 'token-a', PROFILE, NOW);

  const loaded = EmergencyCache.load(storage, 'token-a', NOW + 11 * HOUR);
  assert.deepEqual(loaded, { savedAt: NOW, data: PROFILE });
});

test('copies expire after 12 hours and are deleted when read', () => {
  const storage = createStorage();
  EmergencyCache.save(storage, 'token-a', PROFILE, NOW);

  assert.equal(EmergencyCache.load(storage, 'token-a', NOW + 12 * HOUR + 1), null);
  assert.deepEqual(storage.keys(), []);
});

test('purgeExpired removes expired, legacy and corrupt copies but keeps fresh ones and other keys', () => {
  const storage = createStorage({
    // Formato antiguo (sin fecha): podía contener el RUT completo.
    emg_cache_legacy: JSON.stringify({ fullName: 'Antiguo', nationalId: '12.345.678-9' }),
    emg_cache_corrupt: '{no es json',
    emg_cache_old: JSON.stringify({ savedAt: NOW - 13 * HOUR, data: PROFILE }),
    emg_cache_future: JSON.stringify({ savedAt: NOW + 2 * HOUR, data: PROFILE }),
    emg_cache_fresh: JSON.stringify({ savedAt: NOW - HOUR, data: PROFILE }),
    qr_auth_token: 'otra-app-no-se-toca',
  });

  EmergencyCache.purgeExpired(storage, NOW);

  assert.deepEqual(storage.keys().sort(), ['emg_cache_fresh', 'qr_auth_token']);
});

test('remove deletes the copy for a token (paused, deleted or regenerated QR)', () => {
  const storage = createStorage();
  EmergencyCache.save(storage, 'token-a', PROFILE, NOW);
  EmergencyCache.save(storage, 'token-b', PROFILE, NOW);

  EmergencyCache.remove(storage, 'token-a');

  assert.equal(EmergencyCache.load(storage, 'token-a', NOW), null);
  assert.ok(EmergencyCache.load(storage, 'token-b', NOW));
});

test('works without storage or when storage throws (private mode, blocked site data)', () => {
  const throwing = {
    get length() { throw new Error('SecurityError'); },
    key() { throw new Error('SecurityError'); },
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  for (const storage of [null, undefined, throwing]) {
    assert.doesNotThrow(() => EmergencyCache.purgeExpired(storage, NOW));
    assert.doesNotThrow(() => EmergencyCache.save(storage, 'token-a', PROFILE, NOW));
    assert.equal(EmergencyCache.load(storage, 'token-a', NOW), null);
    assert.doesNotThrow(() => EmergencyCache.remove(storage, 'token-a'));
  }
});

test('emergency page uses the cache module, clears it on 403/404 and never writes raw copies', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'emergency.html'), 'utf8');

  assert.match(html, /<script src="\/js\/emergency-cache\.js"><\/script>/);
  assert.match(html, /EmergencyCache\.purgeExpired\(storage\)/);
  assert.doesNotMatch(html, /localStorage\.(setItem|getItem)\(\s*'emg_cache_'/, 'sin escrituras directas sin vencimiento');

  const branch = status => {
    const start = html.indexOf(`response.status === ${status}`);
    assert.notEqual(start, -1, `existe el manejo del ${status}`);
    return html.slice(start, html.indexOf('return;', start));
  };
  assert.match(branch(403), /EmergencyCache\.remove\(storage, token\)/);
  assert.match(branch(404), /EmergencyCache\.remove\(storage, token\)/);
  assert.doesNotMatch(branch(404), /renderProfile/, 'un QR regenerado o eliminado no muestra la copia');
});

test('emergency page never shows a stock photo that could be mistaken for the patient', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'emergency.html'), 'utf8');
  assert.doesNotMatch(html, /unsplash\.com|placeholder\.com/);
  assert.match(html, /id="patientInitials"/);
});
