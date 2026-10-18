import { z } from 'zod'
export const OriginalCifraSchema = z.object({
  contract_version: z.literal(2), parser_version: z.string().min(1).max(32), source: z.enum(['cifraclub', 'cifralize']),
  cipher_url: z.string().url().max(2048), artist: z.string().trim().min(1).max(300), name: z.string().trim().min(1).max(300),
  original_lines: z.array(z.string().max(2000)).min(1).max(3000).refine((lines) => lines.some((line) => line.trim())),
  original_tone: z.string().regex(/^[A-G][#b]?m?$/).nullable(), capo_frets: z.number().int().min(0).max(12).nullable(),
  youtube_url: z.string().url().max(2048).nullable(), transposition_supported: z.boolean(), warnings: z.array(z.string().max(200)).max(20),
}).strict().refine((value) => Buffer.byteLength(JSON.stringify(value)) <= 512 * 1024, 'PAYLOAD_TOO_LARGE')
