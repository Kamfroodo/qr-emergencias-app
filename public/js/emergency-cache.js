/**
 * emergency-cache.js - Copia local de la ficha de emergencia en el teléfono de
 * quien escanea el QR, para seguir viéndola si se pierde la señal durante la
 * atención.
 *
 * Como ese teléfono es de un tercero (paramédico, testigo), la copia:
 *  - vence a las MAX_AGE_MS y se borra en la siguiente visita a cualquier ficha;
 *  - se borra en cuanto el servidor dice que la ficha ya no está disponible
 *    (pausada, cuenta vencida o suspendida, eliminada o QR regenerado);
 *  - solo se usa si el servidor no responde (sin señal o error del servidor).
 *
 * Funciona en el navegador (window.EmergencyCache) y en Node (pruebas).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmergencyCache = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const PREFIX = 'emg_cache_';
  const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 horas: cubre una atención completa.
  const CLOCK_SKEW_MS = 60 * 1000;

  function safely(action, fallback) {
    try {
      return action();
    } catch {
      return fallback;
    }
  }

  function parseEntry(raw, now) {
    const entry = safely(() => JSON.parse(raw), null);
    if (!entry || typeof entry !== 'object' || typeof entry.savedAt !== 'number' || !entry.data) return null;
    if (entry.savedAt > now + CLOCK_SKEW_MS || now - entry.savedAt > MAX_AGE_MS) return null;
    return entry;
  }

  // Borra copias vencidas, corruptas o del formato antiguo (sin fecha).
  function purgeExpired(storage, now = Date.now()) {
    if (!storage) return;
    const keys = [];
    const length = safely(() => storage.length, 0);
    for (let index = 0; index < length; index++) {
      const key = safely(() => storage.key(index), null);
      if (typeof key === 'string' && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      if (!parseEntry(safely(() => storage.getItem(key), null), now)) {
        safely(() => storage.removeItem(key));
      }
    }
  }

  function save(storage, token, data, now = Date.now()) {
    if (!storage || !token) return;
    safely(() => storage.setItem(PREFIX + token, JSON.stringify({ savedAt: now, data })));
  }

  // Devuelve { data, savedAt } solo si la copia sigue vigente; si no, la borra.
  function load(storage, token, now = Date.now()) {
    if (!storage || !token) return null;
    const entry = parseEntry(safely(() => storage.getItem(PREFIX + token), null), now);
    if (!entry) remove(storage, token);
    return entry;
  }

  function remove(storage, token) {
    if (!storage || !token) return;
    safely(() => storage.removeItem(PREFIX + token));
  }

  return { PREFIX, MAX_AGE_MS, purgeExpired, save, load, remove };
}));
