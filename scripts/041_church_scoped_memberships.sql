-- WF-04, contraction of the single-church identity gates. Apply after 040 and
-- after every consumer was verified to accept several memberships per identity.
-- Uniqueness moves from global (user_id, email) to per church. Existing rows are
-- not modified; the migration fails loudly if a duplicate would appear.
BEGIN;

LOCK TABLE public.ministers IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ministers WHERE user_id IS NOT NULL
    GROUP BY church_id, user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'WF04_DUPLICATE_MEMBERSHIP: review duplicates per church before contraction';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ministers WHERE email IS NOT NULL
    GROUP BY church_id, lower(email) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'WF04_DUPLICATE_EMAIL: review duplicate e-mails per church before contraction';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ministers_email_key'
             AND conrelid = 'public.ministers'::regclass) THEN
    ALTER TABLE public.ministers DROP CONSTRAINT ministers_email_key;
  ELSE
    DROP INDEX IF EXISTS public.ministers_email_key;
  END IF;
END $$;

DROP INDEX IF EXISTS public.ministers_user_id_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ministers_church_user_unique_idx
  ON public.ministers(church_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ministers_church_email_unique_idx
  ON public.ministers(church_id, lower(email))
  WHERE email IS NOT NULL;

COMMIT;
