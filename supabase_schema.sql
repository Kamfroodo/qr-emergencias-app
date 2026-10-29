-- =========================================================================
-- ESQUEMA DE BASE DE DATOS PARA SUPABASE (POSTGRESQL)
-- Proyecto: QR Emergencias Médicas
-- =========================================================================

-- =========================================================================
-- TABLA: users (Gestores de perfiles médicos con autenticación JWT)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,       -- bcrypt con 12 rondas, NUNCA texto plano
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'user',          -- 'user' | 'admin'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice único en email para búsquedas rápidas de login
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON public.users (email);

-- Habilitar RLS en tabla de usuarios
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- El backend accede a estas tablas con service_role. No habilitar acceso directo
-- desde anon/authenticated: la API pública de emergencias filtra los campos.
DROP POLICY IF EXISTS "Backend puede insertar usuarios" ON public.users;
DROP POLICY IF EXISTS "Usuario puede leer su propio perfil" ON public.users;
DROP POLICY IF EXISTS "Usuario puede actualizarse" ON public.users;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;

-- =========================================================================
-- 1. Crear la tabla de perfiles de emergencia
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT DEFAULT 'user-demo-123',
    public_token UUID DEFAULT gen_random_uuid() UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    full_name TEXT NOT NULL,
    birth_date TEXT,
    age INT,
    national_id TEXT,
    blood_type TEXT NOT NULL,
    organ_donor BOOLEAN DEFAULT FALSE,
    photo_url TEXT,
    primary_contact JSONB DEFAULT '{}'::jsonb,
    secondary_contact JSONB DEFAULT '{}'::jsonb,
    allergies JSONB DEFAULT '[]'::jsonb,
    conditions JSONB DEFAULT '[]'::jsonb,
    medications JSONB DEFAULT '[]'::jsonb,
    insurance JSONB DEFAULT '{}'::jsonb,
    preferred_hospital TEXT,
    medical_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Índices de alta velocidad para escaneo de paramédicos
CREATE INDEX IF NOT EXISTS idx_profiles_public_token ON public.profiles (public_token);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles (is_active);

-- 3. Habilitar Seguridad por Fila (Row Level Security - RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Los clientes anon/authenticated no consultan directamente la tabla. El
-- servidor usa service_role y entrega el subconjunto público por el endpoint QR.
DROP POLICY IF EXISTS "Permitir lectura publica de perfiles activos" ON public.profiles;
DROP POLICY IF EXISTS "Permitir insercion desde la aplicacion" ON public.profiles;
DROP POLICY IF EXISTS "Permitir actualizacion de perfiles" ON public.profiles;
DROP POLICY IF EXISTS "Permitir eliminacion de perfiles" ON public.profiles;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;

-- =========================================================================
-- DATOS DE PRUEBA INICIALES (DEMO)
-- =========================================================================
INSERT INTO public.profiles (
    id,
    public_token,
    is_active,
    full_name,
    birth_date,
    age,
    national_id,
    blood_type,
    organ_donor,
    photo_url,
    primary_contact,
    secondary_contact,
    allergies,
    conditions,
    medications,
    insurance,
    preferred_hospital,
    medical_notes
) VALUES (
    '8f1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d',
    '3d5e7f1a-9b8c-4d2e-1f0a-5b6c7d8e9f0a',
    true,
    'Carlos Andrés Morales Díaz',
    '1988-06-15',
    38,
    '16.789.432-K',
    'O+',
    true,
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
    '{"name": "Sofía Valentina Morales (Esposa)", "relationship": "Cónyuge", "phone": "+56912345678", "whatsapp": "56912345678"}'::jsonb,
    '{"name": "Dr. Roberto Mendoza", "relationship": "Médico de Cabecera", "phone": "+56987654321", "whatsapp": "56987654321"}'::jsonb,
    '["Penicilina (Reacción anafiláctica severa)", "Maní y frutos secos", "Iodo de contraste radiológico"]'::jsonb,
    '["Diabetes Mellitus Tipo 1 (Insulino dependiente)", "Asma bronquial estacional", "Hipertensión arterial controlada"]'::jsonb,
    '["Insulina Glargina 22 UI (cada 24h por la noche)", "Insulina Lispro antes de cada comida", "Salbutamol spray 100mcg (solo rescate)"]'::jsonb,
    '{"company": "Cruz Blanca / Banmédica", "policyNumber": "CB-984420-2026", "emergencyLine": "+56226001000"}'::jsonb,
    'Clínica Alemana / Hospital del Salvador',
    'Usa bomba de infusión continua y sensor continuo de glucosa (Freestyle Libre) en brazo izquierdo. Prótesis de titanio en fémur derecho (año 2019).'
) ON CONFLICT (id) DO NOTHING;
