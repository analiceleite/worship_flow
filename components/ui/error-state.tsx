'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  /** Short description of what failed, e.g. "Não foi possível carregar as músicas". */
  title: string
  /** Detail shown below the title. When omitted, only the title is rendered. */
  message?: string | null
  /** Recoverable failures should offer a retry action. */
  onRetry?: () => void
  retrying?: boolean
  retryLabel?: string
  className?: string
}

/**
 * Consistent inline feedback for recoverable failures.
 *
 * Keep this outside `Alert`: the alert grid reserves a zero-width first column,
 * which hides buttons nested directly inside it.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
  retryLabel = 'Tentar novamente',
  className,
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-destructive">{title}</p>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </div>
      </div>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
          className="shrink-0 self-start sm:self-auto"
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', retrying && 'animate-spin')} aria-hidden="true" />
          {retrying ? 'Tentando…' : retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
