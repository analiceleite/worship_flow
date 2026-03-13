-- Migration 013: Allow 1-day reminder notifications in schedule email queue

BEGIN;

ALTER TABLE public.schedule_email_notifications
  DROP CONSTRAINT IF EXISTS schedule_email_notifications_notification_type_check;

ALTER TABLE public.schedule_email_notifications
  ADD CONSTRAINT schedule_email_notifications_notification_type_check
  CHECK (notification_type IN ('quarter_published', 'reminder_7days', 'reminder_1day'));

COMMIT;
