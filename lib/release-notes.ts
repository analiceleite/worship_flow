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

/** SemVer ordering: numeric components, stable releases before pre-releases. */
export function compareReleaseVersions(a: string, b: string): number {
  const [aCore, ...aSuffix] = a.split('+')[0].split('-')
  const [bCore, ...bSuffix] = b.split('+')[0].split('-')
  const aParts = aCore.split('.').map(Number)
  const bParts = bCore.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const difference = aParts[index] - bParts[index]
    if (difference) return difference
  }
  if (!aSuffix.length || !bSuffix.length) return Number(!aSuffix.length) - Number(!bSuffix.length)
  const aPre = aSuffix.join('-').split('.')
  const bPre = bSuffix.join('-').split('.')
  for (let index = 0; index < Math.max(aPre.length, bPre.length); index++) {
    if (aPre[index] === undefined) return -1
    if (bPre[index] === undefined) return 1
    if (aPre[index] === bPre[index]) continue
    const aNumeric = /^\d+$/.test(aPre[index])
    const bNumeric = /^\d+$/.test(bPre[index])
    if (aNumeric && bNumeric) return Number(aPre[index]) - Number(bPre[index])
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return aPre[index] < bPre[index] ? -1 : 1
  }
  return 0
}

export function groupReleaseNotesByVersion(items: ReleaseNote[]) {
  const groups = new Map<string, ReleaseNote[]>()
  for (const note of items) {
    const group = groups.get(note.version) ?? []
    group.push(note)
    groups.set(note.version, group)
  }
  return Array.from(groups, ([version, versionNotes]) => ({
    version,
    notes: versionNotes.toSorted((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
  })).toSorted((a, b) => compareReleaseVersions(b.version, a.version))
}

export function getPublishedReleaseNotes(now = new Date()): ReleaseNote[] {
  return notes
    .filter((note) => note.published && !Number.isNaN(Date.parse(note.date)) && new Date(note.date) <= now)
    .map((note) => ({
      ...note,
      href: note.href?.startsWith('/') && !note.href.startsWith('//') ? note.href : undefined,
    }))
    .toSorted((a, b) => compareReleaseVersions(b.version, a.version) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
}

export function getAppVersion(): string | null {
  const version = (process.env.NEXT_PUBLIC_APP_VERSION || packageMetadata.version).trim()
  return version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
    ? version
    : null
}
