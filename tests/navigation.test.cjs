const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function loadTypeScript(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  })
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports,
  )
  return module.exports
}

const { getActiveNavigationHref } = loadTypeScript('lib/navigation.ts')
const { ROUTES } = loadTypeScript('lib/routes.ts')
const destinations = Object.values(ROUTES).map(href => ({ href }))
const menu = [ROUTES.SCHEDULE, ROUTES.SCHEDULE_ADMIN_DASHBOARD, ROUTES.REPERTOIRE].map(href => ({ href }))

test('dashboard and its children select only Dashboard, never Escala too', () => {
  for (const pathname of [ROUTES.SCHEDULE_ADMIN_DASHBOARD, `${ROUTES.SCHEDULE_ADMIN_DASHBOARD}/details`]) {
    assert.equal(getActiveNavigationHref(pathname, menu), ROUTES.SCHEDULE_ADMIN_DASHBOARD)
  }
})

test('schedule builder and quarters remain in Escala; player remains in Repertório', () => {
  for (const pathname of [ROUTES.SCHEDULE, ROUTES.SCHEDULE_ADMIN_BUILDER, ROUTES.SCHEDULE_ADMIN_QUARTERS]) {
    assert.equal(getActiveNavigationHref(pathname, menu), ROUTES.SCHEDULE)
  }
  assert.equal(getActiveNavigationHref('/repertoire/player', menu), ROUTES.REPERTOIRE)
})

test('matching respects path boundaries, visibility and item order', () => {
  assert.equal(getActiveNavigationHref('/schedules', menu), undefined)
  assert.equal(getActiveNavigationHref(ROUTES.SCHEDULE_ADMIN_DASHBOARD, [...menu].reverse()), ROUTES.SCHEDULE_ADMIN_DASHBOARD)
  assert.equal(getActiveNavigationHref(ROUTES.SCHEDULE_ADMIN_DASHBOARD, [{ href: ROUTES.REPERTOIRE }]), undefined)
})

function renderShell(pathname, collapsed = false) {
  const { ApplicationShell } = loadTypeScript('components/application-shell.tsx', {
    'react': { ...React, useState: () => [collapsed, () => {}] },
    'next/navigation': { usePathname: () => pathname },
    '@/lib/routes': { ROUTES },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/components/header': { Header: () => React.createElement('header', null, 'Menu') },
  })
  return renderToStaticMarkup(React.createElement(ApplicationShell, null,
    React.createElement('main', { className: 'mx-auto w-full max-w-4xl' }, 'Conteúdo'),
  ))
}

test('sidebar space belongs to the wrapper, preserving full-width and centered main content', () => {
  for (const collapsed of [false, true]) {
    const markup = renderShell(ROUTES.SCHEDULE_ADMIN_DASHBOARD, collapsed)
    assert.ok(markup.includes(collapsed ? 'md:pl-16' : 'md:pl-60'))
    assert.ok(markup.includes('<main class="mx-auto w-full max-w-4xl">Conteúdo</main>'))
    assert.equal((markup.match(/<header/g) || []).length, 1)
    assert.ok(!markup.includes('margin-left'))
  }
})

test('all internal routes use the shared shell; authentication and public routes do not', () => {
  for (const route of destinations.map(item => item.href).filter(href => !href.startsWith('/auth') && href !== '/')) {
    assert.ok(renderShell(route).includes('<header>'), route)
  }
  for (const route of ['/', '/auth/login', '/auth/reset/token', '/songs-public']) {
    const markup = renderShell(route)
    assert.ok(!markup.includes('<header>'), route)
    assert.ok(!markup.includes('md:pl-'), route)
  }
})

test('sidebar visibility and reserved space use the same 768px breakpoint', () => {
  const headerSource = fs.readFileSync(path.resolve(__dirname, '../components/header.tsx'), 'utf8')
  assert.ok(headerSource.includes('bg-card md:flex'))
  assert.ok(headerSource.includes('sm:px-6 md:hidden'))
  assert.ok(headerSource.includes('className="md:hidden overflow-y-auto'))
  assert.ok(!headerSource.includes('lg:flex'))
  assert.ok(!headerSource.includes('lg:hidden'))
})
