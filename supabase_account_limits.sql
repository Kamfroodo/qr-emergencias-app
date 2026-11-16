-- =========================================================================
-- Límites y vigencia opcional de cuentas QR Emergencias
-- Aplicar una vez en Supabase antes de desplegar esta versión.
-- NULL en max_profiles/account_expires_at significa sin límite/sin vencimiento.
-- =========================================================================

BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS max_profiles INTEGER,
    ADD COLUMN IF NOT EXISTS account_expires_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND conname = 'users_max_profiles_positive'
    ) THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_max_profiles_positive
            CHECK (max_profiles IS NULL OR max_profiles >= 1);
    END IF;
END;
$$;

COMMENT ON COLUMN public.users.max_profiles IS
    'Maximum number of medical profiles. NULL means unlimited.';
COMMENT ON COLUMN public.users.account_expires_at IS
    'Optional account expiration timestamp. NULL means no expiration.';

ALTER TABLE public.profiles
    ALTER COLUMN user_id DROP DEFAULT;

DELETE FROM public.profiles
WHERE id = '8f1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d'
  AND full_name = 'Carlos Andrés Morales Díaz';

CREATE OR REPLACE FUNCTION public.create_profile_with_limit(
    target_user_id UUID,
    profile_data JSONB
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    profile_limit INTEGER;
    profile_count INTEGER;
    saved_profile public.profiles;
BEGIN
    SELECT max_profiles
    INTO profile_limit
    FROM public.users
    WHERE id = target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND';
    END IF;

    SELECT COUNT(*)
    INTO profile_count
    FROM public.profiles
    WHERE user_id = target_user_id::TEXT;

    IF profile_limit IS NOT NULL AND profile_count >= profile_limit THEN
        RAISE EXCEPTION 'PROFILE_LIMIT_REACHED';
    END IF;

    INSERT INTO public.profiles (
        id, user_id, public_token, is_active, full_name, birth_date, age,
        national_id, blood_type, organ_donor, photo_url, primary_contact,
        secondary_contact, allergies, conditions, medications, insurance,
        preferred_hospital, medical_notes, created_at, updated_at
    ) VALUES (
        (profile_data->>'id')::UUID,
        target_user_id::TEXT,
        (profile_data->>'public_token')::UUID,
        COALESCE((profile_data->>'is_active')::BOOLEAN, TRUE),
        profile_data->>'full_name',
        profile_data->>'birth_date',
        (profile_data->>'age')::INTEGER,
        COALESCE(profile_data->>'national_id', ''),
        profile_data->>'blood_type',
        COALESCE((profile_data->>'organ_donor')::BOOLEAN, FALSE),
        COALESCE(profile_data->>'photo_url', ''),
        COALESCE(profile_data->'primary_contact', '{}'::JSONB),
        COALESCE(profile_data->'secondary_contact', '{}'::JSONB),
        COALESCE(profile_data->'allergies', '[]'::JSONB),
        COALESCE(profile_data->'conditions', '[]'::JSONB),
        COALESCE(profile_data->'medications', '[]'::JSONB),
        COALESCE(profile_data->'insurance', '{}'::JSONB),
        COALESCE(profile_data->>'preferred_hospital', ''),
        COALESCE(profile_data->>'medical_notes', ''),
        COALESCE((profile_data->>'created_at')::TIMESTAMPTZ, NOW()),
        COALESCE((profile_data->>'updated_at')::TIMESTAMPTZ, NOW())
    )
    RETURNING * INTO saved_profile;

    RETURN NEXT saved_profile;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.create_profile_with_limit(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_profile_with_limit(UUID, JSONB) TO service_role;

COMMIT;
