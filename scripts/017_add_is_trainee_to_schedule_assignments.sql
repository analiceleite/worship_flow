-- Migration 017: Add trainee flag to schedule assignments
-- Purpose:
-- Allow marking an assigned minister as an apprentice without changing the role/instrument structure.

BEGIN;

ALTER TABLE public.schedule_assignments
  ADD COLUMN IF NOT EXISTS is_trainee BOOLEAN NOT NULL DEFAULT false;

COMMIT;