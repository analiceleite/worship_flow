const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const notes = JSON.parse(fs.readFileSync(path.join(root, 'content/release-notes.json'), 'utf8'))

function loadReleaseNotes() {
  const filename = path.join(root, 'lib/release-notes.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  })
  const mocks = {
    '@/content/release-notes.json': notes,
    '@/package.json': JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(id => mocks[id], module, module.exports)
  return module.exports
}

const releaseNotes = loadReleaseNotes()

test('release groups are ordered by version newest first, even when published on the same date', () => {
  const groups = releaseNotes.groupReleaseNotesByVersion(notes)
  assert.deepEqual(groups.map(group => group.version), ['1.1.1', '1.1.0', '1.0.0'])
  assert.equal(groups[0].notes.length, 1)
  assert.equal(groups[1].notes.length, 3)
  assert.equal(groups[2].notes.length, 1)
  assert.deepEqual(releaseNotes.getPublishedReleaseNotes(new Date('2026-11-06')).map(note => note.version), ['1.1.1', '1.1.0', '1.1.0', '1.1.0', '1.0.0'])
})

test('version ordering uses numeric components, not alphabetical sorting', () => {
  const versions = ['1.9.0', '1.10.0', '2.0.0', '1.1.0', '1.10.1']
  assert.deepEqual(versions.toSorted((a, b) => releaseNotes.compareReleaseVersions(b, a)), ['2.0.0', '1.10.1', '1.10.0', '1.9.0', '1.1.0'])
  assert.ok(releaseNotes.compareReleaseVersions('1.1.0', '1.1.0-rc.1') > 0)
  assert.ok(releaseNotes.compareReleaseVersions('1.1.0-rc.10', '1.1.0-rc.2') > 0)
  assert.equal(releaseNotes.compareReleaseVersions('1.1.0+build.1', '1.1.0+build.2'), 0)
})

test('grouping preserves read identifiers and does not mutate the catalog', () => {
  const original = JSON.stringify(notes)
  const grouped = releaseNotes.groupReleaseNotesByVersion(notes).flatMap(group => group.notes)
  assert.equal(JSON.stringify(notes), original)
  assert.deepEqual(grouped.map(note => note.id).sort(), notes.map(note => note.id).sort())
})

function routeFor(userId, reads) {
  const filename = path.join(root, 'app/api/release-notes/route.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  })
  const localRequire = createRequire(filename)
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: table => {
      assert.equal(table, 'release_note_reads')
      return {
        select: () => ({ eq: async (field, id) => {
          assert.equal(field, 'user_id')
          assert.equal(id, userId)
          return { data: (reads[id] || []).map(note_id => ({ note_id })), error: null }
        } }),
        upsert: async rows => {
          for (const row of rows) {
            assert.equal(row.user_id, userId)
            reads[userId] = [...new Set([...(reads[userId] || []), row.note_id])]
          }
          return { error: null }
        },
      }
    },
  }
  const mocks = {
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/lib/release-notes': { getPublishedReleaseNotes: () => notes.filter(note => note.published) },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports,
  )
  return module.exports
}

test('version 1.1.0 includes new independently unread menu and profile photo notes', () => {
  assert.equal(new Set(notes.map(note => note.id)).size, notes.length)
  for (const id of ['wf-110-responsive-navigation', 'wf-110-profile-photos']) {
    const note = notes.find(note => note.id === id)
    assert.ok(note)
    assert.equal(note.version, '1.1.0')
    assert.equal(note.notify, true)
    assert.equal(note.published, true)
  }
})

test('WF-07 is the 1.1.1 correction release, linked to repertoire and independently unread', async () => {
  const note = notes.find(note => note.id === 'wf-07-complete-repertoire')
  assert.ok(note)
  assert.equal(note.version, '1.1.1')
  assert.equal(note.href, '/repertoire')
  assert.equal(note.published, true)
  assert.equal(note.notify, true)
  assert.equal(releaseNotes.getPublishedReleaseNotes(new Date('2026-11-06'))[0].id, note.id)
  assert.equal(releaseNotes.getAppVersion(), process.env.NEXT_PUBLIC_APP_VERSION || '1.1.1')
  const oldIds = notes.filter(item => item.id !== note.id).map(item => item.id)
  const route = routeFor('existing-user', { 'existing-user': oldIds })
  assert.equal((await (await route.GET()).json()).unreadCount, 1)
})

test('previously read notes do not hide new notes and reading is specific to each user', async () => {
  const oldIds = ['wf-31-password-reset-reliability', 'wf-34-release-notes-center']
  const reads = { first: [...oldIds], second: [...oldIds] }
  const first = routeFor('first', reads)
  const second = routeFor('second', reads)
  assert.equal((await (await first.GET()).json()).unreadCount, 3)
  const response = await first.POST(new Request('http://localhost/api/release-notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteIds: notes.map(note => note.id) }),
  }))
  assert.equal(response.status, 200)
  assert.equal((await (await first.GET()).json()).unreadCount, 0)
  assert.equal((await (await second.GET()).json()).unreadCount, 3)
})

test('reading only a subset leaves other unread notes visible in the indicator', async () => {
  const route = routeFor('user', {})
  const count = (await (await route.GET()).json()).unreadCount
  await route.POST(new Request('http://localhost/api/release-notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteIds: ['wf-110-profile-photos'] }),
  }))
  assert.equal((await (await route.GET()).json()).unreadCount, count - 1)
})

test('navigation alert has an accessible count and remains visible when collapsed', () => {
  const header = fs.readFileSync(path.join(root, 'components/header.tsx'), 'utf8')
  assert.ok(header.includes('hasUnreadNotes && <CircleAlert'))
  assert.ok(header.includes('`${item.name}: ${unreadLabel}`'))
  assert.ok(header.includes("'absolute right-0 top-0 rounded-full bg-card'"))
  assert.ok(header.includes("window.addEventListener('release-notes-read', refreshUnreadNotes)"))
  assert.ok(header.includes("window.addEventListener('focus', refreshUnreadNotes)"))
  assert.ok(header.includes('requestId === latestRequest'))
})
