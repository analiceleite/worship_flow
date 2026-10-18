import { JobViewSchema, type ImportFailure, type ImportScope, type JobView } from './contract'
import type { ImportDraftInput } from './draft'
import { canonicalizeCifraUrl } from './url'

export type ImportSnapshot = {
  phase: 'idle' | 'starting' | JobView['state']; draft: ImportDraftInput | null
  error: ImportFailure | null; jobId: string | null; scope: ImportScope | null
}
export type ImportTransport = {
  ready(signal: AbortSignal): Promise<boolean>
  create(url: string, requestId: string, signal: AbortSignal): Promise<JobView>
  read(jobId: string, signal: AbortSignal): Promise<JobView>
  cancel(jobId: string, signal: AbortSignal): Promise<unknown>
}
export class ImportTransportError extends Error {
  constructor(public code: string, public status: number, public retryAfterSec?: number) { super(code) }
}
async function request(path: string, method: string, signal: AbortSignal, body?: unknown) {
  let response: Response
  try { response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }) }
  catch { throw new ImportTransportError(signal.aborted ? 'CANCELLED' : 'UPSTREAM_TIMEOUT', 504) }
  const value = await response.json()
  if (!response.ok) throw new ImportTransportError(value.code || 'IMPORT_FAILED', response.status, Number(response.headers.get('Retry-After')) || undefined)
  return value
}
export const browserImportTransport: ImportTransport = {
  ready: async (signal) => (await request('/api/cifra/ready', 'POST', signal)).ready === true,
  create: async (url, requestId, signal) => JobViewSchema.parse(await request('/api/cifra/jobs', 'POST', signal, { url, requestId })),
  read: async (jobId, signal) => JobViewSchema.parse(await request(`/api/cifra/jobs/${jobId}`, 'GET', signal)),
  cancel: (jobId, signal) => request(`/api/cifra/jobs/${jobId}`, 'DELETE', signal),
}
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const onAbort = () => { clearTimeout(timer); reject(new ImportTransportError('CANCELLED', 499)) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
})
const retryable = (error: unknown): error is ImportTransportError => Boolean(error && typeof error === 'object' && 'code' in error && ['UPSTREAM_TIMEOUT', 'CAPACITY', 'UPSTREAM_FAILED', 'RATE_LIMITED'].includes(String(error.code)))
export function createImportController({ transport = browserImportTransport, now = Date.now }: { transport?: ImportTransport; now?: () => number } = {}) {
  let state: ImportSnapshot = { phase: 'idle', draft: null, error: null, jobId: null, scope: null }
  let generation = 0, active: AbortController | null = null
  const listeners = new Set<() => void>()
  const emit = (patch: Partial<ImportSnapshot>) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()) }
  const sameScope = (scope: ImportScope | null) => scope?.userId === state.scope?.userId && scope?.churchId === state.scope?.churchId
  const stop = () => {
    generation++; active?.abort(); active = null
    if (state.jobId) void transport.cancel(state.jobId, new AbortController().signal).catch(() => {})
  }
  const controller = {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    resetScope(scope: ImportScope | null) { if (sameScope(scope)) return; stop(); emit({ phase: 'idle', draft: null, error: null, jobId: null, scope }) },
    updateDraft(patch: Partial<ImportDraftInput>) { if (state.draft) emit({ draft: { ...state.draft, ...patch } }) },
    discard() { stop(); emit({ phase: 'idle', draft: null, error: null, jobId: null }) },
    async cancel() { stop(); emit({ phase: 'cancelled', jobId: null }) },
    dispose() { stop(); listeners.clear() },
    async start(input: ImportDraftInput, scope: ImportScope) {
      if (!sameScope(scope)) controller.resetScope(scope)
      const parsed = canonicalizeCifraUrl(input.url)
      if (state.draft && state.draft.url !== parsed.canonicalUrl) throw new Error('PENDING_DRAFT')
      if (['starting', 'queued', 'extracting', 'validating'].includes(state.phase)) return
      stop(); const run = generation, abort = new AbortController(); active = abort
      const signal = abort.signal, requestId = crypto.randomUUID()
      emit({ phase: 'starting', error: null, jobId: null, draft: { ...state.draft, ...input, url: parsed.canonicalUrl, tone: input.tone || parsed.requestedTone || '' } })
      try {
        const wakeDeadline = now() + 120000
        while (true) {
          if (now() >= wakeDeadline) throw new ImportTransportError('WAKE_TIMEOUT', 504)
          let ready = false
          try { ready = await transport.ready(signal) } catch (error) { if (!retryable(error)) throw error }
          if (ready) break
          await pause(Math.min(2000, Math.max(1, wakeDeadline - now())), signal)
        }
        const createDeadline = now() + 30000
        let job: JobView
        while (true) {
          try { job = await transport.create(parsed.canonicalUrl, requestId, signal); break }
          catch (error) {
            if (!retryable(error) || now() >= createDeadline) throw error
            await pause(Math.min((error.retryAfterSec || 2) * 1000, Math.max(1, createDeadline - now())), signal)
          }
        }
        while (true) {
          if (run !== generation || signal.aborted) return
          emit({ jobId: job.jobId, phase: job.state })
          if (job.state === 'ready') {
            if (!job.result) throw new ImportTransportError('INVALID_RESPONSE', 502)
            const draft = state.draft!
            emit({ draft: { ...draft, original: job.result, title: draft.title || job.result.name, artist: draft.artist || job.result.artist, tone: draft.tone || job.result.original_tone || '', youtubeUrl: draft.youtubeUrl || job.result.youtube_url || '' } })
            return
          }
          if (['failed', 'expired', 'cancelled'].includes(job.state)) { emit({ error: job.error ?? null }); return }
          if (now() >= job.deadlineAt) throw new ImportTransportError('JOB_EXPIRED', 410)
          await pause(Math.min(2000, job.deadlineAt - now()), signal)
          try { job = await transport.read(job.jobId, signal) }
          catch (error) { if (!retryable(error) || now() >= job.deadlineAt) throw error; await pause(Math.min((error.retryAfterSec || 2) * 1000, Math.max(1, job.deadlineAt - now())), signal) }
        }
      } catch (error) {
        if (run !== generation || signal.aborted) return
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'IMPORT_FAILED'
        emit({ phase: code === 'JOB_EXPIRED' ? 'expired' : 'failed', error: { code, message: code === 'WAKE_TIMEOUT' ? 'O serviço não iniciou a tempo. Tente novamente ou envie PDF.' : 'Não foi possível importar. Tente novamente ou envie PDF.' } })
      }
    },
  }
  return controller
}
export type ImportController = ReturnType<typeof createImportController>
