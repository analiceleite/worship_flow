-- Migration 004: Update repertoire RLS policies for minister self-service

-- Ensure RLS enabled
ALTER TABLE repertoire ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Authenticated users can view repertoire" ON repertoire;
DROP POLICY IF EXISTS "Admins can insert repertoire items" ON repertoire;
DROP POLICY IF EXISTS "Admins can update repertoire items" ON repertoire;
DROP POLICY IF EXISTS "Admins can delete repertoire items" ON repertoire;
DROP POLICY IF EXISTS "Ministers can insert own repertoire items" ON repertoire;
DROP POLICY IF EXISTS "Ministers can delete own repertoire items" ON repertoire;
DROP POLICY IF EXISTS "Authenticated users can view all ministers" ON ministers;

-- All authenticated users can view repertoire
CREATE POLICY "Authenticated users can view repertoire"
ON repertoire FOR SELECT
TO authenticated
USING (true);

-- Allow all authenticated users to view ministers (for repertório display)
CREATE POLICY "Authenticated users can view all ministers"
ON ministers FOR SELECT
TO authenticated
USING (true);

-- Admins can insert repertoire items
CREATE POLICY "Admins can insert repertoire items"
ON repertoire FOR INSERT
TO authenticated
WITH CHECK (is_admin());

-- Ministers can insert repertoire items only for their own songs
CREATE POLICY "Ministers can insert own repertoire items"
ON repertoire FOR INSERT
TO authenticated
WITH CHECK (
  minister_id = get_current_minister_id() AND
  EXISTS (
    SELECT 1 FROM songs
    WHERE songs.id = repertoire.song_id
      AND songs.minister_id = get_current_minister_id()
  )
);

-- Admins can update repertoire items
CREATE POLICY "Admins can update repertoire items"
ON repertoire FOR UPDATE
TO authenticated
USING (is_admin());

-- Ministers can delete only their own repertoire items
CREATE POLICY "Ministers can delete own repertoire items"
ON repertoire FOR DELETE
TO authenticated
USING (minister_id = get_current_minister_id());

-- Admins can delete repertoire items
CREATE POLICY "Admins can delete repertoire items"
ON repertoire FOR DELETE
TO authenticated
USING (is_admin());
