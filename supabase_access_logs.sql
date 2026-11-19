-- =========================================================================
-- Registro de accesos a fichas médicas — QR Emergencias
--
-- Aplicar UNA vez en Supabase (SQL Editor) ANTES de desplegar la versión que
-- incluye este archivo.
--
-- Guarda escaneos de QR y acciones sobre fichas (ver accessLog.js). No guarda
-- la IP de quien escanea, solo una huella HMAC de 16 caracteres.
-- Retención: 180 días (la app borra lo más antiguo automáticamente).
-- Sin claves foráneas: el registro se conserva aunque se elimine la ficha o la
-- cuenta, para poder auditar esas eliminaciones.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.access_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'ok',
    profile_id UUID,
    profile_owner_id UUID,
    actor_user_id UUID,
    ip_hash TEXT,
    CONSTRAINT access_logs_event_valid CHECK (event IN (
        'public_scan', 'owner_rotate_qr', 'admin_view_profile', 'admin_view_qr',
        'admin_rotate_qr', 'admin_delete_profile', 'admin_delete_user'
    )),
    CONSTRAINT access_logs_outcome_valid CHECK (outcome IN (
        'ok', 'paused', 'account_expired', 'account_suspended'
    )),
    CONSTRAINT access_logs_ip_hash_format CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{16}$')
);

CREATE INDEX IF NOT EXISTS idx_access_logs_created_at
    ON public.access_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_profile
    ON public.access_logs (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_owner
    ON public.access_logs (profile_owner_id, created_at DESC);

ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.access_logs FROM PUBLIC, anon, authenticated;
-- Sin UPDATE: los registros no se modifican, solo se agregan y se depuran.
GRANT SELECT, INSERT, DELETE ON TABLE public.access_logs TO service_role;

COMMIT;
