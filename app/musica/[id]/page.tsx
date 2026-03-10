import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { SongDetailClient } from './song-detail-client'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SongDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: song, error } = await supabase
    .from('songs')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !song) {
    notFound()
  }

  return <SongDetailClient song={song} />
}
