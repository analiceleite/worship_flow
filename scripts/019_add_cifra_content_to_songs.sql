-- Migration: add cifra_content column to songs
-- Stores the full chord chart scraped from CifraClub as an array of text lines.

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS cifra_content TEXT[] DEFAULT NULL;

COMMENT ON COLUMN songs.cifra_content IS
  'Chord chart lines scraped from CifraClub via the cifraclub-api service.';
