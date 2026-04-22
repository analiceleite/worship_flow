-- Migration: Add schedule_rehearsals table for rehearsal info per event
-- Permite associar data, horário e local de ensaio a cada evento de escala

BEGIN;

CREATE TABLE IF NOT EXISTS public.schedule_rehearsals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quarter_id uuid NOT NULL REFERENCES public.schedule_quarters(id) ON DELETE CASCADE,
    event_date date NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('thursday', 'sunday')),
    rehearsal_date date,
    rehearsal_time time,
    rehearsal_place text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (quarter_id, event_date, event_type)
);

COMMIT;
