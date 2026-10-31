/**
 * auth.js - Autenticación JWT para la plataforma médica QR Emergencias
 * Maneja registro, login, verificación de tokens y gestión de usuarios.
 * Soporta Supabase (tabla `users`) con fallback a memoria local para desarrollo.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createHash, randomBytes } = require('node:crypto');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ==========================================
// Configuración JWT
// ==========================================
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_cambiar_en_produccion';
if (process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32)) {
  throw new Error('En producción, JWT_SECRET debe tener al menos 32 bytes aleatorios.');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const BCRYPT_ROUNDS = 12;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function databaseUnavailable(action, error) {
  const unavailable = new Error(`Supabase no está disponible para ${action}.`);
  unavailable.code = 'DATABASE_UNAVAILABLE';
  unavailable.cause = error;
  console.error(`[Auth DB] ${action}:`, error.message);
  return unavailable;
}

// ==========================================
// Capa de datos de usuarios
// ==========================================

let { createClient } = require('@supabase/supabase-js');
let supabase = null;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (supabaseUrl && supabaseKey && !supabaseKey.includes('tu_supabase')) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (e) {
    console.error('[Auth] Error al conectar Supabase para usuarios:', e.message);
    if (process.env.NODE_ENV === 'production') throw e;
  }
}

// Fallback local para desarrollo sin base de datos
const localUsers = [];
const localInvitations = [];
const localInvitationAccepting = new Set();
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashInvitationToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function publicInvitation(invitation) {
  const now = Date.now();
  const status = invitation.used_at ? 'accepted'
    : invitation.revoked_at ? 'revoked'
      : new Date(invitation.expires_at).getTime() <= now ? 'expired'
        : 'pending';
  return {
    id: invitation.id,
    email: invitation.email,
    fullName: invitation.full_name,
    createdAt: invitation.created_at,
    expiresAt: invitation.expires_at,
    status,
  };
}

async function listInvitations() {
  if (supabase) {
    const { data, error } = await supabase
      .from('user_invitations')
      .select('id, email, full_name, created_at, expires_at, used_at, revoked_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('[Auth DB] listInvitations:', error.message);
      throw new Error('No se pudieron cargar las invitaciones. Verifica la migración de acceso.');
    }
    return data.map(publicInvitation);
  }
  return localInvitations
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 100)
    .map(publicInvitation);
}

async function createInvitation({ email, fullName, tokenHash, createdBy }) {
  const createdAt = new Date();
  const invitation = {
    id: uuidv4(),
    email,
    full_name: fullName,
    token_hash: tokenHash,
    created_by: createdBy,
    created_at: createdAt.toISOString(),
    expires_at: new Date(createdAt.getTime() + INVITATION_LIFETIME_MS).toISOString(),
    used_at: null,
    revoked_at: null,
  };

  if (supabase) {
    const { data, error } = await supabase.rpc('admin_create_user_invitation', {
      target_email: email,
      target_full_name: fullName,
      target_token_hash: tokenHash,
      target_created_by: createdBy,
      target_expires_at: invitation.expires_at,
    });
    if (error) {
      console.error('[Auth DB] createInvitation:', error.message);
      if (error.code === 'P0001') throw new Error('Ese correo ya tiene una cuenta activa. Puedes reactivarla desde la administración.');
      throw new Error('No se pudo crear la invitación. Verifica que aplicaste la migración de acceso.');
    }
    return publicInvitation({ ...invitation, id: data });
  }

  if (localUsers.some(user => user.email === email)) {
    throw new Error('Ese correo ya tiene una cuenta activa. Puedes reactivarla desde la administración.');
  }
  for (const previous of localInvitations) {
    if (previous.email === email && !previous.used_at && !previous.revoked_at) {
      previous.revoked_at = createdAt.toISOString();
    }
  }
  localInvitations.push(invitation);
  return publicInvitation(invitation);
}

async function findValidInvitation(tokenHash) {
  if (supabase) {
    const { data, error } = await supabase
      .from('user_invitations')
      .select('id, email, full_name, expires_at')
      .eq('token_hash', tokenHash)
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) throw databaseUnavailable('validar la invitación', error);
    return data;
  }
  return localInvitations.find(invitation =>
    invitation.token_hash === tokenHash &&
    !invitation.used_at &&
    !invitation.revoked_at &&
    new Date(invitation.expires_at).getTime() > Date.now()
  ) || null;
}

async function acceptInvitation(tokenHash, passwordHash) {
  if (supabase) {
    const { data, error } = await supabase.rpc('accept_user_invitation', {
      target_token_hash: tokenHash,
      target_password_hash: passwordHash,
    });
    if (error) {
      console.error('[Auth DB] acceptInvitation:', error.message);
      if (error.code === 'P0001' && error.message.includes('account already exists')) {
        throw new Error('Ese correo ya tiene una cuenta. Solicita ayuda al administrador.');
      }
      if (error.code === 'P0001') throw new Error('La invitación expiró, ya se usó o fue revocada.');
      throw new Error('No se pudo completar la invitación. Verifica que aplicaste la migración de acceso.');
    }
    return findUserById(data);
  }

  if (localInvitationAccepting.has(tokenHash)) {
    throw new Error('La invitación expiró, ya se usó o fue revocada.');
  }
  localInvitationAccepting.add(tokenHash);
  try {
    const invitation = await findValidInvitation(tokenHash);
    if (!invitation) throw new Error('La invitación expiró, ya se usó o fue revocada.');
    if (localUsers.some(user => user.email === invitation.email)) {
      throw new Error('Ese correo ya tiene una cuenta. Solicita ayuda al administrador.');
    }
    const user = {
      id: uuidv4(),
      email: invitation.email,
      password_hash: passwordHash,
      full_name: invitation.full_name,
      role: 'user',
      is_active: true,
      created_at: new Date().toISOString(),
    };
    localUsers.push(user);
    invitation.used_at = new Date().toISOString();
    return user;
  } finally {
    localInvitationAccepting.delete(tokenHash);
  }
}

async function revokeInvitation(id) {
  if (supabase) {
    const { data, error } = await supabase
      .from('user_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('used_at', null)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[Auth DB] revokeInvitation:', error.message);
      throw new Error('No se pudo revocar la invitación.');
    }
    return Boolean(data);
  }
  const invitation = localInvitations.find(item => item.id === id && !item.used_at && !item.revoked_at);
  if (!invitation) return false;
  invitation.revoked_at = new Date().toISOString();
  return true;
}

async function findUserByEmail(email) {
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .limit(1)
      .maybeSingle();
    if (error) {
      throw databaseUnavailable('consultar el usuario', error);
    }
    return data || null;
  }
  return localUsers.find(u => u.email === email.toLowerCase()) || null;
}

async function findUserById(id) {
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active, created_at')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw databaseUnavailable('validar la cuenta', error);
    }
    return data || null;
  }
  return localUsers.find(u => u.id === id) || null;
}

async function saveUser(user) {
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .insert([{
        id: user.id,
        email: user.email,
        password_hash: user.password_hash,
        full_name: user.full_name,
        role: user.role || 'user',
        is_active: true,
        created_at: user.created_at
      }])
      .select('id, email, full_name, role, is_active, created_at')
      .single();

    if (error) {
      throw databaseUnavailable('guardar la cuenta', error);
    }
    return data;
  }
  localUsers.push(user);
  return user;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name || user.fullName,
    role: user.role || 'user',
    isActive: user.is_active !== false,
    createdAt: user.created_at || user.createdAt
  };
}

async function listUsers() {
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active, created_at')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[Auth DB] listUsers:', error.message);
      throw new Error('No se pudieron cargar los usuarios.');
    }
    return data.map(publicUser);
  }
  return localUsers
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(publicUser);
}

async function setUserStatus(id, isActive) {
  if (supabase) {
    const { error } = await supabase.rpc('admin_set_user_status', {
      target_user_id: id,
      new_is_active: isActive
    });
    if (error) {
      console.error('[Auth DB] setUserStatus:', error.message);
      if (error.code === 'P0001') throw new Error('No puedes suspender al último administrador activo.');
      throw new Error('No se pudo actualizar el estado de la cuenta.');
    }
    return findUserById(id);
  }

  const user = localUsers.find(entry => entry.id === id);
  if (!user) return null;
  if (!isActive && user.role === 'admin' && user.is_active !== false &&
      localUsers.filter(entry => entry.role === 'admin' && entry.is_active !== false).length <= 1) {
    throw new Error('No puedes suspender al último administrador activo.');
  }
  user.is_active = isActive;
  user.updated_at = new Date().toISOString();
  return user;
}

async function setUserRole(id, role) {
  if (supabase) {
    const { error } = await supabase.rpc('admin_set_user_role', {
      target_user_id: id,
      new_role: role
    });
    if (error) {
      console.error('[Auth DB] setUserRole:', error.message);
      if (error.code === 'P0001') throw new Error('No puedes retirar el rol del último administrador activo.');
      throw new Error('No se pudo actualizar el rol del usuario.');
    }
    return findUserById(id);
  }

  const user = localUsers.find(entry => entry.id === id);
  if (!user) return null;
  if (role !== 'admin' && user.role === 'admin' && user.is_active !== false &&
      localUsers.filter(entry => entry.role === 'admin' && entry.is_active !== false).length <= 1) {
    throw new Error('No puedes retirar el rol del último administrador activo.');
  }
  user.role = role;
  user.updated_at = new Date().toISOString();
  return user;
}

async function deleteUserAccount(id) {
  if (supabase) {
    const { data, error } = await supabase.rpc('admin_delete_user', {
      target_user_id: id
    });
    if (error) {
      console.error('[Auth DB] deleteUserAccount:', error.message);
      if (error.code === 'P0001') throw new Error('No puedes eliminar al último administrador activo.');
      throw new Error('No se pudo eliminar la cuenta.');
    }
    return data === true;
  }

  const user = localUsers.find(entry => entry.id === id);
  if (!user) return false;
  if (user.role === 'admin' && user.is_active !== false &&
      localUsers.filter(entry => entry.role === 'admin' && entry.is_active !== false).length <= 1) {
    throw new Error('No puedes eliminar al último administrador activo.');
  }
  await require('./db').deleteProfilesForUser(id);
  localUsers.splice(localUsers.indexOf(user), 1);
  return true;
}

// ==========================================
// 🛡️ MIDDLEWARE DE AUTENTICACIÓN JWT
// ==========================================

/**
 * verifyToken - Middleware que protege rutas privadas.
 * Extrae el JWT del header Authorization: Bearer <token>
 * Si es válido, agrega req.user con los datos del usuario.
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Acceso denegado.',
      detail: 'Token de autenticación no proporcionado. Incluye el header: Authorization: Bearer <token>'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await findUserById(decoded.userId);
    if (!user || user.is_active === false) {
      return res.status(401).json({
        error: 'Esta cuenta está suspendida o ya no existe.',
        code: 'ACCOUNT_SUSPENDED'
      });
    }
    req.user = {
      ...decoded,
      email: user.email,
      fullName: user.full_name || user.fullName,
      role: user.role || 'user'
    };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expirado.',
        detail: 'Tu sesión ha vencido. Inicia sesión nuevamente.',
        code: 'TOKEN_EXPIRED'
      });
    }
    if (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError') {
      return res.status(403).json({
        error: 'Token inválido.',
        detail: 'El token proporcionado no es válido o fue manipulado.',
        code: 'TOKEN_INVALID'
      });
    }
    console.error('[Auth] Error al validar el usuario autenticado:', error);
    return res.status(503).json({ error: 'No se pudo verificar el estado de la cuenta.' });
  }
};

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Se requieren privilegios de administrador.' });
  }
  next();
}

// ==========================================
// RUTAS DE AUTENTICACIÓN (Públicas)
// ==========================================

router.post('/register', (req, res) => {
  res.status(403).json({
    error: 'El registro está cerrado. Solicita una invitación al administrador.',
    code: 'INVITATION_REQUIRED',
  });
});

router.get('/invitation/:token', async (req, res) => {
  const { token } = req.params;
  if (!INVITATION_TOKEN_PATTERN.test(token)) {
    return res.status(400).json({ error: 'El enlace de invitación no es válido.' });
  }
  try {
    const invitation = await findValidInvitation(hashInvitationToken(token));
    if (!invitation) {
      return res.status(410).json({ error: 'La invitación expiró, ya se usó o fue revocada.' });
    }
    res.json({
      email: invitation.email,
      fullName: invitation.full_name,
      expiresAt: invitation.expires_at,
    });
  } catch (error) {
    console.error('[Auth] Error al consultar la invitación:', error);
    res.status(503).json({ error: 'No se pudo validar la invitación.' });
  }
});

router.post('/invitation/accept', async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !INVITATION_TOKEN_PATTERN.test(token)) {
    return res.status(400).json({ error: 'El enlace de invitación no es válido.' });
  }
  if (typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await acceptInvitation(hashInvitationToken(token), passwordHash);
    console.log(`[Auth] Invitación aceptada: ${user.email}`);
    res.status(201).json({
      message: 'Cuenta activada. Ya puedes iniciar sesión.',
      user: publicUser(user),
    });
  } catch (error) {
    if (error.message.includes('invitación')) {
      return res.status(410).json({ error: error.message });
    }
    if (error.message.includes('ya tiene una cuenta')) {
      return res.status(409).json({ error: error.message });
    }
    if (error.code === 'DATABASE_UNAVAILABLE') {
      return res.status(503).json({ error: 'No se pudo conectar con Supabase.' });
    }
    console.error('[Auth] Error al aceptar invitación:', error);
    res.status(503).json({ error: error.message || 'No se pudo activar la cuenta.' });
  }
});

router.get('/admin/invitations', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json(await listInvitations());
  } catch (error) {
    console.error('[Auth] Error al listar invitaciones:', error);
    res.status(500).json({ error: error.message || 'No se pudieron cargar las invitaciones.' });
  }
});

router.post('/admin/invitations', verifyToken, requireAdmin, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
  }
  if (!fullName || fullName.length > 160) {
    return res.status(400).json({ error: 'Ingresa un nombre de hasta 160 caracteres.' });
  }
  try {
    if (await findUserByEmail(email)) {
      return res.status(409).json({ error: 'Ese correo ya tiene una cuenta. Puedes reactivarla desde la administración.' });
    }
    const token = randomBytes(32).toString('base64url');
    const invitation = await createInvitation({
      email,
      fullName,
      tokenHash: hashInvitationToken(token),
      createdBy: req.user.userId,
    });
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const invitationUrl = new URL(`/accept-invitation.html?token=${encodeURIComponent(token)}`, baseUrl).toString();
    res.status(201).json({
      invitation,
      invitationUrl,
      message: 'Enlace generado. Cópialo ahora y envíalo al usuario; no volverá a mostrarse.',
    });
  } catch (error) {
    if (error.message.includes('ya tiene una cuenta')) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[Auth] Error al crear invitación:', error);
    res.status(500).json({ error: error.message || 'No se pudo crear la invitación.' });
  }
});

router.post('/admin/invitations/:id/revoke', verifyToken, requireAdmin, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: 'El identificador de invitación no es válido.' });
  }
  try {
    if (!await revokeInvitation(req.params.id)) {
      return res.status(404).json({ error: 'La invitación no existe o ya fue utilizada/revocada.' });
    }
    res.json({ message: 'Invitación revocada.' });
  } catch (error) {
    console.error('[Auth] Error al revocar invitación:', error);
    res.status(500).json({ error: 'No se pudo revocar la invitación.' });
  }
});

/**
 * POST /api/auth/login
 * Iniciar sesión y obtener un token JWT.
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'El correo y la contraseña son obligatorios.' });
    }

    // Buscar usuario por correo
    const user = await findUserByEmail(email);

    if (user?.is_active === false) {
      return res.status(403).json({
        error: 'La cuenta está suspendida. Contacta al administrador.',
        code: 'ACCOUNT_SUSPENDED'
      });
    }

    // Comparar contraseña (timing-safe gracias a bcrypt.compare)
    const passwordField = user?.password_hash || user?.passwordHash;
    const isValid = user && passwordField && await bcrypt.compare(password, passwordField);

    if (!isValid) {
      // Mismo mensaje para no revelar si el email existe o no
      return res.status(401).json({ error: 'Credenciales inválidas. Verifica tu correo y contraseña.' });
    }

    // Generar JWT firmado
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role || 'user'
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Calcular tiempo de expiración legible
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    console.log(`[Auth] Login exitoso: ${user.email}`);

    res.json({
      message: 'Inicio de sesión exitoso.',
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name || user.fullName,
        role: user.role || 'user',
        isActive: user.is_active !== false
      }
    });
  } catch (error) {
    console.error('[Auth] Error en /login:', error);
    if (error.code === 'DATABASE_UNAVAILABLE') {
      return res.status(503).json({
        error: 'No se pudo conectar con Supabase. Revisa la URL del proyecto y la conexión.'
      });
    }
    res.status(500).json({ error: 'Error interno al procesar el inicio de sesión.' });
  }
});

/**
 * GET /api/auth/me
 * Obtener información del usuario autenticado actualmente.
 * Requiere: Authorization: Bearer <token>
 */
