import type { RepertoireItem } from '@/lib/types'

export function formatRepertoireWhatsapp(name: string, date: string, items: RepertoireItem[]) {
  const [year, month, day] = date.split('-')
  return [`Repertório - ${name} (${day}/${month}/${year})`, '', ...items.map((item, index) => {
    const song = item.song
    const tone = song?.tone ? ` (Tom ${song.tone}${song.capo_frets && song.capo_frets > 0 ? ` · Capo ${song.capo_frets}ª` : ''})` : ''
    return `${index + 1}. ${song?.title ?? 'Sem título'} — ${song?.artist ?? 'Artista desconhecido'}${tone}`
  })].join('\n')
}
