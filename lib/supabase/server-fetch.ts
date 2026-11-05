// Keep the public project URL (and its cookie storage key) unchanged while
// routing server-side requests through the isolated Compose network.
export function serverSupabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const internal = process.env.SUPABASE_INTERNAL_URL
  if (!internal) return fetch(input, init)
  if (process.env.LOCAL_SUPABASE !== 'true' || process.env.NODE_ENV === 'production' ||
      internal !== 'http://gateway:8000' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') {
    throw new Error('Internal Supabase transport is restricted to local Compose development')
  }
  const source = input instanceof Request ? input.url : String(input)
  const url = new URL(source)
  if (url.origin !== 'http://127.0.0.1:54321') throw new Error('Unexpected Supabase transport destination')
  const target = new URL(internal)
  target.pathname = url.pathname
  target.search = url.search
  return fetch(input instanceof Request ? new Request(target, input) : target, init)
}
