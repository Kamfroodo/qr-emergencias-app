-- =========================================================================
-- Planes asignados por el administrador al invitar — QR Emergencias
--
-- Aplicar UNA vez en Supabase (SQL Editor) ANTES de desplegar la versión que
-- incluye este archivo. Requiere supabase_access_control.sql y
-- supabase_account_limits.sql ya aplicados.
--
-- Cambios:
--   1. user_invitations.plan_type: el plan que eligió el administrador.
--      Las invitaciones pendientes anteriores quedan como 'individual'
--      (el plan más restrictivo); renuévalas desde el panel si corresponde.
--   2. admin_create_user_invitation recibe el plan.
--   3. accept_user_invitation crea la cuenta con los límites del plan en la
--      misma transacción (el usuario ya no puede elegir su plan).
--
-- Debe coincidir con getLimitsForPlan() en auth.js (modo local).
-- =========================================================================

BEGIN;

ALTER TABLE public.user_invitations
    ADD COLUMN IF NOT EXISTS plan_type TEXT NOT NULL DEFAULT 'individual';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.user_invitations'::regclass
          AND conname = 'user_invitations_plan_type_valid'
    ) THEN
        ALTER TABLE public.user_invitations
            ADD CONSTRAINT user_invitations_plan_type_valid
            CHECK (plan_type IN ('individual', 'familiar', 'institucion', 'ilimitado'));
    END IF;
END;
$$;

-- La firma cambia (nuevo parámetro), así que se elimina la versión anterior.
DROP FUNCTION IF EXISTS public.admin_create_user_invitation(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.admin_create_user_invitation(
    target_email TEXT,
    target_full_name TEXT,
    target_plan_type TEXT,
    target_token_hash TEXT,
    target_created_by UUID,
    target_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    invitation_id UUID;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF target_email IS DISTINCT FROM lower(trim(target_email))
       OR target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR target_full_name IS NULL
       OR length(trim(target_full_name)) NOT BETWEEN 1 AND 160
       OR target_plan_type IS NULL
       OR target_plan_type NOT IN ('individual', 'familiar', 'institucion', 'ilimitado')
       OR target_token_hash !~ '^[0-9a-f]{64}$'
       OR target_expires_at <= NOW()
       OR target_expires_at > NOW() + INTERVAL '7 days' THEN
        RAISE EXCEPTION 'invalid invitation' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(284736103);

    IF EXISTS (SELECT 1 FROM public.users WHERE email = target_email) THEN
        RAISE EXCEPTION 'account already exists' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.user_invitations
    SET revoked_at = NOW()
    WHERE email = target_email AND used_at IS NULL AND revoked_at IS NULL;

    INSERT INTO public.user_invitations (
        email, full_name, plan_type, token_hash, created_by, expires_at
    ) VALUES (
        target_email, trim(target_full_name), target_plan_type, target_token_hash, target_created_by, target_expires_at
    )
    RETURNING id INTO invitation_id;

    RETURN invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_user_invitation(
    target_token_hash TEXT,
    target_password_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    invitation public.user_invitations%ROWTYPE;
    new_user_id UUID;
    plan_max_profiles INTEGER;
    plan_expires_at TIMESTAMPTZ;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF target_token_hash !~ '^[0-9a-f]{64}$'
       OR target_password_hash IS NULL
       OR target_password_hash !~ '^\$2[aby]\$12\$' THEN
        RAISE EXCEPTION 'invalid invitation acceptance' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(284736103);

    SELECT * INTO invitation
    FROM public.user_invitations
    WHERE token_hash = target_token_hash
    FOR UPDATE;

    IF NOT FOUND
       OR invitation.used_at IS NOT NULL
       OR invitation.revoked_at IS NOT NULL
       OR invitation.expires_at <= NOW() THEN
        RAISE EXCEPTION 'invitation is invalid' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (SELECT 1 FROM public.users WHERE email = invitation.email) THEN
        RAISE EXCEPTION 'invited account already exists' USING ERRCODE = 'P0001';
    END IF;

    CASE invitation.plan_type
        WHEN 'individual' THEN
            plan_max_profiles := 1;
            plan_expires_at := NOW() + INTERVAL '1 year';
        WHEN 'familiar' THEN
            plan_max_profiles := 5;
            plan_expires_at := NOW() + INTERVAL '1 year';
        WHEN 'institucion' THEN
            plan_max_profiles := 100;
            plan_expires_at := NOW() + INTERVAL '6 months';
        WHEN 'ilimitado' THEN
            plan_max_profiles := NULL;
            plan_expires_at := NULL;
        ELSE
            RAISE EXCEPTION 'invitation has no valid plan' USING ERRCODE = '22023';
    END CASE;

    INSERT INTO public.users (
        email, password_hash, full_name, role, is_active, max_profiles, account_expires_at
    ) VALUES (
        invitation.email, target_password_hash, invitation.full_name, 'user', TRUE,
        plan_max_profiles, plan_expires_at
    )
    RETURNING id INTO new_user_id;

    UPDATE public.user_invitations
    SET used_at = NOW()
    WHERE id = invitation.id;

    RETURN new_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user_invitation(TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_user_invitation(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_user_invitation(TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_user_invitation(TEXT, TEXT) TO service_role;

COMMIT;

-- Revisión recomendada tras aplicar: cuentas sin límite de fichas ni vencimiento.
-- Antes de este cambio, una cuenta podía quedar así sin haber pagado.
-- SELECT id, email, full_name, created_at FROM public.users
-- WHERE role = 'user' AND max_profiles IS NULL AND account_expires_at IS NULL;
