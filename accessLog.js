/**
 * accessLog.js - Registro de accesos a las fichas médicas.
 *
 * Qué se registra:
 *  - Cada escaneo del QR de una ficha existente (resultado: mostrada, pausada,
 *    cuenta vencida o suspendida). Los tokens inexistentes no se registran: ya
 *    los frena el límite de intentos.
 *  - Las acciones sobre fichas: el titular regenera su QR; un admin abre la
 *    ficha completa, ve o descarga el QR, lo regenera o elimina la ficha/cuenta.
 *
 * Privacidad de quien escanea: no se guarda la IP, solo una huella HMAC
 * (16 caracteres) que permite ver si muchos escaneos vienen del mismo lugar,
 * pero no recuperar la IP sin el secreto del servidor.
 *
 * Retención: RETENTION_DAYS. Lo más antiguo no se muestra y se borra.
 *
 * Registrar nunca debe bloquear ni romper la respuesta: los errores solo se
 * escriben en el log del servidor.
 */

const { createHmac } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const RETENTION_DAYS = 180;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

const EVENTS = [
  'public_scan',
  'owner_rotate_qr',
  'admin_view_profile',
  'admin_view_qr',
  'admin_rotate_qr',
  'admin_delete_profile',
  'admin_delete_user',
];
const OUTCOMES = ['ok', 'paused', 'account_expired', 'account_suspended'];
// Lo que el titular ve de su propia ficha.
const OWNER_VISIBLE_EVENTS = ['public_scan', 'owner_rotate_qr', 'admin_rotate_qr'];

const hashSecret = process.env.ACCESS_LOG_SECRET || process.env.JWT_SECRET || 'dev_access_log_secret';

let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (supabaseUrl && supabaseKey && !supabaseKey.includes('tu_supabase')) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (error) {
    console.error('[AccessLog] No se pudo crear el cliente de Supabase:', error.message);
  }
}

let localLogs = [];
let localSequence = 0;
let lastPurgeAt = 0;

function ipFingerprint(ip) {
  if (typeof ip !== 'string' || !ip) return null;
  // La misma IPv4 puede llegar como "::ffff:1.2.3.4": se normaliza para que su huella sea una sola.
  const normalized = ip.trim().toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
  return createHmac('sha256', hashSecret).update(normalized).digest('hex').slice(0, 16);
}

function cutoffIso(now = Date.now()) {
  return new Date(now - RETENTION_MS).toISOString();
}

function toEntry(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    event: row.event,
    outcome: row.outcome,
    profileId: row.profile_id,
    profileOwnerId: row.profile_owner_id,
    actorUserId: row.actor_user_id,
    ipHash: row.ip_hash,
  };
}

function purgeExpired(now = Date.now()) {
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  if (!supabase) {
    const cutoff = cutoffIso(now);
    localLogs = localLogs.filter(row => row.created_at >= cutoff);
    return;
  }
  supabase.from('access_logs').delete().lt('created_at', cutoffIso(now))
    .then(({ error }) => {
      if (error) console.error('[AccessLog] purgeExpired:', error.message);
    }, error => console.error('[AccessLog] purgeExpired:', error.message));
}

/**
 * Registra un acceso. Nunca lanza excepciones; devuelve una promesa que se
 * resuelve cuando termina (no es necesario esperarla).
 * `at` solo se usa en pruebas.
 */
function recordAccess({ event, outcome = 'ok', profileId = null, profileOwnerId = null, actorUserId = null, ip = null, at = null }) {
  try {
    if (!EVENTS.includes(event) || !OUTCOMES.includes(outcome)) {
      console.error('[AccessLog] Evento no válido:', event, outcome);
      return Promise.resolve();
    }
    const row = {
      created_at: (at || new Date()).toISOString(),
      event,
      outcome,
      profile_id: profileId,
      profile_owner_id: profileOwnerId,
      actor_user_id: actorUserId,
      ip_hash: ipFingerprint(ip),
    };
    purgeExpired();

    if (!supabase) {
      localLogs.push({ id: ++localSequence, ...row });
      return Promise.resolve();
    }
    return supabase.from('access_logs').insert([row])
      .then(({ error }) => {
        if (error) console.error('[AccessLog] recordAccess:', error.message);
      }, error => console.error('[AccessLog] recordAccess:', error.message));
  } catch (error) {
    console.error('[AccessLog] recordAccess:', error.message);
    return Promise.resolve();
  }
}

/**
 * Lista registros vigentes, del más reciente al más antiguo.
 * Filtros opcionales: profileId, profileOwnerId, events.
 */
async function listAccessLogs({ profileId, profileOwnerId, events, limit = 50, now = Date.now() } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 500);
  const cutoff = cutoffIso(now);

  if (!supabase) {
    return localLogs
      .filter(row => row.created_at >= cutoff &&
        (!profileId || row.profile_id === profileId) &&
        (!profileOwnerId || row.profile_owner_id === profileOwnerId) &&
        (!events || events.includes(row.event)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .slice(0, safeLimit)
      .map(toEntry);
  }

  let query = supabase
    .from('access_logs')
    .select('id, created_at, event, outcome, profile_id, profile_owner_id, actor_user_id, ip_hash')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (profileId) query = query.eq('profile_id', profileId);
  if (profileOwnerId) query = query.eq('profile_owner_id', profileOwnerId);
  if (events) query = query.in('event', events);

  const { data, error } = await query;
  if (error) {
    console.error('[AccessLog] listAccessLogs:', error.message);
    throw new Error('No se pudo cargar el registro de accesos. Verifica que aplicaste supabase_access_logs.sql.');
  }
  return data.map(toEntry);
}

module.exports = {
  RETENTION_DAYS,
  EVENTS,
  OUTCOMES,
  OWNER_VISIBLE_EVENTS,
  ipFingerprint,
  recordAccess,
  listAccessLogs,
};
