-- Migration 012: Queue + audit table for schedule email notifications

BEGIN;

CREATE TABLE IF NOT EXISTS public.schedule_email_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('quarter_published', 'reminder_7days')),
  quarter_id UUID NULL REFERENCES public.schedule_quarters(id) ON DELETE CASCADE,
  minister_id UUID NOT NULL REFERENCES public.ministers(id) ON DELETE CASCADE,
  event_date DATE NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_email_notifications_status_created
  ON public.schedule_email_notifications(status, created_at);

CREATE INDEX IF NOT EXISTS idx_schedule_email_notifications_minister
  ON public.schedule_email_notifications(minister_id, notification_type);

ALTER TABLE public.schedule_email_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage schedule email notifications" ON public.schedule_email_notifications;
CREATE POLICY "Admins can manage schedule email notifications"
  ON public.schedule_email_notifications
  FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

COMMIT;
