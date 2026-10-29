/**
 * app.js - Configuración de Express, middlewares y rutas de API
 * Módulo desacoplado del listener HTTP para facilitar pruebas unitarias y de integración.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

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

// Conexión a Base de Datos (Supabase con fallback local)
const db = require('./db');

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
app.get('/api/profiles', async (req, res) => {
  try {
    const all = await db.getAllProfiles();
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

// 3. Obtener un perfil específico por ID o Token (para Dashboard y Vista de Emergencia)
app.get('/api/profiles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const profile = await db.getProfileByIdOrToken(id);

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

    const internalId = uuidv4();
    const publicToken = uuidv4();

    // Base URL para enlace del QR
    const host = req.get('host');
    const protocol = req.protocol;
    const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;
    const targetUrl = `${baseUrl}/emergency.html?token=${publicToken}`;

    // Generar código QR en DataURL
    const qrCodeDataUrl = await QRCode.toDataURL(targetUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 380,
      color: {
        dark: '#111827',
        light: '#ffffff'
      }
    });

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
      user_id: body.user_id || 'user-demo-123',
      public_token: publicToken,
      is_active: true,
      fullName,
      birthDate: body.birthDate || body.birth_date || '',
      age: body.age || null,
      nationalId: (body.nationalId || body.national_id || '').trim(),
      bloodType,
      organDonor: Boolean(body.organDonor || body.organ_donor),
      photoUrl: body.photoUrl || body.photo_url || '',
      primaryContact: {
        name: primaryContact.name || '',
        relationship: primaryContact.relationship || '',
        phone: primaryContact.phone || '',
        whatsapp: primaryContact.whatsapp || (primaryContact.phone ? primaryContact.phone.replace(/[^0-9]/g, '') : '')
      },
      secondaryContact: {
        name: secondaryContact.name || '',
        relationship: secondaryContact.relationship || '',
        phone: secondaryContact.phone || '',
        whatsapp: secondaryContact.whatsapp || (secondaryContact.phone ? secondaryContact.phone.replace(/[^0-9]/g, '') : '')
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
      public_token: publicToken,
      public_url: targetUrl,
      targetUrl,
      qr_code: qrCodeDataUrl,
      qrDataUrl: qrCodeDataUrl,
      ...saved
    });
  } catch (error) {
    console.error('Error al crear perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor al generar el perfil: ' + error.message });
  }
};

app.post('/api/profiles', createProfileHandler);
app.post('/api/v1/profiles', createProfileHandler);

// 5. Alternar estado Activo / Pausado de una ficha (Interruptor de seguridad)
app.patch('/api/profiles/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await db.toggleProfileStatus(id, req.body.is_active);

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
app.put('/api/profiles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await db.updateProfile(id, req.body);

    if (!updated) {
      return res.status(404).json({ error: 'Perfil de emergencia no encontrado para actualizar.' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. Eliminar perfil
app.delete('/api/profiles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ok = await db.deleteProfile(id);

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
app.get('/api/profiles/:id/qr', async (req, res) => {
  try {
    const { id } = req.params;
    const profile = await db.getProfileByIdOrToken(id);

    if (!profile) {
      return res.status(404).json({ error: 'Perfil no encontrado para generar código QR' });
    }

    // Base URL dinámica configurable por entorno o detectada desde el request
    const host = req.get('host');
    const protocol = req.protocol;
    const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;
    const token = profile.public_token || profile.id;
    const targetUrl = `${baseUrl}/emergency.html?token=${encodeURIComponent(token)}`;

    const format = req.query.format || 'dataurl';

    if (format === 'png') {
      res.setHeader('Content-Type', 'image/png');
      return QRCode.toFileStream(res, targetUrl, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 380,
        color: {
          dark: '#1e293b',
          light: '#ffffff'
        }
      });
    }

    // Por defecto retorna objeto JSON con DataURL y targetUrl
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 380,
      color: {
        dark: '#111827',
        light: '#ffffff'
      }
    });

    res.json({
      profileId: id,
      fullName: profile.fullName,
      targetUrl,
      qrDataUrl
    });
  } catch (error) {
    res.status(500).json({ error: 'Error generando código QR', details: error.message });
  }
});

// Redirección por defecto a la vista del panel
app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
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
