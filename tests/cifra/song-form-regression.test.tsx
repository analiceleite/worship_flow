import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SongForm } from '@/components/song-form'
import type { Song } from '@/lib/types'

const url = 'https://www.cifraclub.com.br/artista/musica/'
const imported = { artist: 'Artista', name: 'Musica', tone: 'G', available_tones: ['G', 'A'], youtube_url: '', cipher_url: url, cifra: ['G   D', 'Uma letra de teste'], capo_frets: 0 }
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(imported))))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('import_without_tone_fetches_once', async () => {
  render(<SongForm open onOpenChange={() => {}} onSuccess={() => {}} currentMinister={null} />)
  fireEvent.change(screen.getByPlaceholderText('Cole o link do CifraClub ou Cifralize…'), { target: { value: url } })
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
  expect(screen.getByDisplayValue('Musica')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('edit_snapshot_does_not_fetch', async () => {
  const song: Song = { id: 'song', church_id: 'church', title: 'Musica', artist: 'Artista', tone: 'G', cipher_url: url, youtube_url: null, cifra_content: imported.cifra, minister_id: 'minister', created_at: '2026-10-18' }
  render(<SongForm open song={song} onOpenChange={() => {}} onSuccess={() => {}} currentMinister={null} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
  expect(screen.getByText('Cifra pronta')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})
