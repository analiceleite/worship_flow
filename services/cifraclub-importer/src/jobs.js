import { createHash } from 'node:crypto'
import { createPublicCache } from './cache.js'
import { OriginalCifraSchema } from './contract.js'

const terminal = (job) => ['ready', 'failed', 'cancelled', 'expired'].includes(job.state)
const fail = (code, status = 400) => Object.assign(Error(code), { status })
export function createJobManager({ extract, now = Date.now, limits = {} }) {
  const options = { active: 1, queued: 3, jobs: 200, deadline: 30000, lease: 60000, retention: 600000, userQuota: 40, churchQuota: 120, ...limits }
  const jobs = new Map(), work = new Map(), quotas = new Map()
  const cache = createPublicCache({ now })
  let closed = false
  const view = (job) => ({ jobId: job.jobId, state: job.state, deadlineAt: job.deadlineAt, ...(job.result ? { result: structuredClone(job.result) } : {}), ...(job.error ? { error: job.error } : {}) })
  const finish = (job, state, extra = {}) => { Object.assign(job, extra, { state, finishedAt: now() }) }
  const interested = (item) => [...item.ids].map((id) => jobs.get(id)).filter((job) => job && !terminal(job))
  function prune() {
    for (const [key, entry] of quotas) if (entry.until <= now()) quotas.delete(key)
    for (const [id, job] of jobs) {
      if (!terminal(job) && (job.deadlineAt <= now() || job.leaseAt <= now())) finish(job, 'expired', { error: { code: 'JOB_EXPIRED', message: 'Importacao expirada. Tente novamente.' } })
      if (terminal(job) && job.finishedAt + options.retention <= now()) jobs.delete(id)
    }
    for (const [key, item] of work) if (!interested(item).length) { item.controller.abort(); work.delete(key) }
  }
  function pump() {
    if (closed) return
    let active = [...work.values()].filter((item) => item.running).length
    for (const [key, item] of work) {
      if (active >= options.active) break
      if (item.running || !interested(item).length) continue
      active++; item.running = true
      for (const job of interested(item)) job.state = 'extracting'
      const onState = (state) => { if (state === 'validating') for (const job of interested(item)) job.state = state }
      // Race against cancellation even if a defective extractor ignores AbortSignal.
      const aborted = new Promise((_, reject) => { item.controller.signal.addEventListener('abort', () => reject(fail('JOB_EXPIRED', 410)), { once: true }) })
      Promise.race([Promise.resolve().then(() => extract({ url: item.url, source: item.source, signal: item.controller.signal, onState })), aborted])
        .then((result) => {
          const validated = OriginalCifraSchema.parse(result)
          if (!interested(item).length || item.controller.signal.aborted) return
          cache.set(key, validated)
          for (const job of interested(item)) finish(job, 'ready', { result: validated })
        }).catch((error) => {
          const allowed = new Set(['NOT_FOUND', 'BLOCKED', 'UPSTREAM_RATE_LIMITED', 'INVALID_CONTENT', 'PAYLOAD_TOO_LARGE', 'NO_TONE', 'UPSTREAM_FAILED', 'JOB_EXPIRED'])
          const code = allowed.has(error.message) ? error.message : 'UPSTREAM_FAILED'
          for (const job of interested(item)) finish(job, code === 'JOB_EXPIRED' ? 'expired' : 'failed', { error: { code, message: code === 'BLOCKED' ? 'A fonte bloqueou a importacao. Tente depois ou envie PDF.' : 'Nao foi possivel importar. Tente novamente ou envie PDF.' } })
        }).finally(() => { if (work.get(key) === item) work.delete(key); pump() })
    }
  }
  const interval = setInterval(() => { prune(); pump() }, 1000); interval.unref?.()
  function access(id, ownerRef) {
    prune()
    const job = jobs.get(id)
    if (!job) throw fail('JOB_EXPIRED', 410)
    if (job.ownerRef !== ownerRef) throw fail('FORBIDDEN', 403)
    return job
  }
  return {
    create(input) {
      prune()
      if (closed) throw fail('UNAVAILABLE', 503)
      const fingerprint = createHash('sha256').update(`${input.source}|${input.canonicalUrl}|2`).digest('hex')
      const previous = jobs.get(input.jobId)
      if (previous) {
        if (previous.ownerRef !== input.ownerRef) throw fail('FORBIDDEN', 403)
        if (previous.fingerprint !== fingerprint) throw fail('IDEMPOTENCY_CONFLICT', 409)
        return view(previous)
      }
      if (jobs.size >= options.jobs) throw fail('CAPACITY', 503)
      for (const [key, max] of [[`u:${input.ownerRef}`, options.userQuota], [`c:${input.churchRef}`, options.churchQuota]]) if ((quotas.get(key)?.count ?? 0) >= max) throw fail('RATE_LIMITED', 429)
      const cached = cache.get(fingerprint)
      let item = work.get(fingerprint)
      if (!cached && !item && work.size >= options.active + options.queued) throw fail('CAPACITY', 503)
      for (const key of [`u:${input.ownerRef}`, `c:${input.churchRef}`]) {
        const quota = quotas.get(key) ?? { count: 0, until: now() + 3600000 }
        quota.count++; quotas.set(key, quota)
      }
      const job = { ...input, fingerprint, state: 'queued', deadlineAt: now() + options.deadline, leaseAt: now() + options.lease }
      jobs.set(input.jobId, job)
      if (cached) finish(job, 'ready', { result: cached })
      else {
        if (!item) { item = { ids: new Set(), url: input.canonicalUrl, source: input.source, controller: new AbortController(), running: false }; work.set(fingerprint, item) }
        item.ids.add(input.jobId)
        job.state = item.running ? 'extracting' : 'queued'
        pump()
      }
      return view(job)
    },
    read(id, ownerRef) { const job = access(id, ownerRef); if (!terminal(job)) job.leaseAt = now() + options.lease; return view(job) },
    cancel(id, ownerRef) { const job = access(id, ownerRef); if (!terminal(job)) finish(job, 'cancelled'); prune(); pump(); return view(job) },
    sweep() { prune(); pump() },
    async close() { closed = true; clearInterval(interval); for (const item of work.values()) item.controller.abort(); work.clear(); jobs.clear(); quotas.clear() },
  }
}
