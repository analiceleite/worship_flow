'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCifraSignedUrl, isPdfStoragePath } from '@/lib/cifra-storage'
import { PdfScrollViewer } from '@/components/pdf-scroll-viewer'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ExternalLink, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'

export type CifraPdfViewerVariant = 'embedded' | 'fullscreen'

interface CifraPdfViewerProps {
  storagePath: string
  variant?: CifraPdfViewerVariant
  className?: string
  showToolbar?: boolean
}

const IMAGE_ZOOM_MIN = 0.75
const IMAGE_ZOOM_MAX = 2.5
const IMAGE_ZOOM_STEP = 0.25

const PDF_ZOOM_MIN = 0.5
const PDF_ZOOM_MAX = 2.5
const PDF_ZOOM_STEP = 0.15

export function CifraPdfViewer({
  storagePath,
  variant = 'embedded',
  className,
  showToolbar = true,
}: CifraPdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false)
  const [imageZoom, setImageZoom] = useState(1)
  const [pdfZoom, setPdfZoom] = useState(1)

  const isFullscreen = variant === 'fullscreen'
  const isPdf = isPdfStoragePath(storagePath)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSignedUrl(null)
    setImageZoom(1)
    setPdfZoom(1)

    const load = async () => {
      const supabase = createClient()
      const url = await getCifraSignedUrl(supabase, storagePath)
      if (cancelled) return
      if (!url) {
        setError('Não foi possível carregar o arquivo da cifra.')
        setLoading(false)
        return
      }
      setSignedUrl(url)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [storagePath])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsNativeFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleNativeFullscreen = useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // Safari iOS may not support fullscreen on div
    }
  }, [])

  const adjustImageZoom = useCallback((delta: number) => {
    setImageZoom((current) => {
      const next = Math.round((current + delta) * 100) / 100
      return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, next))
    })
  }, [])

  const adjustPdfZoom = useCallback((delta: number) => {
    setPdfZoom((current) => {
      const next = Math.round((current + delta) * 100) / 100
      return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, next))
    })
  }, [])

  if (loading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-zinc-100 dark:bg-zinc-950',
          isFullscreen ? 'h-full min-h-[40dvh]' : 'h-48',
          className
        )}
      >
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  if (error || !signedUrl) {
    return (
      <div
        className={cn(
          'flex items-center justify-center px-4 text-center text-sm text-muted-foreground',
          isFullscreen ? 'h-full min-h-[40dvh]' : 'h-32',
          className
        )}
      >
        {error ?? 'Arquivo indisponível.'}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex min-h-0 flex-col',
        isFullscreen ? 'h-full w-full bg-zinc-100 dark:bg-zinc-950' : 'h-full min-h-[280px] bg-background',
        className
      )}
    >
      {showToolbar && (
        <div
          className={cn(
            'flex shrink-0 flex-wrap items-center justify-end gap-1 border-b border-border/60 bg-background/95 px-2 py-1.5 backdrop-blur-sm sm:gap-1 sm:px-3 sm:py-2',
            isFullscreen && 'sm:px-4'
          )}
        >
          {isPdf ? (
            <div className="mr-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustPdfZoom(-PDF_ZOOM_STEP)}
                disabled={pdfZoom <= PDF_ZOOM_MIN}
                title="Diminuir zoom do PDF"
                aria-label="Diminuir zoom do PDF"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(pdfZoom * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustPdfZoom(PDF_ZOOM_STEP)}
                disabled={pdfZoom >= PDF_ZOOM_MAX}
                title="Aumentar zoom do PDF"
                aria-label="Aumentar zoom do PDF"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="mr-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustImageZoom(-IMAGE_ZOOM_STEP)}
                disabled={imageZoom <= IMAGE_ZOOM_MIN}
                title="Diminuir zoom"
                aria-label="Diminuir zoom"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(imageZoom * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustImageZoom(IMAGE_ZOOM_STEP)}
                disabled={imageZoom >= IMAGE_ZOOM_MAX}
                title="Aumentar zoom"
                aria-label="Aumentar zoom"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs sm:gap-1.5"
            onClick={() => void toggleNativeFullscreen()}
            title={isNativeFullscreen ? 'Sair da tela cheia do sistema' : 'Tela cheia do sistema'}
          >
            {isNativeFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Tela cheia</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs sm:gap-1.5" asChild>
            <a href={signedUrl} target="_blank" rel="noopener noreferrer" title="Abrir em nova aba">
              <ExternalLink className="h-4 w-4" />
              <span className="hidden sm:inline">Abrir em nova aba</span>
            </a>
          </Button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 basis-0 flex-col overflow-hidden">
        {isPdf ? (
          <PdfScrollViewer
            url={signedUrl}
            zoom={pdfZoom}
            zoomMin={PDF_ZOOM_MIN}
            zoomMax={PDF_ZOOM_MAX}
            onZoomChange={(z) =>
              setPdfZoom(Math.round(Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, z)) * 100) / 100)
            }
            className="min-h-0 flex-1 bg-white dark:bg-zinc-950"
          />
        ) : (
          <div className="absolute inset-0 overflow-auto overscroll-contain bg-zinc-100 [-webkit-overflow-scrolling:touch] dark:bg-zinc-950">
            <div className="flex min-h-full justify-center p-3 sm:p-6">
              <img
                src={signedUrl}
                alt="Cifra"
                className="h-auto w-full max-w-5xl origin-top select-none object-contain shadow-sm transition-transform duration-150"
                style={{ transform: `scale(${imageZoom})` }}
                draggable={false}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
