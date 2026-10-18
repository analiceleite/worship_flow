import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CifraImportProvider } from '@/components/cifra-import-provider'
import { SongForm } from '@/components/song-form'
import type { Song } from '@/lib/types'
vi.mock('next/navigation', () => ({ usePathname: () => '/songs' }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }))
afterEach(() => vi.unstubAllGlobals())
test('saved_original_transposes_locally_and_shows_real_preview', async () => {
  const externalRequests: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/api/context') return new Response(JSON.stringify({ context: { userId: 'u', churchId: 'c' }, features: { cifraImportV2: true } }))
    externalRequests.push(url)
    return new Response('{}', { status: 500 })
  })
  const original = { contract_version: 2 as const, parser_version: '2', source: 'cifraclub' as const, cipher_url: 'https://www.cifraclub.com.br/a/b/', name: 'Musica', artist: 'Artista', original_lines: ['G   D', 'Uma letra'], original_tone: 'G', capo_frets: 0, youtube_url: null, transposition_supported: true, warnings: [] }
  const song: Song = { id: 's', church_id: 'c', title: 'Musica', artist: 'Artista', tone: 'G', cipher_url: original.cipher_url, youtube_url: null, cifra_content: original.original_lines, cifra_original: original, minister_id: 'm', created_at: '', available_tones: ['G', 'A'] }
  render(<CifraImportProvider><SongForm open song={song} currentMinister={null} onOpenChange={() => {}} onSuccess={() => {}} /></CifraImportProvider>)
  await waitFor(() => expect(screen.getByLabelText('Prévia da cifra')).toHaveTextContent('G D'))
  fireEvent.click(screen.getByRole('button', { name: 'A' }))
  expect(screen.getByLabelText('Prévia da cifra')).toHaveTextContent('A E')
  expect(externalRequests).toEqual([])
})
