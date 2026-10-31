-- =========================================================================
-- Acceso por invitación para QR Emergencias
-- Aplicar una vez en Supabase antes de desplegar la versión de invitaciones.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT user_invitations_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT user_invitations_token_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_user_invitations_email_created
    ON public.user_invitations (email, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invitations_one_open_per_email
    ON public.user_invitations (email)
    WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_invitations TO service_role;

CREATE OR REPLACE FUNCTION public.admin_create_user_invitation(
    target_email TEXT,
    target_full_name TEXT,
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
        email, full_name, token_hash, created_by, expires_at
    ) VALUES (
        target_email, trim(target_full_name), target_token_hash, target_created_by, target_expires_at
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

    INSERT INTO public.users (email, password_hash, full_name, role, is_active)
    VALUES (invitation.email, target_password_hash, invitation.full_name, 'user', TRUE)
    RETURNING id INTO new_user_id;

    UPDATE public.user_invitations
    SET used_at = NOW()
    WHERE id = invitation.id;

    RETURN new_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user_invitation(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_user_invitation(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_user_invitation(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_user_invitation(TEXT, TEXT) TO service_role;

COMMIT;
