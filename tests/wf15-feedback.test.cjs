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

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
}

const { ErrorState } = loadTypeScript('components/ui/error-state.tsx', {
  'lucide-react': {
    AlertCircle: props => React.createElement('span', { ...props, 'data-icon': 'alert-circle' }),
    RefreshCw: props => React.createElement('span', { ...props, 'data-icon': 'refresh' }),
  },
  '@/components/ui/button': {
    Button: ({ children, ...props }) => React.createElement('button', props, children),
  },
  '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
})

test('erro recuperável anuncia o problema e oferece tentar novamente', () => {
  const markup = renderToStaticMarkup(React.createElement(ErrorState, {
    title: 'Não foi possível carregar as músicas',
    message: 'Verifique sua conexão.',
    onRetry: () => {},
  }))

  assert.match(markup, /role="alert"/)
  assert.ok(markup.includes('Não foi possível carregar as músicas'))
  assert.ok(markup.includes('Verifique sua conexão.'))
  assert.ok(markup.includes('Tentar novamente'))
  assert.ok(markup.includes('<button'))
})

test('tentativa em andamento bloqueia novo clique e é anunciada', () => {
  const markup = renderToStaticMarkup(React.createElement(ErrorState, {
    title: 'Falha',
    onRetry: () => {},
    retrying: true,
  }))

  assert.ok(markup.includes('Tentando…'))
  assert.ok(markup.includes('aria-busy="true"'))
  assert.ok(markup.includes('disabled=""'))
})

test('erro sem recuperação não renderiza ação inútil', () => {
  const markup = renderToStaticMarkup(React.createElement(ErrorState, { title: 'Falha' }))
  assert.ok(!markup.includes('<button'))
})

test('Toaster global está montado no layout raiz', () => {
  const layout = source('app/layout.tsx')
  assert.match(layout, /from '@\/components\/ui\/sonner'/)
  assert.match(layout, /<Toaster\b/)
})

