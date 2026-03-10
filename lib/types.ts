export interface Minister {
  id: string
  name: string
  email: string | null
  instrument: string
  role: 'admin' | 'minister'
  user_id: string | null
  is_active: boolean
  avatar_url: string | null
  created_at: string
}

export interface Song {
  id: string
  title: string
  artist: string
  tone: string
  cipher_url: string | null
  youtube_url: string | null
  minister_id: string
  created_at: string
  minister?: Minister
}

export interface RepertoireItem {
  id: string
  song_id: string
  minister_id: string | null
  event_name: string | null
  event_date: string
  order_index: number
  created_at: string
  song?: Song
  minister?: Minister
}

export const TONES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm'
] as const

export const INSTRUMENTS = [
  'Voz',
  'Violão',
  'Guitarra',
  'Baixo',
  'Bateria',
  'Teclado',
  'Piano',
  'Saxofone',
  'Flauta',
  'Violino',
  'Outro'
] as const
