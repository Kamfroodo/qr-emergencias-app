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
      .select('id, email, full_name, role, created_at')
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
        created_at: user.created_at
      }])
      .select('id, email, full_name, role, created_at')
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

// ==========================================
// 🛡️ MIDDLEWARE DE AUTENTICACIÓN JWT
// ==========================================

/**
 * verifyToken - Middleware que protege rutas privadas.
 * Extrae el JWT del header Authorization: Bearer <token>
 * Si es válido, agrega req.user con los datos del usuario.
 */
const verifyToken = (req, res, next) => {
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
    req.user = decoded; // { userId, email, role, iat, exp }
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expirado.',
        detail: 'Tu sesión ha vencido. Inicia sesión nuevamente.',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(403).json({
      error: 'Token inválido.',
      detail: 'El token proporcionado no es válido o fue manipulado.',
      code: 'TOKEN_INVALID'
    });
  }
};

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
        role: user.role || 'user'
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
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await findUserById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.full_name || user.fullName,
      role: user.role || 'user',
      tokenInfo: {
        issuedAt: new Date(req.user.iat * 1000).toISOString(),
        expiresAt: new Date(req.user.exp * 1000).toISOString()
      }
    });
  } catch (error) {
    console.error('[Auth] Error en /me:', error);
    res.status(500).json({ error: 'Error al obtener datos del usuario.' });
  }
});

/**
 * POST /api/auth/verify
 * Verificar si un token JWT es válido (útil para el frontend).
 * Body: { token }
 */
router.post('/verify', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ valid: false, error: 'No se proporcionó token.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({
      valid: true,
      user: {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role
      },
      expiresAt: new Date(decoded.exp * 1000).toISOString()
    });
  } catch (error) {
    res.json({
      valid: false,
      error: error.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido'
    });
  }
});

module.exports = { router, verifyToken };
