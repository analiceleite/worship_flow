-- Migration 027: Remove a implementação de calendário assinado (ICS/webcal)
--
-- A integração com Google Calendar (OAuth, migração 026) substitui completamente o
-- calendário assinado por link: agora os eventos são criados de verdade na agenda do
-- ministro, com lembretes nativos que funcionam em iOS e Android. O feed ICS/webcal
-- (app/api/calendar/[token]/route.ts) e a rota de geração de token (app/api/calendar/token)
-- foram removidos do código; esta migração remove o que sobrou no banco.
--
-- calendar_alarm_offsets_minutes é MANTIDA: agora é a única fonte das antecedências de
-- lembrete usadas pela integração com o Google Calendar (lib/google-calendar/reconcile.ts).

DROP INDEX IF EXISTS public.idx_ministers_calendar_token;

ALTER TABLE public.ministers
DROP COLUMN IF EXISTS calendar_token,
DROP COLUMN IF EXISTS calendar_feed_enabled;

COMMENT ON COLUMN public.ministers.calendar_alarm_offsets_minutes IS
  'Antecedências (em minutos) dos lembretes nos eventos criados via integração com o Google Calendar (ver lib/google-calendar/reconcile.ts). Não afeta mais nenhum feed ICS/webcal (removido na migração 027).';