test('exclusão mantém o diálogo aberto e mostra a falha', () => {
  const dialog = source('components/delete-dialog.tsx')
  assert.ok(dialog.includes('Não foi possível excluir'))
  assert.ok(dialog.includes('setError('))
  assert.ok(dialog.indexOf('await onConfirm()') < dialog.indexOf('onOpenChange(false)'))
  assert.ok(!/catch \(err\) \{[\s\S]*onOpenChange\(false\)/.test(dialog))
})

test('biblioteca distingue falha de lista vazia e permite repetir a busca', () => {
  const songs = source('app/songs/page.tsx')
  assert.ok(songs.includes('songsError'))
  assert.ok(songs.includes('onRetry={() => void fetchSongs()}'))
  assert.ok(songs.includes('songsError ? null :'))
  assert.ok(songs.includes('toast.success'))
})

test('equipe informa falha dos convites sem esconder os integrantes', () => {
  const users = source('app/users/page.tsx')
  assert.ok(users.includes('invitationsError'))
  assert.ok(users.includes('Não foi possível carregar os convites'))
  assert.ok(users.includes('invitationsError ? null :'))
  assert.ok(users.includes('onRetry={() => void fetchMinisters()}'))
})

test('repertório separa falha de carregamento de erro de mutação', () => {
  const repertoire = source('app/repertoire/page.tsx')
  assert.ok(repertoire.includes('loadError'))
  assert.ok(repertoire.includes('setLoadError('))
  assert.ok(repertoire.includes('loadError ? null :'))
  assert.ok(repertoire.includes('onRetry={() => void fetchRepertoire()}'))
  assert.ok(repertoire.includes('deleteError'))
  assert.ok(repertoire.includes("if (!success) {"))
  assert.ok(!/await mutateRepertoire[^\n]*\n\s*setDeletingItem\(null\)/.test(repertoire))
})

test('perfil recarrega sem perder a sessão e mantém erro de salvamento visível', () => {
  const profile = source('app/profile/page.tsx')
  assert.ok(profile.includes('loadProfile'))
  assert.ok(profile.includes('saveError'))
  assert.ok(profile.includes('onRetry={() => void loadProfile()}'))
  assert.ok(profile.includes('onRetry={() => void handleSavePreferences()}'))
  assert.ok(!profile.includes('window.location.reload()'))
})

test('sucesso de ação só é anunciado depois da confirmação do servidor', () => {
  const users = source('app/users/page.tsx')
  for (const message of ['Acesso reativado.', 'Acesso suspenso.', 'Músicas transferidas.', 'Convite revogado.']) {
    assert.ok(users.includes(message), message)
  }

  assert.ok(users.includes('invitationDeliveryFeedback(result.delivery?.status)'))
})

const { invitationDeliveryFeedback, createLatestRequest } = loadTypeScript('lib/operation-feedback.ts')

test('HTTP success does not imply email delivery: sent, failed, pending and unknown', () => {
  assert.equal(invitationDeliveryFeedback('sent').kind, 'success')
  assert.equal(invitationDeliveryFeedback('failed').kind, 'error')
  for (const status of ['pending', 'sending', 'skipped', undefined]) {
    assert.equal(invitationDeliveryFeedback(status).kind, 'warning')
  }
})

test('late search responses and unmounted requests are ignored', async () => {
  const requests = createLatestRequest()
  let releaseOld
  const old = new Promise(resolve => { releaseOld = resolve })
  const isOldCurrent = requests.start()
  let songs = []
  const oldRequest = old.then(() => { if (isOldCurrent()) songs = ['old'] })
  const isNewCurrent = requests.start()
  if (isNewCurrent()) songs = ['new']
  releaseOld()
  await oldRequest
  assert.deepEqual(songs, ['new'])
  requests.invalidate()
  assert.equal(isNewCurrent(), false)
})

// Minimal hook runner: executes the actual page callbacks with controlled I/O.
// This is not a browser or accessibility test.
function pageHarness(relativePath, mocks, exportName = 'default', props = {}) {
  const state = [], effects = [], refs = []
  let cursor = 0, tree
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++
      if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }]
    },
    useRef(initial) {
      const i = cursor++
      return refs[i] ??= { current: initial }
    },
    useCallback(fn) { return fn },
    useEffect(fn) { effects.push(fn) },
  }
  const component = name => ({ [name]: props => React.createElement('div', props) })[name]
  const ui = names => Object.fromEntries(names.map(name => [name, component(name)]))
  const shared = {
    react: hooks,
    'next/navigation': { useRouter: () => ({ replace() {} }) },
    'sonner': { toast: { success() {}, error() {}, warning() {} } },
    '@/lib/release-notes': { getAppVersion: () => 'test' },
    '@/lib/operation-feedback': { invitationDeliveryFeedback, createLatestRequest },
    '@/components/ui/button': ui(['Button']),
    '@/components/ui/switch': ui(['Switch']),
    '@/components/ui/checkbox': ui(['Checkbox']),
    '@/components/ui/label': ui(['Label']),
    '@/components/ui/card': ui(['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle']),
    '@/components/ui/error-state': ui(['ErrorState']),
    '@/components/profile-photo': ui(['ProfilePhoto']),
    '@/components/profile-name': ui(['ProfileName']),
    '@/components/user-avatar': ui(['UserAvatar']),
    '@/components/theme-toggle': ui(['ThemeToggle']),
    '@/components/ui/alert': ui(['Alert', 'AlertTitle', 'AlertDescription']),
    '@/components/ui/spinner': ui(['Spinner']),
    '@/components/ui/alert-dialog': ui(['AlertDialog', 'AlertDialogContent', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle']),
  }
  const Page = loadTypeScript(relativePath, { ...shared, ...mocks })[exportName]
  function render() { cursor = 0; effects.length = 0; tree = Page(props); return tree }
  function find(predicate) {
    const walk = node => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { for (const child of node) { const found = walk(child); if (found) return found } }
      else {
        if (predicate(node)) return node
        return walk(node.props?.children)
      }
    }
    const found = walk(tree)
    assert.ok(found, 'Expected control was not rendered')
    return found.props
  }
  return { render, find, effects }
}

