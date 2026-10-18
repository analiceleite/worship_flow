import { z } from 'zod'
import { normalizeCifraClubTone } from './tone'
import { canonicalizeCifraUrl } from './url'

const tone = z.string().refine((value) => normalizeCifraClubTone(value) !== null, 'INVALID_TONE')
export const OriginalCifraSchema = z.object({
  contract_version: z.literal(2), parser_version: z.string().min(1).max(32),
  source: z.enum(['cifraclub', 'cifralize']),
  cipher_url: z.string().max(2048).refine((value) => { try { canonicalizeCifraUrl(value); return true } catch { return false } }),
  artist: z.string().trim().min(1).max(300), name: z.string().trim().min(1).max(300),
  original_lines: z.array(z.string().max(2000)).min(1).max(3000).refine((lines) => lines.some((line) => line.trim())),
  original_tone: tone.nullable(), capo_frets: z.number().int().min(0).max(12).nullable(),
  youtube_url: z.string().url().max(2048).nullable(), transposition_supported: z.boolean(),
  warnings: z.array(z.string().max(200)).max(20),
}).strict().superRefine((value, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 512 * 1024) ctx.addIssue({ code: 'custom', message: 'PAYLOAD_TOO_LARGE' })
  try {
    if (canonicalizeCifraUrl(value.cipher_url).source !== value.source) ctx.addIssue({ code: 'custom', message: 'SOURCE_MISMATCH' })
  } catch { ctx.addIssue({ code: 'custom', message: 'INVALID_URL' }) }
})
export type OriginalCifra = z.infer<typeof OriginalCifraSchema>
export const JobViewSchema = z.object({
  jobId: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(['queued', 'extracting', 'validating', 'ready', 'failed', 'cancelled', 'expired']),
  deadlineAt: z.number(), result: OriginalCifraSchema.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})
export type JobView = z.infer<typeof JobViewSchema>
export type ImportScope = { userId: string; churchId: string }
export type ImportFailure = { code: string; message: string; retryAfterSec?: number }
