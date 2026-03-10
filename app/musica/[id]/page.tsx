import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

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
}
