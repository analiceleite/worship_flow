-- Migration 025: Lembretes por email com antecedências configuráveis

ALTER TABLE public.ministers
ADD COLUMN IF NOT EXISTS email_reminder_offsets_minutes INTEGER[] NOT NULL DEFAULT '{10080,1440}'::INTEGER[];

COMMENT ON COLUMN public.ministers.email_reminder_offsets_minutes IS
  'Antecedências (em minutos) para lembretes por EMAIL antes do culto. Default {10080,1440} = 7 dias e 1 dia (preserva o comportamento anterior). Independente de calendar_alarm_offsets_minutes, que só afeta o VALARM do feed ICS.';

-- Amplia o CHECK de notification_type para permitir o novo tipo genérico de lembrete,
-- mantendo os valores históricos ('reminder_7days'/'reminder_1day') válidos para linhas já existentes.
-- Busca o nome real da constraint em vez de assumir o padrão default do Postgres,
-- pois o Supabase pode tê-la renomeado.
DO $$
DECLARE
  existing_constraint_name text;
BEGIN
  SELECT con.conname INTO existing_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'schedule_email_notifications'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%notification_type%';

  IF existing_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.schedule_email_notifications DROP CONSTRAINT %I', existing_constraint_name);
  END IF;
END $$;

ALTER TABLE public.schedule_email_notifications
ADD CONSTRAINT schedule_email_notifications_notification_type_check
CHECK (notification_type = ANY (ARRAY[
  'quarter_published'::text,
  'reminder_7days'::text,
  'reminder_1day'::text,
  'reminder_offset'::text
]));
