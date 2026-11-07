export interface Church {
  id: string
  name: string
  slug: string
  status: 'active' | 'inactive'
  environment: 'production' | 'demo' | 'test'
  email_mode: 'real' | 'disabled' | 'test_recipient'
  plan: string
  created_at: string
  updated_at: string
}

export type MembershipState = 'pending' | 'active' | 'suspended'

export interface UserProfile {
  user_id: string
  name: string
  avatar_url: string | null
  optional_notifications_paused: boolean
  last_church_id: string | null
}

export interface Minister {
  id: string
  church_id: string
  name: string
  email: string | null
  instrument: string
  role: 'admin' | 'minister' | 'midia'
  user_id: string | null
  is_active: boolean
  access_state: MembershipState
  avatar_url: string | null
  created_at: string
}

export interface Song {
  id: string
  church_id: string
  title: string
  artist: string
  tone: string
  cipher_url: string | null
  youtube_url: string | null
  youtube_video_title?: string | null
  // Metadata-only repertoire snapshots load the full content on demand.
  cifra_content?: string[] | null
  cifra_available?: boolean
  available_tones?: string[] | null
  cifra_pdf_path?: string | null
  capo_frets?: number | null
  minister_id: string
  created_at: string
  minister?: Minister
}

export interface YouTubeSearchResult {
  videoId: string
  title: string
  channelTitle: string
  thumbnailUrl: string
}

export interface RepertoireItem {
  id: string
  church_id: string
  song_id: string
  minister_id: string | null
  event_name: string | null
  event_date: string
  order_index: number
  created_at: string
  song?: Song
  minister?: Minister
}

export interface CurrentMinisterContext {
  userId: string
  ministerId: string
  churchId: string
  role: Minister['role']
  isAdmin: boolean
  isImpersonating?: boolean
  impersonatedChurchId?: string | null
}

export interface PlatformAdminContext {
  userId: string
}

export const TONES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'Ab', 'A', 'A#', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Abm', 'Am', 'A#m', 'Bm'
] as const

export const INSTRUMENTS = [
  'Voz',
  'Backing Vocal',
  'Violão',
  'Guitarra',
  'Baixo',
  'Bateria',
  'Teclado',
] as const
