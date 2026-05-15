'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

interface PdfScrollViewerProps {
  /** URL assinada ou pública do PDF (GET permitido pelo servidor). */
  url: string
  /** Multiplicador de largura base (1 = encaixa na largura do container). */
  zoom?: number
  className?: string
}

/**
 * Renderiza todas as páginas do PDF em canvas empilhados (scroll vertical).
 * Evita o bug comum no iOS/WebKit em que iframe PDF mostra só a primeira página.
 */
export function PdfScrollViewer({ url, zoom = 1, className }: PdfScrollViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesWrapRef = useRef<HTMLDivElement>(null)
  const renderGenerationRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)

  const renderPdf = useCallback(async () => {
    const wrap = pagesWrapRef.current
    const scrollEl = scrollRef.current
    if (!wrap || !scrollEl || !url) return

    const gen = ++renderGenerationRef.current
    setLoading(true)
    setError(null)
    setPageCount(0)
    wrap.innerHTML = ''

    try {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

      const loadingTask = pdfjs.getDocument({
        url,
        withCredentials: false,
      })
      const pdf = await loadingTask.promise
      if (gen !== renderGenerationRef.current) return

      const numPages = pdf.numPages
      setPageCount(numPages)

      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        if (gen !== renderGenerationRef.current) return
        const page = await pdf.getPage(pageNum)
        const baseViewport = page.getViewport({ scale: 1 })
        const containerW = Math.max(scrollEl.clientWidth - 24, 120)
        const fitScale = containerW / baseViewport.width
        const scale = fitScale * zoom * dpr
        const viewport = page.getViewport({ scale })

        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) continue

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
        canvas.style.display = 'block'
        canvas.className = 'mx-auto shadow-sm'

        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
        })
        await renderTask.promise

        const pageWrap = document.createElement('div')
        pageWrap.className = 'flex justify-center px-3 pb-4 pt-1 last:pb-6'
        pageWrap.appendChild(canvas)
        wrap.appendChild(pageWrap)
      }
    } catch (e) {
      console.error('PdfScrollViewer:', e)
      if (gen === renderGenerationRef.current) {
        setError('Não foi possível exibir o PDF neste dispositivo.')
      }
    } finally {
      if (gen === renderGenerationRef.current) {
        setLoading(false)
      }
    }
  }, [url, zoom])

  useEffect(() => {
    void renderPdf()
    return () => {
      renderGenerationRef.current++
    }
  }, [renderPdf])

  useEffect(() => {
    const onOrient = () => {
      window.setTimeout(() => void renderPdf(), 300)
    }
    window.addEventListener('orientationchange', onOrient)
    return () => window.removeEventListener('orientationchange', onOrient)
  }, [renderPdf])

  return (
    <div ref={scrollRef} className={cn('relative h-full min-h-0 overflow-auto [-webkit-overflow-scrolling:touch]', className)}>
      {loading && (
        <div className="flex min-h-[12rem] items-center justify-center bg-zinc-100 dark:bg-zinc-950">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {error && !loading && (
        <div className="flex min-h-[12rem] items-center justify-center px-4 text-center text-sm text-muted-foreground">{error}</div>
      )}
      {!loading && !error && pageCount > 0 && (
        <p className="sticky top-0 z-[1] border-b border-border/50 bg-background/90 px-3 py-1.5 text-center text-[11px] text-muted-foreground backdrop-blur-sm">
          {pageCount} página{pageCount !== 1 ? 's' : ''} — role para ver todas
        </p>
      )}
      <div ref={pagesWrapRef} className="bg-zinc-100 py-2 dark:bg-zinc-950" />
    </div>
  )
}
