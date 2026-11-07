const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

function loadTypeScript(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relativePath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  })
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports,
  )
  return module.exports
}

const core = loadTypeScript('lib/profile-avatar.ts')
const requestOrigin = loadTypeScript('lib/auth/request-origin.ts')
class AuthContextError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

function setup(options = {}) {
  const calls = { filters: [], uploads: [], removals: [], updates: [] }
  const context = { ministerId: 'minister-1', userId: 'user-1', churchId: 'church-1', isImpersonating: false }
  const publicBase = 'https://storage.example.com/profile-avatars/'
  const bucket = {
    getPublicUrl: key => ({ data: { publicUrl: publicBase + key } }),
    upload: async (...args) => { calls.uploads.push(args); return { error: options.uploadError || null } },
    remove: async keys => { calls.removals.push(keys); return { error: null } },
  }
  const admin = {
    storage: { from: name => { assert.equal(name, core.AVATAR_BUCKET); return bucket } },
    from: name => {
      assert.equal(name, 'user_profiles')
      let updating = false
      const chain = {
        select: () => chain,
        eq: (key, value) => { calls.filters.push([key, value]); return chain },
        update: values => { updating = true; calls.updates.push(values); return chain },
        single: async () => updating
          ? { data: { id: context.ministerId }, error: options.updateError || null }
          : { data: options.missingProfile ? null : { avatar_url: options.oldUrl || null }, error: null },
      }
      return chain
    },
  }
  const route = loadTypeScript('app/api/profile/avatar/route.ts', {
    '@/lib/auth/request-origin': requestOrigin,
    '@/lib/profile-avatar': core,
    '@/lib/auth-context': {
      getImpersonatedChurchId: async () => options.impersonating ? 'church-1' : null,
    },
    '@/lib/auth/identity': { getAuthenticatedIdentity: async () => options.unauthenticated ? null : { id: context.userId } },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
  })
  return { route, calls, publicBase }
}

function request(bytes = [255, 216, 255, 224], type = 'image/jpeg') {
  const form = new FormData()
  form.set('photo', new File([new Uint8Array(bytes)], 'photo.jpg', { type }))
  // Untrusted IDs must never control which profile is updated.
  form.set('ministerId', 'someone-else')
  return new Request('http://localhost/api/profile/avatar', { method: 'POST', headers: { Origin: 'http://localhost' }, body: form })
}

test('only supported types with matching signatures are accepted', () => {
  assert.equal(core.avatarExtension('image/jpeg', new Uint8Array([255, 216, 255])), 'jpg')
  assert.equal(core.avatarExtension('image/png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), 'png')
  assert.equal(core.avatarExtension('image/webp', new TextEncoder().encode('RIFF0000WEBP')), 'webp')
  assert.equal(core.avatarExtension('image/jpeg', new TextEncoder().encode('<svg>')), null)
  assert.equal(core.avatarExtension('image/svg+xml', new TextEncoder().encode('<svg>')), null)
  assert.equal(core.avatarExtension('image/png', new Uint8Array()), null)
})

test('unauthenticated and impersonating sessions cannot upload or remove photos', async () => {
  for (const options of [{ unauthenticated: true }, { impersonating: true }]) {
    const { route, calls } = setup(options)
    for (const method of ['POST', 'DELETE']) {
      const response = await route[method](request())
      assert.equal(response.status, options.unauthenticated ? 401 : 403)
    }
    assert.equal(calls.uploads.length, 0)
    assert.equal(calls.updates.length, 0)
  }
})

test('invalid, empty, oversized and missing files are rejected without upload', async () => {
  const cases = [
    [request([1, 2, 3]), 400],
    [request([]), 400],
    [request(new Uint8Array(core.AVATAR_MAX_BYTES + 1)), 413],
    [new Request('http://localhost/api/profile/avatar', { method: 'POST', headers: { Origin: 'http://localhost' }, body: new FormData() }), 400],
  ]
  for (const [req, status] of cases) {
    const { route, calls } = setup()
    assert.equal((await route.POST(req)).status, status)
    assert.equal(calls.uploads.length, 0)
    assert.equal(calls.updates.length, 0)
  }
})

test('upload updates only the authenticated global profile, independent of church', async () => {
  const { route, calls, publicBase } = setup()
  const response = await route.POST(request())
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.avatar_url.startsWith(publicBase + 'user-1/'))
  assert.match(calls.uploads[0][0], /^user-1\/[a-f0-9-]+\.jpg$/)
  assert.equal(calls.updates[0].avatar_url, body.avatar_url)
  assert.ok(calls.updates[0].updated_at)
  assert.deepEqual(calls.filters, [['user_id', 'user-1'], ['user_id', 'user-1']])
})

test('failed database update cleans up only the new upload', async () => {
  const { route, calls } = setup({ updateError: { message: 'failed' } })
  assert.equal((await route.POST(request())).status, 500)
  assert.deepEqual(calls.removals, [[calls.uploads[0][0]]])
})

test('removal clears profile and deletes only an owned storage object', async () => {
  const base = 'https://storage.example.com/profile-avatars/'
  for (const [url, expected] of [
    [base + 'user-1/abc-123.jpg', [['user-1/abc-123.jpg']]],
    [base + 'church-1/user-1/abc-123.jpg', []],
    [base + 'church-1/other-user/abc-123.jpg', []],
    ['https://external.example.com/photo.jpg', []],
    [base + 'church-1/user-1/../other-user/abc-123.jpg', []],
  ]) {
    const { route, calls } = setup({ oldUrl: url })
    assert.equal((await route.DELETE(new Request('http://localhost/api/profile/avatar', { method: 'DELETE', headers: { Origin: 'http://localhost' } }))).status, 200)
    assert.equal(calls.updates[0].avatar_url, null)
    assert.deepEqual(calls.removals, expected)
  }
})

test('cross-origin and originless uploads are rejected before storage access', async () => {
  for (const origin of [null, 'https://untrusted.example']) {
    const { route, calls } = setup()
    const req = request()
    if (origin) req.headers.set('Origin', origin)
    else req.headers.delete('Origin')
    assert.equal((await route.POST(req)).status, 403)
    assert.equal(calls.uploads.length, 0)
  }
})

test('photo controls live in profile and the menu listens for avatar updates', () => {
  const profile = fs.readFileSync(path.resolve(__dirname, '../app/profile/page.tsx'), 'utf8')
  const header = fs.readFileSync(path.resolve(__dirname, '../components/header.tsx'), 'utf8')
  assert.ok(profile.includes('<ProfilePhoto'))
  assert.ok(header.includes("window.addEventListener('profile-avatar-updated'"))
  assert.ok(header.includes("window.removeEventListener('profile-avatar-updated'"))
  assert.ok(!header.includes('ThemeToggle'))
})
