-- Migration: Allow admins to manage all songs OR owners to manage own songs
-- File: scripts/005_allow_admin_songs.sql
-- Purpose: Update Row-Level Security (RLS) policies on `songs` so that
-- administrators (as determined by `is_admin()`) OR the owning minister
-- (`minister_id = get_current_minister_id()`) can SELECT/INSERT/UPDATE/DELETE.
--
-- IMPORTANT: Make a backup before applying. See README notes below for rollback.

BEGIN;

-- Remove any existing policies with these names to avoid duplicates.
DROP POLICY IF EXISTS "Admins or owners can select songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can insert songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can update songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can delete songs" ON public.songs;

-- Allow admins or the owning minister to SELECT songs
CREATE POLICY "Admins or owners can select songs" ON public.songs
  FOR SELECT
  USING (is_admin() OR minister_id = get_current_minister_id());

-- Allow admins or the owning minister to INSERT songs
-- WITH CHECK ensures inserted rows satisfy this condition (i.e., minister_id can be set by admin or must be the current minister)
CREATE POLICY "Admins or owners can insert songs" ON public.songs
  FOR INSERT
  WITH CHECK (is_admin() OR minister_id = get_current_minister_id());

-- Allow admins or the owning minister to UPDATE songs
CREATE POLICY "Admins or owners can update songs" ON public.songs
  FOR UPDATE
  USING (is_admin() OR minister_id = get_current_minister_id())
  WITH CHECK (is_admin() OR minister_id = get_current_minister_id());

-- Allow admins or the owning minister to DELETE songs
CREATE POLICY "Admins or owners can delete songs" ON public.songs
  FOR DELETE
  USING (is_admin() OR minister_id = get_current_minister_id());

COMMIT;

-- Rollback (manual): if you need to revert, either re-run an earlier migration
-- that reinstates the previous owner-only policies, or run SQL to DROP these
-- policies and recreate the owner-only ones. Example rollback lines:
--
-- DROP POLICY "Admins or owners can select songs" ON public.songs;
-- DROP POLICY "Admins or owners can insert songs" ON public.songs;
-- DROP POLICY "Admins or owners can update songs" ON public.songs;
-- DROP POLICY "Admins or owners can delete songs" ON public.songs;
