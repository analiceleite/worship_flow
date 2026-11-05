BEGIN;

CREATE TABLE IF NOT EXISTS public.release_note_reads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, note_id),
  CONSTRAINT release_note_reads_note_id_not_empty CHECK (length(trim(note_id)) > 0)
);

ALTER TABLE public.release_note_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own release note reads" ON public.release_note_reads;
CREATE POLICY "Users can read own release note reads"
  ON public.release_note_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own release note reads" ON public.release_note_reads;
CREATE POLICY "Users can insert own release note reads"
  ON public.release_note_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

COMMIT;
