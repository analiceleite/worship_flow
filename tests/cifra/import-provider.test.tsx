import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CifraImportProvider, useCifraImport } from '@/components/cifra-import-provider'
const nav = vi.hoisted(() => ({ path: '/songs', push: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.path, useRouter: () => ({ push: nav.push }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }))
afterEach(() => vi.unstubAllGlobals())
function Consumer() {
  const context = useCifraImport()!
  return <><button onClick={() => void context.controller.start({ url: 'https://www.cifraclub.com.br/a/b/', title: 'Meu titulo' }, context.scope!)}>Iniciar teste</button><span>{context.snapshot.draft?.title}</span></>
}
test('internal_navigation_retains_draft_and_reset_clears_it', async () => {
  let finish: (response: Response) => void = () => {}
  vi.stubGlobal('fetch', async (path: string) => {
    if (path === '/api/context') return new Response(JSON.stringify({ context: { userId: 'u', churchId: 'c' }, features: { cifraImportV2: true } }))
    if (path === '/api/cifra/ready') return new Response(JSON.stringify({ ready: true }))
    return new Promise<Response>((resolve) => { finish = resolve })
  })
  const { rerender } = render(<CifraImportProvider><Consumer /></CifraImportProvider>)
  await waitFor(() => expect(screen.getByText('Iniciar teste')).toBeEnabled())
  fireEvent.click(screen.getByText('Iniciar teste'))
  await waitFor(() => expect(screen.getByText('Meu titulo')).toBeInTheDocument())
  nav.path = '/schedule'; rerender(<CifraImportProvider><Consumer /></CifraImportProvider>)
  await act(async () => { finish(new Response(JSON.stringify({ jobId: 'a'.repeat(64), state: 'ready', deadlineAt: Date.now() + 30000, result: { contract_version: 2, parser_version: '2', source: 'cifraclub', cipher_url: 'https://www.cifraclub.com.br/a/b/', name: 'N', artist: 'A', original_lines: ['G D'], original_tone: 'G', capo_frets: null, youtube_url: null, transposition_supported: true, warnings: [] } }))) })
  expect(screen.getByText('Meu titulo')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Revisar cifra' })).toHaveAttribute('href', '/songs?reviewImport=1')
  act(() => window.dispatchEvent(new Event('wf:cifra-context-reset')))
  expect(screen.queryByText('Meu titulo')).not.toBeInTheDocument()
})
