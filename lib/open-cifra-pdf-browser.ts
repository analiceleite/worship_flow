'use client'

import { createClient } from '@/lib/supabase/client'
import { getCifraSignedUrl, isPdfStoragePath } from '@/lib/cifra-storage'
import { isMobileViewportSync } from '@/hooks/use-mobile'
import type { Song } from '@/lib/types'

/**
 * No celular, abre o PDF da cifra numa nova aba (Safari/chrome nativo → zoom livre).
 * Devolve true se tratou assim (não deve abrir o viewer no app). Chamar no próprio gesto do toque/clique (window.open síncrono).
 */
export function openPdfCifraInSystemBrowserFromUserGesture(song: Song | null | undefined): boolean {
  const path = song?.cifra_pdf_path?.trim()
  if (!song || !path || !isPdfStoragePath(path)) return false
  if (!isMobileViewportSync()) return false

  const tab = window.open('about:blank', '_blank')

  void (async () => {
    try {
      const supabase = createClient()
      const signed = await getCifraSignedUrl(supabase, path)
      if (!signed) {
        tab?.close()
        return
      }
      if (tab && !tab.closed) {
        tab.location.href = signed
        return
      }
      window.open(signed, '_blank', 'noopener,noreferrer')
    } catch {
      tab?.close()
    }
  })()

  return true
}
