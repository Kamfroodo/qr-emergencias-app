/**
 * db.js - Capa de persistencia para Fichas Médicas de Emergencia
 * Soporta Supabase (PostgreSQL en la nube) con fallback a memoria local.
 */

const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const profilePhotoBucket = process.env.SUPABASE_PHOTO_BUCKET || 'medical-photos';

let supabase = null;

if (supabaseUrl && supabaseKey && !supabaseKey.includes('tu_supabase')) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[DB] Conectado exitosamente a Supabase PostgreSQL:', supabaseUrl);
  } catch (err) {
    console.error('[DB] Error inicializando cliente de Supabase:', err.message);
    if (process.env.NODE_ENV === 'production') throw err;
  }
} else {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para persistencia en producción.');
  }
  console.log('[DB] Modo local/memoria activo (configura SUPABASE_SERVICE_ROLE_KEY para persistencia en la nube)');
}

let localProfiles = [];

// Helper para mapear columnas de base de datos SQL a camelCase de JavaScript
function mapFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    public_token: row.public_token,
    is_active: row.is_active !== false,
    fullName: row.full_name,
    birthDate: row.birth_date,
    age: row.age,
    nationalId: row.national_id,
    bloodType: row.blood_type,
    organDonor: Boolean(row.organ_donor),
    photoUrl: row.photo_url || '',
    primaryContact: row.primary_contact || {},
    secondaryContact: row.secondary_contact || {},
    allergies: row.allergies || [],
    conditions: row.conditions || [],
    medications: row.medications || [],
    insurance: row.insurance || {},
    preferredHospital: row.preferred_hospital || '',
    medicalNotes: row.medical_notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Helper para mapear objeto JS a columnas SQL de Supabase
function mapToDb(p) {
  return {
    id: p.id,
    user_id: p.user_id || null,
    public_token: p.public_token,
    is_active: p.is_active !== false,
    full_name: p.fullName || p.profile_name,
    birth_date: p.birthDate || p.birth_date || null,
    age: p.age ?? null,
    national_id: p.nationalId || p.national_id || '',
    blood_type: p.bloodType || p.blood_type,
    organ_donor: Boolean(p.organDonor || p.organ_donor),
    photo_url: p.photoUrl || p.photo_url || '',
    primary_contact: p.primaryContact || {},
    secondary_contact: p.secondaryContact || {},
    allergies: p.allergies || [],
    conditions: p.conditions || p.critical_conditions || [],
    medications: p.medications || [],
    insurance: p.insurance || {},
    preferred_hospital: p.preferredHospital || p.preferred_hospital || '',
    medical_notes: p.medicalNotes || p.medical_notes || '',
    updated_at: new Date().toISOString()
  };
}

// ==========================================
// MÉTODOS DE BASE DE DATOS
// ==========================================

async function getAllProfiles(userId) {
  if (supabase) {
    let query = supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;

    if (error) {
      console.error('[DB Error] getAllProfiles:', error.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('No se pudieron cargar los perfiles desde Supabase.');
      }
      return userId ? localProfiles.filter(profile => profile.user_id === userId) : localProfiles;
    }
    return data.map(mapFromDb);
  }
  return userId ? localProfiles.filter(profile => profile.user_id === userId) : localProfiles;
}

async function getProfileByIdOrToken(identifier, userId) {
  if (!identifier) return null;

  if (supabase) {
    // Buscar por ID interno o por token público
    let query = supabase
      .from('profiles')
      .select('*')
      .or(`id.eq.${identifier},public_token.eq.${identifier}`)
      .limit(1);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('[DB Error] getProfileByIdOrToken:', error.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('No se pudo consultar el perfil en Supabase.');
      }
      return localProfiles.find(p =>
        (p.id === identifier || p.public_token === identifier) &&
        (!userId || p.user_id === userId)
      ) || null;
    }
    return mapFromDb(data);
  }

  return localProfiles.find(p =>
    (p.id === identifier || p.public_token === identifier) &&
    (!userId || p.user_id === userId)
  ) || null;
}

async function createProfile(profileData) {
  if (supabase) {
    const dbRow = mapToDb(profileData);
    dbRow.created_at = new Date().toISOString();
    const { data, error } = await supabase.rpc('create_profile_with_limit', {
      target_user_id: profileData.user_id,
      profile_data: dbRow,
    });

    if (error) {
      console.error('[DB Error] createProfile:', error.message);
      if (error.code === 'P0001' && error.message.includes('PROFILE_LIMIT_REACHED')) {
        const limitError = new Error('Se alcanzó el límite de fichas médicas asignado a esta cuenta.');
        limitError.code = 'PROFILE_LIMIT_REACHED';
        throw limitError;
      }
      throw new Error('Error al guardar en Supabase: ' + error.message);
    }
    return mapFromDb(Array.isArray(data) ? data[0] : data);
  }

  localProfiles.unshift(profileData);
  return profileData;
}

