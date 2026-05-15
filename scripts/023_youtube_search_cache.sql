-- Migration 023: cache de buscas YouTube (economia de quota da Data API)

CREATE TABLE IF NOT EXISTS public.youtube_search_cache (
  query_key TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  max_results INTEGER NOT NULL CHECK (max_results >= 1 AND max_results <= 12),
  results JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_youtube_search_cache_expires
  ON public.youtube_search_cache (expires_at);

COMMENT ON TABLE public.youtube_search_cache IS
  'Cache compartilhado de resultados search.list do YouTube Data API.';