test('profile: failed global preference load cannot overwrite pause; retry preserves local edits', async () => {
  const requests = [], notifications = []
  let globalAvailable = false
  const minister = { id: 'member', church_id: 'church', name: 'Synthetic', email_reminders_enabled: true }
  const harness = pageHarness('app/profile/page.tsx', {
    '@/lib/auth/client-context': {
      loadChurchContext: async () => ({ context: {} }),
      loadSelectedMinister: async () => minister,
      churchFetch: async (_church, url, options) => {
        requests.push({ url, body: options?.body && JSON.parse(options.body) })
        if (url === '/api/profile') return { ok: globalAvailable, json: async () => ({ profile: { optional_notifications_paused: true } }) }
        if (url.endsWith('/status')) return { ok: false }
        return { ok: true }
      },
    },
    sonner: { toast: { success: message => notifications.push(message), error() {} } },
  })
  harness.render()
  await harness.effects[0]() // invokes loadProfile; wait for its async I/O below
  for (let i = 0; i < 15; i++) await Promise.resolve()
  harness.render()
  assert.equal(harness.find(node => node.props?.id === 'optional-communications-paused').disabled, true)
  harness.find(node => node.props?.id === 'email-reminders-enabled').onCheckedChange(false)
  harness.render()
  await harness.find(node => node.props?.children === 'Salvar Preferências').onClick()
  assert.equal(requests.at(-1).body.email_reminders_enabled, false)
  assert.ok(!Object.hasOwn(requests.at(-1).body, 'optional_notifications_paused'))
  globalAvailable = true
  harness.render()
  await harness.find(node => node.props?.title === 'Pausa global indisponível').onRetry()
  for (let i = 0; i < 15; i++) await Promise.resolve()
  harness.render()
  assert.equal(harness.find(node => node.props?.id === 'email-reminders-enabled').checked, false)
  assert.equal(harness.find(node => node.props?.id === 'optional-communications-paused').checked, true)
  await harness.find(node => node.props?.children === 'Salvar Preferências').onClick()
  assert.equal(requests.at(-1).body.optional_notifications_paused, true)
  assert.equal(notifications.length, 2)
})

test('Google status failure is not displayed as disconnected; retry recovers inline', async () => {
  let available = false
  const harness = pageHarness('app/profile/page.tsx', {
    '@/lib/auth/client-context': {
      loadChurchContext: async () => ({ context: {} }),
      loadSelectedMinister: async () => ({ id: 'member', church_id: 'church', name: 'Synthetic' }),
      churchFetch: async (_church, url) => url === '/api/profile'
        ? { ok: true, json: async () => ({ profile: { optional_notifications_paused: false } }) }
        : { ok: available, json: async () => ({ connected: false }) },
    },
  })
  harness.render()
  harness.effects[0]()
  for (let i = 0; i < 15; i++) await Promise.resolve()
  harness.render()
  harness.effects[1]()
  for (let i = 0; i < 15; i++) await Promise.resolve()
  harness.render()
  const error = harness.find(node => node.props?.title === 'Google Calendar indisponível')
  available = true
  error.onRetry()
  for (let i = 0; i < 15; i++) await Promise.resolve()
  harness.render()
  assert.ok(harness.find(node => node.props?.children === 'Conectar com Google').href)
})

test('delete: duplicate calls blocked, failure remains open, explicit retry closes only on success', async () => {
  let reject, calls = 0
  const closed = []
  const harness = pageHarness('components/delete-dialog.tsx', {}, 'DeleteDialog', {
    open: true, title: 'Excluir sintético', description: 'Dados fictícios',
    onOpenChange: value => closed.push(value),
    onConfirm: () => {
      calls++
      return calls === 1 ? new Promise((_resolve, rejectPromise) => { reject = rejectPromise }) : Promise.resolve()
    },
  })
  harness.render()
  const confirm = harness.find(node => node.props?.variant === 'destructive' && node.props?.onClick).onClick
  const operation = confirm()
  await confirm()
  assert.equal(calls, 1)
  harness.render()
  assert.equal(harness.find(node => node.props?.variant === 'destructive' && node.props?.onClick).disabled, true)
  const originalError = console.error
  console.error = () => {}
  try { reject(new Error('Falha sintética')); await operation } finally { console.error = originalError }
  assert.deepEqual(closed, [])
  harness.render()
  harness.find(node => node.props?.children === 'Falha sintética')
  await harness.find(node => node.props?.variant === 'destructive' && node.props?.onClick).onClick()
  assert.equal(calls, 2)
  assert.deepEqual(closed, [false])
})
