import type { SupabaseClient } from '@supabase/supabase-js'

export const CIFRA_BUCKET = 'cifras'
export const MAX_CIFRA_FILE_BYTES = 10 * 1024 * 1024

const ACCEPTED_MIME = new Set([
  'application/pdf',
])

export function validateCifraFile(file: File): string | null {
  if (!ACCEPTED_MIME.has(file.type)) {
    return 'Envie um arquivo PDF.'
  }
  if (file.size > MAX_CIFRA_FILE_BYTES) {
    return 'O arquivo deve ter no máximo 10 MB.'
  }
  return null
}

function extensionForFile(file: File): string {
  return 'pdf'
}

export function isPdfStoragePath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf')
}

export async function uploadCifraFile(
  supabase: SupabaseClient,
  songId: string,
  file: File
): Promise<string> {
  const validationError = validateCifraFile(file)
  if (validationError) throw new Error(validationError)

  const path = `${songId}/cifra.${extensionForFile(file)}`
  const { error } = await supabase.storage.from(CIFRA_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
  })

  if (error) throw error
  return path
}

export async function getCifraSignedUrl(
  supabase: SupabaseClient,
  path: string,
  expiresIn = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CIFRA_BUCKET)
    .createSignedUrl(path, expiresIn)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export function songHasCifra(song: {
  cifra_content?: string[] | null
  cifra_pdf_path?: string | null
}): boolean {
  return Boolean(
    (song.cifra_pdf_path && song.cifra_pdf_path.length > 0) ||
      (song.cifra_content && song.cifra_content.length > 0)
  )
}
