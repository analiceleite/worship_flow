-- Migration 028: Add sound technician role to schedule grid
-- Purpose:
-- Add the Sonoplasta row as the last schedule role and backfill existing quarter slots.

BEGIN;

ALTER TABLE public.schedule_roles
  DROP CONSTRAINT IF EXISTS schedule_roles_category_check;

ALTER TABLE public.schedule_roles
  ADD CONSTRAINT schedule_roles_category_check
  CHECK (category = ANY (ARRAY['ministro'::text, 'vocal'::text, 'instrumento'::text, 'midia'::text]));

WITH sound_role AS (
  INSERT INTO public.schedule_roles (name, category, display_order)
  SELECT 'Sonoplasta', 'midia', 1000
  WHERE NOT EXISTS (
    SELECT 1 FROM public.schedule_roles WHERE lower(name) = 'sonoplasta'
  )
  RETURNING id
), resolved_role AS (
  SELECT id FROM sound_role
  UNION
  SELECT id
  FROM public.schedule_roles
  WHERE lower(name) = 'sonoplasta'
), chosen_role AS (
  SELECT id FROM resolved_role LIMIT 1
), slots AS (
  SELECT DISTINCT quarter_id, event_date, event_type
  FROM public.schedule_assignments
), missing_rows AS (
  SELECT
    s.quarter_id,
    rr.id AS role_id,
    s.event_date,
    s.event_type
  FROM slots s
  CROSS JOIN chosen_role rr
  LEFT JOIN public.schedule_assignments existing
    ON existing.quarter_id = s.quarter_id
   AND existing.role_id = rr.id
   AND existing.event_date = s.event_date
   AND existing.event_type = s.event_type
  WHERE existing.id IS NULL
)
INSERT INTO public.schedule_assignments (
  quarter_id,
  role_id,
  minister_id,
  event_date,
  event_type,
  is_trainee
)
SELECT
  m.quarter_id,
  m.role_id,
  NULL,
  m.event_date,
  m.event_type,
  false
FROM missing_rows m;

COMMIT;
