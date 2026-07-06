-- Migration 026: Integração com Google Calendar (OAuth2 + eventos reais com lembretes nativos)

CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
  minister_id UUID PRIMARY KEY REFERENCES public.ministers(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date BIGINT,
  scope TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;
-- Sem nenhuma CREATE POLICY, de propósito: mesmo padrão "somente service role" já usado em
-- public.schedule_email_notifications (RLS habilitado na migração 016, nunca ganhou política).
-- Só createAdminClient() (service role, ignora RLS) acessa esta tabela.

COMMENT ON TABLE public.google_calendar_tokens IS
  'Tokens OAuth2 do Google Calendar por ministro. Acesso somente via service role — nunca exposto ao client.';
COMMENT ON COLUMN public.google_calendar_tokens.access_token IS
  'Access token de curta duração; renovado automaticamente pela googleapis (OAuth2Client) via listener "tokens" e persistido aqui.';
COMMENT ON COLUMN public.google_calendar_tokens.refresh_token IS
  'Refresh token de longa duração; só é emitido com access_type=offline + prompt=consent no fluxo de autorização.';
COMMENT ON COLUMN public.google_calendar_tokens.expiry_date IS
  'Epoch ms de expiração do access_token atual (campo expiry_date da google-auth-library).';

CREATE TABLE IF NOT EXISTS public.google_calendar_event_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minister_id UUID NOT NULL REFERENCES public.ministers(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT google_calendar_event_map_minister_event_key UNIQUE (minister_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_event_map_minister
  ON public.google_calendar_event_map (minister_id);

ALTER TABLE public.google_calendar_event_map ENABLE ROW LEVEL SECURITY;
-- Mesmo padrão: sem políticas, somente service role.

COMMENT ON TABLE public.google_calendar_event_map IS
  'Mapeia (minister_id, event_key) -> google_event_id para sincronização idempotente (update em vez de duplicar) e remoção quando a escala muda. event_key segue o mesmo formato "${event_date}_${event_type}" usado no feed ICS (app/api/calendar/[token]/route.ts).';
COMMENT ON COLUMN public.google_calendar_event_map.content_hash IS
  'Hash sha256 do conteúdo sincronizado (summary+description+start+end+lembretes). Usado para pular chamadas à API do Google quando nada mudou desde a última sincronização.';
