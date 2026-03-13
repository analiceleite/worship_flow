-- Migration 010: Public song catalog for authenticated users + owner/admin modification control
-- Purpose:
-- 1) Ensure all authenticated users can view all songs.
-- 2) Keep edit/delete permissions restricted to admins or song owners.

BEGIN;

-- Replace SELECT policies with a broad authenticated-read policy.
DROP POLICY IF EXISTS "Authenticated users can view all songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can select songs" ON public.songs;

CREATE POLICY "Authenticated users can view all songs"
  ON public.songs FOR SELECT
  TO authenticated
  USING (true);

-- Keep update/delete restricted to admins or owners.
DROP POLICY IF EXISTS "Ministers can update their own songs" ON public.songs;
DROP POLICY IF EXISTS "Ministers can delete their own songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can update songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can delete songs" ON public.songs;

CREATE POLICY "Admins or owners can update songs"
  ON public.songs FOR UPDATE
  TO authenticated
  USING (is_admin() OR minister_id = get_current_minister_id())
  WITH CHECK (is_admin() OR minister_id = get_current_minister_id());

CREATE POLICY "Admins or owners can delete songs"
  ON public.songs FOR DELETE
  TO authenticated
  USING (is_admin() OR minister_id = get_current_minister_id());

COMMIT;
