'use client'

import type { Song } from '@/lib/types'

/**
 * PDFs são exibidos no app via pdf.js (canvas), não no navegador externo.
 * Abrir no Safari/Chrome costuma forçar download em celulares antigos.
 */
export function openPdfCifraInSystemBrowserFromUserGesture(_song: Song | null | undefined): boolean {
  return false
}
