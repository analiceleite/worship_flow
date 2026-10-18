import type { OriginalCifra } from './contract'
export type ImportDraftInput = {
  url: string; title?: string; artist?: string; tone?: string
  youtubeUrl?: string; youtubeVideoTitle?: string; songId?: string; ministerId?: string
  original?: OriginalCifra; confirmedTone?: string; confirmedCapoFrets?: number
  songSnapshot?: import('@/lib/types').Song
}
