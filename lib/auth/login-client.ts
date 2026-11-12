// WF-46: password sign-in is sent to the server, which applies the login limits and sets the session cookies.
export async function signInThroughServer(email: string, password: string): Promise<{ emailConfirmed: boolean }> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.')
  return { emailConfirmed: Boolean(data.emailConfirmed) }
}
