const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const ts = require('typescript')

function transport(env, request) {
  const { outputText } = ts.transpileModule(fs.readFileSync('lib/supabase/server-fetch.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const module = { exports: {} }
  new Function('exports', 'process', 'fetch', outputText)(module.exports, { env }, request)
  return module.exports.serverSupabaseFetch
}

const local = { SUPABASE_INTERNAL_URL: 'http://gateway:8000', LOCAL_SUPABASE: 'true', NODE_ENV: 'development',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }

test('server transport preserves public URL identity while routing requests internally', async () => {
  const calls = []
  const run = transport(local, async (...args) => { calls.push(args); return new Response('ok') })
  const options = { method: 'POST', headers: { authorization: 'Bearer fake-local-proof' }, body: '{}' }
  await run('http://127.0.0.1:54321/auth/v1/verify?x=1', options)
  assert.equal(String(calls[0][0]), 'http://gateway:8000/auth/v1/verify?x=1')
  assert.equal(calls[0][1], options)
  await run('http://127.0.0.1:54321//unexpected.example/auth/v1/verify', options)
  assert.equal(calls[1][0].origin, 'http://gateway:8000')
})

test('no override means ordinary fetch behavior', async () => {
  const run = transport({}, async (value) => new Response(String(value)))
  assert.equal(await (await run('https://public.example.com')).text(), 'https://public.example.com')
})

test('rewriting a Request preserves its method, headers and body', async () => {
  let captured
  const run = transport(local, async (request) => { captured = request; return new Response('ok') })
  await run(new Request('http://127.0.0.1:54321/rest/v1/songs', {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: 'local-test-key' }, body: '{"title":"local"}',
  }))
  assert.equal(captured.url, 'http://gateway:8000/rest/v1/songs')
  assert.equal(captured.method, 'POST')
  assert.equal(captured.headers.get('apikey'), 'local-test-key')
  assert.equal(await captured.text(), '{"title":"local"}')
})

test('transport refuses production, unexpected hosts and arbitrary internal destinations', () => {
  for (const env of [{ ...local, NODE_ENV: 'production' }, { ...local, LOCAL_SUPABASE: '' },
    { ...local, NEXT_PUBLIC_SUPABASE_URL: 'https://production.example.com' }, { ...local, SUPABASE_INTERNAL_URL: 'http://evil.example.com' }]) {
    assert.throws(() => transport(env, () => assert.fail('Network must not be called'))('http://127.0.0.1:54321/auth/v1/verify'))
  }
  assert.throws(() => transport(local, () => assert.fail('Network must not be called'))('https://evil.example.com'))
})