router.get('/me', verifyToken, (req, res) => {
  res.json({
    id: req.user.userId,
    email: req.user.email,
    fullName: req.user.fullName,
    role: req.user.role,
    isActive: true,
    tokenInfo: {
      issuedAt: new Date(req.user.iat * 1000).toISOString(),
      expiresAt: new Date(req.user.exp * 1000).toISOString()
    }
  });
});

router.get('/admin/users', verifyToken, requireAdmin, async (req, res) => {
  try {
    res.json(await listUsers());
  } catch (error) {
    console.error('[Auth] Error al listar usuarios:', error);
    res.status(500).json({ error: 'No se pudieron cargar los usuarios.' });
  }
});

router.patch('/admin/users/:id/status', verifyToken, requireAdmin, async (req, res) => {
  const { isActive } = req.body;
  if (!UUID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: 'El identificador del usuario no es válido.' });
  }
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive debe ser un valor booleano.' });
  }
  if (req.params.id === req.user.userId) {
    return res.status(400).json({ error: 'No puedes cambiar el estado de tu propia cuenta.' });
  }

  try {
    const user = await setUserStatus(req.params.id, isActive);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json(publicUser(user));
  } catch (error) {
    if (error.message.includes('último administrador')) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[Auth] Error al cambiar estado de usuario:', error);
    res.status(500).json({ error: 'No se pudo cambiar el estado del usuario.' });
  }
});

