/**
 * rateLimits.js - Límites de intentos por IP para las rutas públicas sensibles.
 *
 * Los contadores viven en memoria del proceso: sirven para una sola instancia
 * (plan actual de Render). Si se escala a varias instancias, usar un store
 * compartido (p. ej. Redis) para que los límites se sumen entre instancias.
 */

const { rateLimit } = require('express-rate-limit');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function limitHandler(message) {
  return (req, res, next, options) => {
    res.status(options.statusCode).json({ error: message, code: 'RATE_LIMITED' });
  };
}

function normalizedEmail(req) {
  return typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
}

const common = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
};

// Fuerza bruta contra una cuenta concreta: 10 intentos fallidos por IP + correo.
// Los inicios de sesión correctos no cuentan.
const loginPerAccountLimiter = rateLimit({
  ...common,
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: req => `${req.ip}|${normalizedEmail(req)}`,
  handler: limitHandler('Demasiados intentos de inicio de sesión. Espera 15 minutos e inténtalo de nuevo.'),
});

// Prueba de contraseñas contra muchas cuentas desde una misma IP.
const loginPerIpLimiter = rateLimit({
  ...common,
  windowMs: FIFTEEN_MINUTES,
  limit: 50,
  skipSuccessfulRequests: true,
  handler: limitHandler('Demasiados intentos de inicio de sesión desde esta red. Espera 15 minutos.'),
});

// Consulta y aceptación de enlaces de invitación.
const invitationLimiter = rateLimit({
  ...common,
  windowMs: FIFTEEN_MINUTES,
  limit: 20,
  handler: limitHandler('Demasiadas solicitudes de invitación. Espera unos minutos e inténtalo de nuevo.'),
});

// Ficha pública de emergencia: límite holgado para no bloquear nunca a un
// paramédico (aunque comparta red con otros), pero que frene barridos masivos.
const emergencyLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 120,
  handler: limitHandler('Demasiadas consultas seguidas. Espera un minuto e inténtalo de nuevo.'),
});

module.exports = {
  loginPerAccountLimiter,
  loginPerIpLimiter,
  invitationLimiter,
  emergencyLimiter,
};
