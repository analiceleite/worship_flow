-- Local Compose only. Idempotent for both new and existing local volumes.
-- Also run by db-bootstrap BEFORE Auth and Storage start their own migrations.
BEGIN;
\getenv pgpass POSTGRES_PASSWORD
ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';

-- The base Postgres image creates these helpers as postgres. GoTrue needs to
-- replace them during its first migration, without becoming a superuser.
ALTER SCHEMA auth OWNER TO supabase_auth_admin;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;
DO $$
DECLARE
  helper record;
BEGIN
  FOR helper IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname IN ('uid', 'role', 'email')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO supabase_auth_admin', helper.signature);
  END LOOP;
END;
$$;
COMMIT;
