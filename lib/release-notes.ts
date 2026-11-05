import rawNotes from '@/content/release-notes.json'
import packageMetadata from '@/package.json'

export type ReleaseNote = {
  id: string
  version: string
  date: string
  title: string
  summary: string
  href?: string
  published: boolean
  notify?: boolean
}

const notes = rawNotes as ReleaseNote[]

export function getPublishedReleaseNotes(now = new Date()): ReleaseNote[] {
  return notes
    .filter((note) => note.published && !Number.isNaN(Date.parse(note.date)) && new Date(note.date) <= now)
    .map((note) => ({
      ...note,
      href: note.href?.startsWith('/') && !note.href.startsWith('//') ? note.href : undefined,
    }))
    .toSorted((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
}

export function getAppVersion(): string | null {
  const version = (process.env.NEXT_PUBLIC_APP_VERSION || packageMetadata.version).trim()
  return version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
    ? version
    : null
}