async function updateProfile(id, profileData, userId) {
  const existing = await getProfileByIdOrToken(id, userId);
  if (!existing) return null;
  const updatedProfile = {
    ...existing,
    ...profileData,
    id: existing.id,
    user_id: existing.user_id,
    public_token: existing.public_token,
    is_active: existing.is_active,
    primaryContact: { ...existing.primaryContact, ...profileData.primaryContact },
    secondaryContact: { ...existing.secondaryContact, ...profileData.secondaryContact },
    insurance: { ...existing.insurance, ...profileData.insurance },
    updatedAt: new Date().toISOString()
  };

  if (supabase) {
    const dbRow = mapToDb(updatedProfile);

    let query = supabase
      .from('profiles')
      .update(dbRow)
      .eq('id', existing.id);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.select().maybeSingle();

    if (error) {
      console.error('[DB Error] updateProfile:', error.message);
      throw new Error('Error al actualizar en Supabase: ' + error.message);
    }
    return mapFromDb(data);
  }

  const index = localProfiles.findIndex(p => p.id === existing.id);
  if (index === -1 || (userId && localProfiles[index].user_id !== userId)) return null;
  localProfiles[index] = updatedProfile;
  return localProfiles[index];
}

async function saveProfilePhoto(id, userId, file, contentType) {
  const existing = await getProfileByIdOrToken(id, userId);
  if (!existing) return null;

  let photoUrl;
  if (supabase) {
    const storagePath = `${existing.id}/profile-photo`;
    const storage = supabase.storage.from(profilePhotoBucket);
    const { error } = await storage.upload(storagePath, file, {
      cacheControl: '0',
      contentType,
      upsert: true,
    });

    if (error) {
      console.error('[DB Error] saveProfilePhoto:', error.message);
      throw new Error(`No se pudo guardar la foto. Verifica el bucket público "${profilePhotoBucket}" en Supabase Storage.`);
    }

    photoUrl = `${storage.getPublicUrl(storagePath).data.publicUrl}?v=${Date.now()}`;
  } else {
    photoUrl = `data:${contentType};base64,${file.toString('base64')}`;
  }

  return updateProfile(existing.id, { photoUrl }, userId);
}

async function deleteProfile(id, userId) {
  if (supabase) {
    let query = supabase
      .from('profiles')
      .delete()
      .eq('id', id);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.select('id');

    if (error) {
      console.error('[DB Error] deleteProfile:', error.message);
      throw new Error('Error al eliminar en Supabase: ' + error.message);
    }
    return data.length > 0;
  }

  const initLen = localProfiles.length;
  localProfiles = localProfiles.filter(p => p.id !== id || (userId && p.user_id !== userId));
  return localProfiles.length < initLen;
}

async function deleteProfilesForUser(userId) {
  if (supabase) {
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.error('[DB Error] deleteProfilesForUser:', error.message);
      throw new Error('No se pudieron eliminar los perfiles asociados al usuario.');
    }
    return;
  }
  localProfiles = localProfiles.filter(profile => profile.user_id !== userId);
}

async function toggleProfileStatus(id, explicitStatus, userId) {
  const existing = await getProfileByIdOrToken(id, userId);
  if (!existing) return null;

  const newStatus = typeof explicitStatus === 'boolean' ? explicitStatus : !existing.is_active;

  if (supabase) {
    let query = supabase
      .from('profiles')
      .update({ is_active: newStatus, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.select().maybeSingle();

    if (error) {
      console.error('[DB Error] toggleProfileStatus:', error.message);
      throw new Error('Error al actualizar estado en Supabase: ' + error.message);
    }
    return mapFromDb(data);
  }

  existing.is_active = newStatus;
  existing.updatedAt = new Date().toISOString();
  return existing;
}

function isSupabaseConnected() {
  return Boolean(supabase);
}

module.exports = {
  getAllProfiles,
  getProfileByIdOrToken,
  createProfile,
  updateProfile,
  saveProfilePhoto,
  deleteProfile,
  deleteProfilesForUser,
  toggleProfileStatus,
  isSupabaseConnected
};
