-- Migration 024: Integração com calendário (iCal/webcal) e preferências de notificação

-- Adicionar colunas à tabela 'ministers'
ALTER TABLE public.ministers
ADD COLUMN IF NOT EXISTS calendar_token TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS calendar_alarm_offsets_minutes INTEGER[] DEFAULT '{720,60}'::INTEGER[],
ADD COLUMN IF NOT EXISTS calendar_feed_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_reminders_enabled BOOLEAN NOT NULL DEFAULT true;

-- Criar índice para buscar ministro por token (usado no endpoint público do feed)
CREATE INDEX IF NOT EXISTS idx_ministers_calendar_token
  ON public.ministers (calendar_token)
  WHERE calendar_token IS NOT NULL;

-- Adicionar colunas à tabela 'schedule_quarters' para configuração de horários
ALTER TABLE public.schedule_quarters
ADD COLUMN IF NOT EXISTS thursday_arrival_time TIME DEFAULT '19:00',
ADD COLUMN IF NOT EXISTS thursday_service_time TIME DEFAULT '20:00',
ADD COLUMN IF NOT EXISTS sunday_arrival_time TIME DEFAULT '16:00',
ADD COLUMN IF NOT EXISTS sunday_service_time TIME DEFAULT '18:30';

COMMENT ON COLUMN public.ministers.calendar_token IS
  'Token opaco e único para gerar a URL de assinatura do feed de calendário (webcal://).';

COMMENT ON COLUMN public.ministers.calendar_alarm_offsets_minutes IS
  'Array de antecedências (em minutos) para os alarmes no feed de calendário (ex: {720, 60} = 12h e 1h antes).';

COMMENT ON COLUMN public.ministers.calendar_feed_enabled IS
  'Se false, o feed de calendário para de retornar eventos (token permanece válido, pode ser reativado sem regenerar).';

COMMENT ON COLUMN public.ministers.email_reminders_enabled IS
  'Se false, o ministro não recebe emails de lembrete (7 dias / 1 dia antes). Não afeta email de escala publicada.';

COMMENT ON COLUMN public.schedule_quarters.thursday_arrival_time IS
  'Horário de chegada/ensaio na quinta-feira (default 19:00).';

COMMENT ON COLUMN public.schedule_quarters.thursday_service_time IS
  'Horário de início do culto na quinta-feira (default 20:00).';

COMMENT ON COLUMN public.schedule_quarters.sunday_arrival_time IS
  'Horário de chegada/ensaio no domingo (default 16:00).';

COMMENT ON COLUMN public.schedule_quarters.sunday_service_time IS
  'Horário de início do culto no domingo (default 18:30).';
