-- Tabela de Ministros (perfis dos usuários)
CREATE TABLE IF NOT EXISTS ministers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Músicas (banco global de músicas)
CREATE TABLE IF NOT EXISTS songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  tone TEXT DEFAULT 'C',
  youtube_url TEXT,
  chord_chart TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Repertório (músicas do ministro)
CREATE TABLE IF NOT EXISTS repertoire (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minister_id UUID NOT NULL REFERENCES ministers(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  custom_key TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(minister_id, song_id)
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_repertoire_minister ON repertoire(minister_id);
CREATE INDEX IF NOT EXISTS idx_repertoire_song ON repertoire(song_id);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
