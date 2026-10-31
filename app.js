/**
 * app.js - Configuración de Express, middlewares y rutas de API
 * Módulo desacoplado del listener HTTP para facilitar pruebas unitarias y de integración.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const QRCode = require('qrcode');
const swaggerUi = require('swagger-ui-express');
const { v4: uuidv4 } = require('uuid');
const openApiSpec = require('./openapi');

// Sistema de autenticación JWT
const { router: authRouter, verifyToken } = require('./auth');

const app = express();

// ==========================================
// Middlewares Globales
// ==========================================
app.use(cors());

// Helmet para cabeceras seguras (ajustado para permitir estilos y scripts locales)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://*", "http://*"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos del Frontend
app.use(express.static(path.join(__dirname, 'public')));

// Documentación interactiva de la API
app.get('/api-docs.json', (req, res) => {
  res.json(openApiSpec);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customSiteTitle: 'QR Emergencias API',
  swaggerOptions: {
    persistAuthorization: false,
  },
}));

// Conexión a Base de Datos (Supabase con fallback local)
const db = require('./db');

// ==========================================
// Rutas de Autenticación
// ==========================================
app.use('/api/auth', authRouter);

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Se requieren privilegios de administrador.' });
  }
  next();
}

function calculateAge(birthDate) {
  const match = typeof birthDate === 'string' && birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.toISOString().slice(0, 10) !== birthDate) return null;

  const today = new Date().toISOString().slice(0, 10);
  if (birthDate > today) return null;

  const [currentYear, currentMonth, currentDay] = today.split('-').map(Number);
  const age = currentYear - year - (
    currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0
  );
  return age <= 130 ? age : null;
}

// ==========================================
// Rutas de Verificación de Salud (Health Check)
// ==========================================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'qr-emergencias-app',
    database: db.isSupabaseConnected() ? 'supabase_cloud' : 'local_memory',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

// ==========================================
// Rutas de API - Perfiles de Emergencia
// ==========================================

// --- 1. ENDPOINT PÚBLICO V1 (Escaneo del QR por Paramédicos) ---
// Acceso instantáneo con token público seguro sin exponer el ID interno
app.get('/api/v1/emergency/:publicToken', async (req, res) => {
  try {
    const { publicToken } = req.params;

    // Buscar en base de datos por token público o ID
    const profile = await db.getProfileByIdOrToken(publicToken);

    if (!profile) {
      return res.status(404).json({ error: 'Perfil de emergencia no encontrado.' });
    }

    // Verificar si la tarjeta QR fue pausada o desactivada por el titular
    if (profile.is_active === false) {
      return res.status(403).json({
        error: 'Perfil no disponible o desactivado temporalmente.',
        is_active: false,
        message: 'Esta ficha médica ha sido pausada o revocada por el titular.'
      });
    }

    // Retornamos únicamente la información vital para paramédicos/emergencias
    res.json({
      id: profile.id,
      public_token: profile.public_token,
      is_active: profile.is_active !== false,
      profile_name: profile.fullName,
      fullName: profile.fullName,
      photo_url: profile.photoUrl || '',
      photoUrl: profile.photoUrl || '',
      birth_date: profile.birthDate || '',
      birthDate: profile.birthDate || '',
      age: profile.age,
      national_id: profile.nationalId || '',
      nationalId: profile.nationalId || '',
      blood_type: profile.bloodType,
      bloodType: profile.bloodType,
      organ_donor: Boolean(profile.organDonor),
      organDonor: Boolean(profile.organDonor),
      critical_conditions: profile.conditions || [],
      conditions: profile.conditions || [],
      allergies: profile.allergies || [],
      medications: profile.medications || [],
      medical_notes: profile.medicalNotes || '',
      medicalNotes: profile.medicalNotes || '',
      emergency_contacts: [
        profile.primaryContact,
        profile.secondaryContact
      ].filter(c => c && (c.name || c.phone)),
      primaryContact: profile.primaryContact,
      secondaryContact: profile.secondaryContact,
      insurance: profile.insurance,
      preferred_hospital: profile.preferredHospital,
      preferredHospital: profile.preferredHospital
    });
  } catch (error) {
    console.error('Error en /api/v1/emergency:', error);
    res.status(500).json({ error: 'Error al consultar la ficha médica.' });
  }
});

// 2. Obtener todos los perfiles (para el Dashboard)
app.get('/api/profiles', verifyToken, async (req, res) => {
  try {
    const all = await db.getAllProfiles(req.user.userId);
    const summaryList = all.map(p => ({
      id: p.id,
      public_token: p.public_token,
      is_active: p.is_active !== false,
      fullName: p.fullName,
      age: p.age,
      bloodType: p.bloodType,
      organDonor: p.organDonor,
      nationalId: p.nationalId,
      primaryContact: p.primaryContact,
      conditionsCount: Array.isArray(p.conditions) ? p.conditions.length : 0,
      allergiesCount: Array.isArray(p.allergies) ? p.allergies.length : 0,
      updatedAt: p.updatedAt
    }));
    res.json(summaryList);
  } catch (error) {
    console.error('Error al listar perfiles:', error);
    res.status(500).json({ error: 'Error al recuperar perfiles.' });
  }
});

app.get('/api/admin/profiles', verifyToken, requireAdmin, async (req, res) => {
  try {
    const profiles = await db.getAllProfiles();
    res.json(profiles.map(profile => ({
      id: profile.id,
      ownerUserId: profile.user_id,
      fullName: profile.fullName,
      bloodType: profile.bloodType,
      isActive: profile.is_active !== false,
      updatedAt: profile.updatedAt,
    })));
  } catch (error) {
    console.error('Error al listar fichas para administración:', error);
    res.status(500).json({ error: 'No se pudieron cargar las fichas médicas.' });
  }
});

app.get('/api/admin/profiles/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const profile = await db.getProfileByIdOrToken(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Ficha médica no encontrada.' });
    res.json(profile);
  } catch (error) {
    console.error('Error al consultar ficha para administración:', error);
    res.status(500).json({ error: 'No se pudo consultar la ficha médica.' });
  }
});

// 3. Obtener un perfil específico por ID o Token (para Dashboard y Vista de Emergencia)
app.get('/api/profiles/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const profile = await db.getProfileByIdOrToken(id, req.user.userId);

    if (!profile) {
      return res.status(404).json({
        error: 'Perfil de emergencia no encontrado',
        id
      });
    }

    res.json(profile);
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({ error: 'Error al obtener el perfil.' });
  }
});

// 4. Crear nuevo perfil de emergencia (Compatible con /api/profiles y /api/v1/profiles)
// 🔒 PROTEGIDO: Requiere token JWT válido (Authorization: Bearer <token>)
const createProfileHandler = async (req, res) => {
  try {
    const body = req.body;
    const fullName = (body.fullName || body.profile_name || '').trim();
    const bloodType = body.bloodType || body.blood_type;

    if (!fullName || !bloodType) {
      return res.status(400).json({
        error: 'Los campos nombre completo (fullName / profile_name) y grupo sanguíneo (bloodType / blood_type) son obligatorios.'
      });
    }

    const birthDate = body.birthDate ?? body.birth_date ?? '';
    const calculatedAge = birthDate ? calculateAge(birthDate) : null;
    if (birthDate && calculatedAge === null) {
      return res.status(400).json({ error: 'La fecha de nacimiento debe ser válida y no futura.' });
    }
    const age = birthDate ? calculatedAge : (body.age == null ? null : Number(body.age));
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130)) {
      return res.status(400).json({ error: 'La edad debe ser un número entero entre 0 y 130.' });
    }

    const internalId = uuidv4();
    const publicToken = uuidv4();

    // Mapeo unificado compatible con snake_case de Gemini y camelCase existente
    const conditions = Array.isArray(body.conditions)
      ? body.conditions
      : (Array.isArray(body.critical_conditions) 
          ? body.critical_conditions 
          : (body.conditions ? body.conditions.split('\n').map(s => s.trim()).filter(Boolean) : []));

    const allergies = Array.isArray(body.allergies)
      ? body.allergies
      : (body.allergies ? body.allergies.split('\n').map(s => s.trim()).filter(Boolean) : []);

    const medications = Array.isArray(body.medications)
      ? body.medications
      : (body.medications ? body.medications.split('\n').map(s => s.trim()).filter(Boolean) : []);

    const primaryContact = body.primaryContact || (body.emergency_contacts && body.emergency_contacts[0]) || {
      name: '',
      relationship: '',
      phone: '',
      whatsapp: ''
    };

    const secondaryContact = body.secondaryContact || (body.emergency_contacts && body.emergency_contacts[1]) || {
      name: '',
      relationship: '',
      phone: '',
      whatsapp: ''
    };

    const newProfile = {
      id: internalId,
      user_id: req.user.userId,
      public_token: publicToken,
      is_active: true,
      fullName,
      birthDate,
      age,
      nationalId: (body.nationalId || body.national_id || '').trim(),
      bloodType,
      organDonor: Boolean(body.organDonor || body.organ_donor),
      photoUrl: body.photoUrl || body.photo_url || '',
      primaryContact: {
        name: primaryContact.name || '',
        relationship: primaryContact.relationship || '',
        phone: primaryContact.phone || '',
        whatsapp: primaryContact.phone ? primaryContact.phone.replace(/[^0-9]/g, '') : ''
      },
      secondaryContact: {
        name: secondaryContact.name || '',
        relationship: secondaryContact.relationship || '',
        phone: secondaryContact.phone || '',
        whatsapp: secondaryContact.phone ? secondaryContact.phone.replace(/[^0-9]/g, '') : ''
      },
      allergies,
      conditions,
      medications,
      insurance: {
        company: body.insurance?.company || '',
        policyNumber: body.insurance?.policyNumber || '',
        emergencyLine: body.insurance?.emergencyLine || ''
      },
      preferredHospital: body.preferredHospital || body.preferred_hospital || '',
      medicalNotes: body.medicalNotes || body.medical_notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saved = await db.createProfile(newProfile);

    res.status(201).json({
      message: 'Perfil de emergencia creado con éxito',
      profile_id: saved.id,
      id: saved.id,
      ...saved
    });
  } catch (error) {
    console.error('Error al crear perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor al generar el perfil: ' + error.message });
  }
};

app.post('/api/profiles', verifyToken, createProfileHandler);
app.post('/api/v1/profiles', verifyToken, createProfileHandler);

// 5. Alternar estado Activo / Pausado de una ficha (Interruptor de seguridad)
// 🔒 PROTEGIDO: Requiere token JWT válido
app.patch('/api/profiles/:id/status', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await db.toggleProfileStatus(id, req.body.is_active, req.user.userId);

    if (!updated) {
      return res.status(404).json({ error: 'Perfil no encontrado.' });
    }

    res.json({
      message: updated.is_active ? 'Ficha médica activada' : 'Ficha médica desactivada',
      id: updated.id,
      is_active: updated.is_active
    });
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Actualizar perfil existente
// 🔒 PROTEGIDO: Requiere token JWT válido
app.put('/api/profiles/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'El cuerpo debe ser un objeto JSON.' });
    }

    const existing = await db.getProfileByIdOrToken(id, req.user.userId);
    if (!existing) {
      return res.status(404).json({ error: 'Perfil de emergencia no encontrado para actualizar.' });
    }

    const editableFields = [
      'fullName', 'birthDate', 'age', 'nationalId', 'bloodType', 'organDonor',
      'photoUrl', 'primaryContact', 'secondaryContact', 'allergies', 'conditions',
      'medications', 'insurance', 'preferredHospital', 'medicalNotes',
    ];
    const updates = Object.fromEntries(
      editableFields.filter(field => Object.hasOwn(body, field)).map(field => [field, body[field]])
    );
    const aliases = {
      profile_name: 'fullName',
      birth_date: 'birthDate',
      national_id: 'nationalId',
      blood_type: 'bloodType',
      organ_donor: 'organDonor',
      photo_url: 'photoUrl',
      critical_conditions: 'conditions',
      preferred_hospital: 'preferredHospital',
      medical_notes: 'medicalNotes',
    };
    for (const [alias, field] of Object.entries(aliases)) {
      if (!Object.hasOwn(updates, field) && Object.hasOwn(body, alias)) updates[field] = body[alias];
    }
    const fullName = updates.fullName ?? existing.fullName;
    const bloodType = updates.bloodType ?? existing.bloodType;

    if (typeof fullName !== 'string' || !fullName.trim() || typeof bloodType !== 'string' || !bloodType.trim()) {
      return res.status(400).json({ error: 'El nombre completo y el grupo sanguíneo son obligatorios.' });
    }

    if (Object.hasOwn(updates, 'birthDate')) {
      if (typeof updates.birthDate !== 'string') {
        return res.status(400).json({ error: 'La fecha de nacimiento debe ser texto con formato AAAA-MM-DD.' });
      }
      if (updates.birthDate) {
        const calculatedAge = calculateAge(updates.birthDate);
        if (calculatedAge === null) {
          return res.status(400).json({ error: 'La fecha de nacimiento debe ser válida y no futura.' });
        }
        updates.age = calculatedAge;
      } else {
        updates.age = null;
      }
    }

    if (Object.hasOwn(updates, 'age') && updates.age !== null) {
      const age = Number(updates.age);
      if (!Number.isInteger(age) || age < 0 || age > 130) {
        return res.status(400).json({ error: 'La edad debe ser un número entero entre 0 y 130.' });
      }
      updates.age = age;
    }

    for (const field of ['primaryContact', 'secondaryContact', 'insurance']) {
      if (Object.hasOwn(updates, field) &&
          (!updates[field] || typeof updates[field] !== 'object' || Array.isArray(updates[field]))) {
        return res.status(400).json({ error: `El campo ${field} debe ser un objeto JSON.` });
      }
    }
    for (const field of ['primaryContact', 'secondaryContact']) {
      if (Object.hasOwn(updates, field) && typeof updates[field].phone === 'string') {
        updates[field] = {
          ...updates[field],
          whatsapp: updates[field].phone.replace(/[^0-9]/g, ''),
        };
      }
    }

    for (const field of ['allergies', 'conditions', 'critical_conditions', 'medications']) {
      if (!Object.hasOwn(updates, field)) continue;
      if (typeof updates[field] === 'string') {
        updates[field] = updates[field].split('\n').map(item => item.trim()).filter(Boolean);
      } else if (Array.isArray(updates[field]) && updates[field].every(item => typeof item === 'string')) {
        updates[field] = updates[field].map(item => item.trim()).filter(Boolean);
      } else {
        return res.status(400).json({ error: `El campo ${field} debe ser una lista de textos.` });
      }
    }

    const updated = await db.updateProfile(id, {
      ...updates,
      fullName: fullName.trim(),
      bloodType: bloodType.trim(),
    }, req.user.userId);

    if (!updated) {
      return res.status(404).json({ error: 'Perfil de emergencia no encontrado para actualizar.' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    res.status(500).json({ error: error.message });
  }
});

const parseProfilePhoto = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: '5mb',
});

function isSupportedImage(file, contentType) {
  if (contentType === 'image/jpeg') {
    return file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return file.length >= 8 && file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/webp') {
    return file.length >= 12 &&
      file.toString('ascii', 0, 4) === 'RIFF' &&
      file.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

app.post('/api/profiles/:id/photo', verifyToken, (req, res, next) => {
  parseProfilePhoto(req, res, error => {
    if (!error) return next();
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'La foto no puede superar 5 MB.' });
    }
    return res.status(400).json({ error: 'No se pudo procesar la imagen.' });
  });
}, async (req, res) => {
  try {
    const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!Buffer.isBuffer(req.body) || !isSupportedImage(req.body, contentType)) {
      return res.status(415).json({ error: 'Usa una imagen JPG, PNG o WebP válida.' });
    }

    const updated = await db.saveProfilePhoto(req.params.id, req.user.userId, req.body, contentType);
    if (!updated) {
      return res.status(404).json({ error: 'Perfil médico no encontrado para esta cuenta.' });
    }
    res.json(updated);
  } catch (error) {
    console.error('Error al guardar foto del perfil:', error);
    res.status(500).json({ error: error.message || 'No se pudo guardar la foto del perfil.' });
  }
});

// 7. Eliminar perfil
// 🔒 PROTEGIDO: Requiere token JWT válido
app.delete('/api/profiles/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const ok = await db.deleteProfile(id, req.user.userId);

    if (!ok) {
      return res.status(404).json({ error: 'Perfil no encontrado.' });
    }

    res.json({ message: 'Perfil eliminado correctamente', id });
  } catch (error) {
    console.error('Error al eliminar perfil:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. Generador de Código QR para el Perfil
// 🔒 PROTEGIDO: Requiere token JWT válido
app.get('/api/profiles/:id/qr', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo un administrador puede consultar o generar códigos QR.' });
  }
  try {
    const { id } = req.params;
    const profile = await db.getProfileByIdOrToken(id, req.user.userId);
    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado para generar código QR' });
    await sendProfileQr(req, res, profile, id);
  } catch (error) {
    console.error('Error al generar código QR:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error generando código QR' });
  }
});

async function sendProfileQr(req, res, profile, profileId) {
  const host = req.get('host');
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${host}`;
  const token = profile.public_token || profile.id;
  const targetUrl = `${baseUrl}/emergency.html?token=${encodeURIComponent(token)}`;
  const format = req.query.format || 'dataurl';

  if (format === 'png') {
    res.setHeader('Content-Type', 'image/png');
    return QRCode.toFileStream(res, targetUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 380,
      color: { dark: '#1e293b', light: '#ffffff' },
    });
  }

  const qrDataUrl = await QRCode.toDataURL(targetUrl, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 380,
    color: { dark: '#111827', light: '#ffffff' },
  });
  res.json({ profileId, fullName: profile.fullName, targetUrl, qrDataUrl });
}

app.get('/api/admin/profiles/:id/qr', verifyToken, requireAdmin, async (req, res) => {
  try {
    const profile = await db.getProfileByIdOrToken(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Ficha no encontrada para generar código QR.' });
    await sendProfileQr(req, res, profile, req.params.id);
  } catch (error) {
    console.error('Error al generar QR de administración:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Error generando código QR.' });
  }
});

// Ruta amigable para acceso directo a ficha por QR: /emergency/:token
app.get('/emergency/:token', (req, res) => {
  const { token } = req.params;
  res.redirect(`/emergency.html?token=${encodeURIComponent(token)}`);
});

// Redirección por defecto: al acceder a la raíz, ir a login (el dashboard requiere JWT)
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Manejador 404 para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador global de errores
app.use((err, req, res, next) => {
  console.error('Error interno del servidor:', err);
  res.status(500).json({ error: 'Ocurrió un error interno en el servidor.' });
});

module.exports = app;