router.patch('/admin/users/:id/role', verifyToken, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!UUID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: 'El identificador del usuario no es válido.' });
  }
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'role debe ser "user" o "admin".' });
  }
  if (req.params.id === req.user.userId) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol.' });
  }

  try {
    const user = await setUserRole(req.params.id, role);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json(publicUser(user));
  } catch (error) {
    if (error.message.includes('último administrador')) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[Auth] Error al cambiar rol de usuario:', error);
    res.status(500).json({ error: 'No se pudo cambiar el rol del usuario.' });
  }
});

router.delete('/admin/users/:id', verifyToken, requireAdmin, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: 'El identificador del usuario no es válido.' });
  }
  if (req.params.id === req.user.userId) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  }

  try {
    const deleted = await deleteUserAccount(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ message: 'Cuenta y perfiles asociados eliminados.' });
  } catch (error) {
    if (error.message.includes('último administrador')) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[Auth] Error al eliminar cuenta:', error);
    res.status(500).json({ error: 'No se pudo eliminar la cuenta.' });
  }
});

/**
 * POST /api/auth/verify
 * Verificar si un token JWT es válido (útil para el frontend).
 * Body: { token }
 */
router.post('/verify', verifyToken, (req, res) => {
  res.json({
    valid: true,
    user: {
      id: req.user.userId,
      email: req.user.email,
      fullName: req.user.fullName,
      role: req.user.role
    },
    expiresAt: new Date(req.user.exp * 1000).toISOString()
  });
});

const authModule = { router, verifyToken };
if (process.env.NODE_ENV === 'test') {
  authModule.setLocalUserRoleForTests = (id, role) => {
    const user = localUsers.find(entry => entry.id === id);
    if (!user) throw new Error('Test user not found.');
    user.role = role;
  };
  authModule.createLocalUserForTests = async ({ email, password, fullName, role = 'user' }) => {
    if (supabase) throw new Error('Local test users cannot be created while Supabase is configured.');
    const user = await saveUser({
      id: uuidv4(),
      email: email.toLowerCase(),
      password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      full_name: fullName,
      role,
      is_active: true,
      created_at: new Date().toISOString(),
    });
    return publicUser(user);
  };
}
module.exports = authModule;
