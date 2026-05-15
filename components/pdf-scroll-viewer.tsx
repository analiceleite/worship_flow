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

/** iOS Safari limita canvas (~4096px por lado); evita páginas em branco. */
const MAX_CANVAS_EDGE = 4096

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Falha ao baixar PDF (${res.status})`)
  }
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

/** Espera o container ter largura (WebKit/iOS às vezes mede 0 no 1º frame). */
function waitForNonZeroWidth(el: HTMLElement | null, maxFrames = 24): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0
    const tick = () => {
      frames++
      if (!el || el.clientWidth > 2 || frames >= maxFrames) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/**
 * Renderiza todas as páginas do PDF em canvas empilhados (scroll vertical).
 * Usa ArrayBuffer em vez de URL no pdf.js para evitar range requests falhando
 * (comum com URLs assinadas) e só 1 página aparecendo no iPhone.
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
      await waitForNonZeroWidth(scrollEl)

      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

      const pdfBytes = await fetchPdfBytes(url)
      if (gen !== renderGenerationRef.current) return

      // Cópia: algumas versões do pdf.js alteram o buffer
      const loadingTask = pdfjs.getDocument({
        data: pdfBytes.slice(),
        disableRange: true,
        disableStream: true,
      })
      const pdf = await loadingTask.promise
      if (gen !== renderGenerationRef.current) return

      const numPages = pdf.numPages
      setPageCount(numPages)

      const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const dpr = Math.min(rawDpr, 2)

      const containerW = Math.max(scrollEl.clientWidth - 24, 120)

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        if (gen !== renderGenerationRef.current) return

        const page = await pdf.getPage(pageNum)
        const baseViewport = page.getViewport({ scale: 1 })

        let fitScale = containerW / baseViewport.width
        let scale = fitScale * zoom * dpr
        let viewport = page.getViewport({ scale })

        const maxDim = Math.max(viewport.width, viewport.height)
        if (maxDim > MAX_CANVAS_EDGE) {
          const shrink = MAX_CANVAS_EDGE / maxDim
          scale *= shrink
          viewport = page.getViewport({ scale })
        }

        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) continue

        const cw = Math.floor(viewport.width)
        const ch = Math.floor(viewport.height)
        canvas.width = cw
        canvas.height = ch
        canvas.style.width = `${Math.floor(cw / dpr)}px`
        canvas.style.height = `${Math.floor(ch / dpr)}px`
        canvas.style.display = 'block'
        canvas.className = 'mx-auto max-w-full shadow-sm'

        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
        })
        await renderTask.promise

        const pageWrap = document.createElement('div')
        pageWrap.className =
          'flex justify-center border-b border-zinc-200/80 px-3 pb-6 pt-2 dark:border-zinc-800'
        const label = document.createElement('div')
        label.className =
          'mb-2 w-full max-w-[min(100%,56rem)] text-center text-[11px] font-medium text-muted-foreground'
        label.textContent = `Página ${pageNum} de ${numPages}`
        pageWrap.appendChild(label)
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

  /** Safari/iOS: diálogo fullscreen pode reportar largura 0 ou mudar após paint — refaz layout quando estabiliza. */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let timeoutId: number | undefined
    let lastW = el.clientWidth

    const schedule = () => {
      const w = el.clientWidth
      if (w > 2 && Math.abs(w - lastW) >= 8) {
        lastW = w
        clearTimeout(timeoutId)
        timeoutId = window.setTimeout(() => void renderPdf(), 120)
      }
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    schedule()

    return () => {
      clearTimeout(timeoutId)
      ro.disconnect()
    }
  }, [renderPdf])

  useEffect(() => {
    const onOrient = () => {
      window.setTimeout(() => void renderPdf(), 350)
    }
    window.addEventListener('orientationchange', onOrient)
    return () => window.removeEventListener('orientationchange', onOrient)
  }, [renderPdf])

  return (
    <div
      ref={scrollRef}
      className={cn(
        /* basis-0 + flex-1: altura limitada pelo pai (evita “uma página” sem scroll no iOS). Evitar h-full aqui. */
        'relative isolate min-h-0 w-full flex-1 basis-0 overflow-y-scroll overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch]',
        'touch-pan-y',
        className
      )}
    >
      {loading && (
        <div className="flex min-h-[12rem] items-center justify-center bg-zinc-100 dark:bg-zinc-950">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {error && !loading && (
        <div className="flex min-h-[12rem] items-center justify-center px-4 text-center text-sm text-muted-foreground">
          {error}
        </div>
      )}
      {!loading && !error && pageCount > 1 && (
        <p className="sticky top-0 z-[1] border-b border-border/50 bg-background/95 px-3 py-2 text-center text-xs text-muted-foreground backdrop-blur-sm">
          {pageCount} páginas — <span className="font-medium text-foreground">deslize para baixo</span> para as
          próximas
        </p>
      )}
      <div ref={pagesWrapRef} className="min-h-0 bg-zinc-100 py-2 dark:bg-zinc-950" />
    </div>
  )
}
