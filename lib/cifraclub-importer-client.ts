import type { ImportedCifra } from '@/lib/cifralize-scraper'

export class CifraClubImporterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 500,
    public readonly availableTones?: string[]
  ) {
    super(message)
    this.name = 'CifraClubImporterError'
  }
}

export function isCifraClubImporterConfigured(): boolean {
  return Boolean(process.env.CIFRACLUB_IMPORTER_URL && process.env.CIFRACLUB_IMPORTER_TOKEN)
}

export async function importFromCifraClubService(params: {
  url?: string
  artist?: string
  song?: string
  targetTone?: string | null
}): Promise<ImportedCifra> {
  const baseUrl = process.env.CIFRACLUB_IMPORTER_URL?.replace(/\/+$/g, '')
  const token = process.env.CIFRACLUB_IMPORTER_TOKEN

  if (!baseUrl || !token) {
    throw new CifraClubImporterError('Importador CifraClub não configurado.', 'NOT_CONFIGURED', 503)
  }

  const response = await fetch(`${baseUrl}/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: params.url,
      artist: params.artist,
      song: params.song,
      target_tone: params.targetTone,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(35_000),
  })

  const data = (await response.json().catch(() => ({}))) as ImportedCifra & {
    error?: string
    code?: string
    available_tones?: string[]
  }

  if (!response.ok) {
    throw new CifraClubImporterError(
      data.error ?? 'Erro ao importar cifra pelo serviço CifraClub.',
      data.code ?? 'FETCH_FAILED',
      response.status,
      data.available_tones
    )
  }

  return {
    artist: data.artist,
    name: data.name,
    tone: data.tone,
    available_tones: data.available_tones ?? [],
    youtube_url: data.youtube_url ?? '',
    cipher_url: data.cipher_url,
    cifra: data.cifra ?? [],
    capo_frets: data.capo_frets ?? 0,
  }
}
