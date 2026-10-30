/**
 * auth.js - Autenticación JWT para la plataforma médica QR Emergencias
 * Maneja registro, login, verificación de tokens y gestión de usuarios.
 * Soporta Supabase (tabla `users`) con fallback a memoria local para desarrollo.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
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

async function findUserByEmail(email) {
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[Auth DB] findUserByEmail:', error.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('No se pudo consultar el usuario en Supabase.');
      }
      return localUsers.find(u => u.email === email.toLowerCase()) || null;
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
      console.error('[Auth DB] findUserById:', error.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('No se pudo consultar el usuario en Supabase.');
      }
      return localUsers.find(u => u.id === id) || null;
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
      console.error('[Auth DB] saveUser:', error.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('No se pudo guardar el usuario en Supabase.');
      }
      // Intentar guardar localmente como fallback
      localUsers.push(user);
      return user;
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

/**
 * POST /api/auth/register
 * Registrar un nuevo usuario gestor de perfiles médicos.
 * Body: { email, password, fullName }
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    // Validaciones básicas
    if (!email || !password || !fullName) {
      return res.status(400).json({
        error: 'Faltan campos obligatorios.',
        required: ['email', 'password', 'fullName']
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 8 caracteres.'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'El formato del correo electrónico no es válido.' });
    }

    // Verificar si el correo ya está registrado
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Este correo electrónico ya está registrado.' });
    }

    // Cifrar contraseña con bcrypt (12 rondas = alto nivel de seguridad)
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const newUser = {
      id: uuidv4(),
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      full_name: fullName.trim(),
      role: 'user',
      is_active: true,
      created_at: new Date().toISOString()
    };

    const saved = await saveUser(newUser);

    console.log(`[Auth] Nuevo usuario registrado: ${newUser.email}`);

    res.status(201).json({
      message: 'Usuario registrado con éxito. Ya puedes iniciar sesión.',
      user: {
        id: saved.id || newUser.id,
        email: newUser.email,
        fullName: newUser.full_name,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('[Auth] Error en /register:', error);
    res.status(500).json({ error: 'Error interno al registrar el usuario.' });
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
}
module.exports = authModule;
