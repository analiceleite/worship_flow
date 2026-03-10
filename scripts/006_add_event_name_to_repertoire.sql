-- Migration 006: Add event_name to repertoire for recurring and special events

ALTER TABLE repertoire
ADD COLUMN IF NOT EXISTS event_name TEXT;

CREATE INDEX IF NOT EXISTS idx_repertoire_event_name
ON repertoire(event_name);

CREATE INDEX IF NOT EXISTS idx_repertoire_event_date_name
ON repertoire(event_date, event_name);
