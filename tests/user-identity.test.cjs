const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function source(file) {
  return fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
}

function loadAvatar() {
  const filename = path.resolve(__dirname, '../components/user-avatar.tsx')
  const { outputText } = ts.transpileModule(source('components/user-avatar.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  })
  const localRequire = createRequire(filename)
  const mocks = {
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/components/ui/avatar': {
      Avatar: props => React.createElement('span', props),
      AvatarFallback: props => React.createElement('span', props),
      AvatarImage: props => React.createElement('img', props),
    },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports,
  )
  return module.exports.UserAvatar
}

const UserAvatar = loadAvatar()

test('general song catalog fetches the photo and identifies the contributor separately from the artist', () => {
  const page = source('app/songs/page.tsx')
  const card = source('components/song-card.tsx')
  assert.ok(page.includes('minister:ministers(id, name, instrument, avatar_url)'))
  assert.ok(card.includes('showMinister && song.minister'))
  assert.ok(card.includes('avatarUrl={song.minister.avatar_url}'))
  assert.ok(card.includes('Adicionada por'))
  assert.ok(card.includes('{song.artist}'))
  assert.ok(card.includes('{song.title}'))
})

test('shared avatar shows photo, accessible name and initials, without stretching the image', () => {
  const html = renderToStaticMarkup(React.createElement(UserAvatar, {
    name: 'Ana Silva', avatarUrl: 'https://example.com/photo.jpg', className: 'h-5 w-5',
  }))
  assert.ok(html.includes('src="https://example.com/photo.jpg"'))
  assert.ok(html.includes('alt="Foto de Ana Silva"'))
  assert.ok(html.includes('loading="lazy"'))
  assert.ok(html.includes('object-cover'))
  assert.ok(html.includes('>AS</span>'))
  assert.ok(html.includes('h-5 w-5'))
})

test('missing photos and whitespace-only names retain a readable fallback', () => {
  for (const [name, fallback] of [[' Ana   Silva ', 'AS'], ['Ana', 'A'], ['  ', '?']]) {
    const html = renderToStaticMarkup(React.createElement(UserAvatar, { name, avatarUrl: null }))
    assert.ok(!html.includes('src='))
    assert.ok(html.includes(`>${fallback}</span>`))
  }
})

test('schedule endpoints return avatar URL within existing church-scoped queries', () => {
  for (const file of [
    'app/api/schedule/current/route.ts',
    'app/api/schedule/quarters/[id]/assignments/route.ts',
    'app/api/schedule/assignment/route.ts',
  ]) {
    const code = source(file)
    assert.ok(code.includes('minister:ministers(id, name, avatar_url)'), file)
    assert.ok(code.includes(".eq('church_id', context.churchId)"), file)
  }
  assert.ok(source('app/api/ministers/search/route.ts').includes(".select('id, name, email, avatar_url')"))
})

test('schedule photos survive optimistic edits and keep names, trainee and self indicators', () => {
  const grid = source('components/schedule/ScheduleGrid.tsx')
  assert.ok(grid.includes('minister_avatar_url: minister?.avatar_url ?? null'))
  assert.ok(grid.includes('minister_avatar_url: assignment.minister?.avatar_url ?? null'))
  assert.ok(grid.includes('{renderCell(assignment, cellKey, role)}'))
  assert.ok(grid.includes("{assignment.minister?.name ?? 'Vazio'}"))
  assert.ok(grid.includes('aprendiz'))
  assert.ok(grid.includes('>você</span>'))
  assert.ok(source('app/schedule/admin/builder/page.tsx').includes('avatar_url: payload.minister_avatar_url ?? null'))
})
