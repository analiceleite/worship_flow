'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, version as pdfjsVersion } from 'pdfjs-dist'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

if (typeof window !== 'undefined') {
  GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs`
}

interface PdfScrollViewerProps {
  /** URL assinada ou pública do PDF (GET permitido pelo servidor). */
  url: string
  /** Multiplicador de largura base (1 = encaixa na largura do container). */
  zoom?: number
  zoomMin?: number
  zoomMax?: number
  /** Pinça com dois dedos (touch): atualiza zoom ao soltar. */
  onZoomChange?: (zoom: number) => void
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
export function PdfScrollViewer({
  url,
  zoom = 1,
  zoomMin = 0.5,
  zoomMax = 2.5,
  onZoomChange,
  className,
}: PdfScrollViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinchVisualRef = useRef<HTMLDivElement>(null)
  const pagesWrapRef = useRef<HTMLDivElement>(null)
  const zoomPropRef = useRef(zoom)
  const renderGenerationRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    zoomPropRef.current = zoom
  }, [zoom])

  /** Pinça (2 dedos): pré-visualização em CSS; ao soltar reaplica zoom no pdf.js (nitidez). */
  useEffect(() => {
    const root = scrollRef.current
    const visual = pinchVisualRef.current
    if (!root || !visual || !onZoomChange) return

    let pinchActive = false
    let startDist = 0
    let baseZoom = 1
    let lastMult = 1

    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

    const resetVisual = () => {
      visual.style.transform = ''
      visual.style.transformOrigin = ''
      visual.style.willChange = 'auto'
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchActive = true
        startDist = dist(e.touches)
        baseZoom = zoomPropRef.current
        lastMult = 1
        if (startDist >= 24) {
          visual.style.willChange = 'transform'
          visual.style.transformOrigin = 'top center'
        }
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!pinchActive || e.touches.length !== 2 || startDist < 24) return
      lastMult = dist(e.touches) / startDist
      visual.style.transformOrigin = 'top center'
      visual.style.transform = `scale(${lastMult})`
      e.preventDefault()
    }

    const finishPinchIfNeeded = () => {
      if (!pinchActive) return
      pinchActive = false
      resetVisual()
      const mult = lastMult
      lastMult = 1
      startDist = 0
      if (Math.abs(mult - 1) < 0.04) return
      const raw = baseZoom * mult
      const next = Math.round(Math.min(zoomMax, Math.max(zoomMin, raw)) * 100) / 100
      if (Math.abs(next - baseZoom) >= 0.02) {
        onZoomChange(next)
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!pinchActive) return
      if (e.touches.length >= 2) return
      finishPinchIfNeeded()
    }

    const onTouchCancel = () => {
      if (!pinchActive) return
      pinchActive = false
      resetVisual()
      lastMult = 1
      startDist = 0
    }

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('touchend', onTouchEnd, { passive: true })
    root.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
      root.removeEventListener('touchcancel', onTouchCancel)
      resetVisual()
    }
  }, [onZoomChange, zoomMin, zoomMax])

  const renderPdf = useCallback(async () => {
    const wrap = pagesWrapRef.current
    const scrollEl = scrollRef.current
    if (!wrap || !scrollEl || !url) return

    const gen = ++renderGenerationRef.current
    setLoading(true)
    setError(null)
    wrap.innerHTML = ''

    try {
      await waitForNonZeroWidth(scrollEl)
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })

      const pdfBytes = await fetchPdfBytes(url)
      if (gen !== renderGenerationRef.current) return

      // Cópia: algumas versões do pdf.js alteram o buffer
      const loadingTask = getDocument({
        data: pdfBytes.slice(),
        disableRange: true,
        disableStream: true,
      })
      const pdf = await loadingTask.promise
      if (gen !== renderGenerationRef.current) return

      const numPages = pdf.numPages

      const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const dpr = Math.min(rawDpr, 2)

      const containerW = Math.max(scrollEl.clientWidth - 16, 120)
      /** Altura visível da região de scroll (encaixa a página inteira no desktop/tablet quando > 0). */
      const containerH =
        scrollEl.clientHeight > 48 ? Math.max(scrollEl.clientHeight - 16, 80) : 0

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        if (gen !== renderGenerationRef.current) return

        const page = await pdf.getPage(pageNum)
        const baseViewport = page.getViewport({ scale: 1 })

        const fitScaleW = containerW / baseViewport.width
        let fitScale = fitScaleW
        if (containerH > 0 && baseViewport.height > 0) {
          const fitScaleH = containerH / baseViewport.height
          fitScale = Math.min(fitScaleW, fitScaleH)
        }

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
          'flex justify-center border-b border-zinc-200/80 px-2 pb-3 pt-1 dark:border-zinc-800'
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
    let lastH = el.clientHeight

    const schedule = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (
        w > 2 &&
        (Math.abs(w - lastW) >= 8 || Math.abs(h - lastH) >= 8)
      ) {
        lastW = w
        lastH = h
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
      <div
        ref={pinchVisualRef}
        className="min-h-0 origin-top bg-zinc-100 dark:bg-zinc-950"
      >
        <div ref={pagesWrapRef} className="min-h-0" />
      </div>
    </div>
  )
}
