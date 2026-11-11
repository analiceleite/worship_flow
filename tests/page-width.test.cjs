const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Padrão de largura: todas as telas de conteúdo usam PAGE_WIDTH (lib/page-layout.ts), sem max-w próprio.
// Telas de formulário centralizado (auth, convite, seleção de igreja) são exceção.

const root = path.resolve(__dirname, '..')
const exceptions = new Set([
  'app/auth/select-church/page.tsx',
  'app/repertoire/player/page.tsx',
])

function listPages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listPages(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

const pages = listPages(path.join(root, 'app'))
  .map(file => path.relative(root, file).replace(/\\/g, '/'))
  .filter(file => file.endsWith('/page.tsx') && !file.startsWith('app/auth/') && !exceptions.has(file))

test('telas de conteúdo usam o padrão de largura PAGE_WIDTH', () => {
  const missing = pages.filter(file => {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    return /<main\b/.test(text) && !/PAGE_WIDTH/.test(text)
  })
  assert.deepEqual(missing, [], 'estas telas têm <main> sem PAGE_WIDTH')
})

test('nenhum <main> de tela de conteúdo define limite máximo de largura próprio', () => {
  const offenders = []
  for (const file of [...pages, 'components/schedule/builder/schedule-builder.tsx']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    const mains = text.match(/<main\b[^>]*>/g) ?? []
    for (const tag of mains) if (/max-w-/.test(tag)) offenders.push(`${file}: ${tag}`)
  }
  assert.deepEqual(offenders, [])
})

test('a constante de largura não tem limite máximo', () => {
  const lib = fs.readFileSync(path.join(root, 'lib/page-layout.ts'), 'utf8')
  assert.match(lib, /export const PAGE_WIDTH = 'mx-auto w-full px-4 sm:px-6 lg:px-8'/)
  assert.doesNotMatch(lib, /max-w-/)
})
