-- Migration 003: Add Authentication and Ownership
-- This migration adds user authentication, role-based access, and song ownership

-- Step 1: Add auth and role fields to ministers table
ALTER TABLE ministers 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS role TEXT CHECK (role IN ('admin', 'minister')) DEFAULT 'minister',
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS instrument TEXT;

-- Create unique index on user_id to ensure one minister per auth user
CREATE UNIQUE INDEX IF NOT EXISTS idx_ministers_user_id ON ministers(user_id);

-- Step 2: Add minister_id to songs table (required field)
ALTER TABLE songs 
ADD COLUMN IF NOT EXISTS minister_id UUID REFERENCES ministers(id) ON DELETE CASCADE;

-- Create index for minister_id lookups
CREATE INDEX IF NOT EXISTS idx_songs_minister ON songs(minister_id);

-- Step 3: Rename chord_chart to cipher_url in songs table
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'songs' AND column_name = 'chord_chart'
  ) THEN
    ALTER TABLE songs RENAME COLUMN chord_chart TO cipher_url;
  END IF;
END $$;

-- Step 4: Update repertoire table structure
-- Drop the old unique constraint if it exists
ALTER TABLE repertoire DROP CONSTRAINT IF EXISTS repertoire_minister_id_song_id_key;

-- Add new fields for event-based repertoire
ALTER TABLE repertoire 
ADD COLUMN IF NOT EXISTS event_date DATE NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;

-- Make minister_id nullable (optional assignment)
ALTER TABLE repertoire ALTER COLUMN minister_id DROP NOT NULL;

-- Drop custom_key and notes columns (not used in current implementation)
ALTER TABLE repertoire DROP COLUMN IF EXISTS custom_key;
ALTER TABLE repertoire DROP COLUMN IF EXISTS notes;

-- Create index for event date queries
CREATE INDEX IF NOT EXISTS idx_repertoire_event_date ON repertoire(event_date);
CREATE INDEX IF NOT EXISTS idx_repertoire_order ON repertoire(event_date, order_index);

-- Step 5: Enable Row Level Security on all tables
ALTER TABLE ministers ENABLE ROW LEVEL SECURITY;
ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE repertoire ENABLE ROW LEVEL SECURITY;

-- Step 6: Create helper function to get current user's minister record
CREATE OR REPLACE FUNCTION get_current_minister_id()
RETURNS UUID AS $$
  SELECT id FROM ministers WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Create helper function to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM ministers 
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- Step 7: RLS Policies for ministers table

-- Admin can view all ministers
CREATE POLICY "Admins can view all ministers"
ON ministers FOR SELECT
TO authenticated
USING (is_admin());

-- Ministers can view their own record
CREATE POLICY "Ministers can view their own record"
ON ministers FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admin can insert new ministers
CREATE POLICY "Admins can insert ministers"
ON ministers FOR INSERT
TO authenticated
WITH CHECK (is_admin());

-- Admin can update any minister
CREATE POLICY "Admins can update any minister"
ON ministers FOR UPDATE
TO authenticated
USING (is_admin());

-- Ministers can update their own info (except role and instrument)
CREATE POLICY "Ministers can update their own info"
ON ministers FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid() AND 
  role = (SELECT role FROM ministers WHERE user_id = auth.uid()) AND
  instrument = (SELECT instrument FROM ministers WHERE user_id = auth.uid())
);

-- Admin can delete ministers
CREATE POLICY "Admins can delete ministers"
ON ministers FOR DELETE
TO authenticated
USING (is_admin());

-- Step 8: RLS Policies for songs table

-- All authenticated users can view all songs
CREATE POLICY "Authenticated users can view all songs"
ON songs FOR SELECT
TO authenticated
USING (true);

-- Ministers can insert songs with their own minister_id
CREATE POLICY "Ministers can insert their own songs"
ON songs FOR INSERT
TO authenticated
WITH CHECK (minister_id = get_current_minister_id());

-- Ministers can update only their own songs
CREATE POLICY "Ministers can update their own songs"
ON songs FOR UPDATE
TO authenticated
USING (minister_id = get_current_minister_id());

-- Ministers can delete only their own songs
CREATE POLICY "Ministers can delete their own songs"
ON songs FOR DELETE
TO authenticated
USING (minister_id = get_current_minister_id());

-- Admins can do anything with songs (optional, uncomment if needed)
-- CREATE POLICY "Admins can manage all songs"
-- ON songs FOR ALL
-- TO authenticated
-- USING (is_admin())
-- WITH CHECK (is_admin());

-- Step 9: RLS Policies for repertoire table

-- All authenticated users can view repertoire
CREATE POLICY "Authenticated users can view repertoire"
ON repertoire FOR SELECT
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

-- Step 10: Create initial admin user (IMPORTANT: Update email after running)
-- Note: You'll need to create the auth.users record first via Supabase Dashboard
-- Then update this query with the correct user_id
-- Example:
-- INSERT INTO ministers (name, email, role, user_id, is_active, instrument)
-- VALUES ('Admin User', 'admin@example.com', 'admin', 'your-auth-user-id-here', true, 'Outro')
-- ON CONFLICT (user_id) DO NOTHING;

COMMENT ON TABLE ministers IS 'Stores minister profiles linked to auth users with role-based access';
COMMENT ON TABLE songs IS 'Songs owned by individual ministers with their preferred keys';
COMMENT ON TABLE repertoire IS 'Event-based worship service planning managed by admins';
