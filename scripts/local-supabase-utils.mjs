// No dotenv loading: these utilities must never read production credentials.
export function buildLocalBaseline(source) {
  // 001 is a reference snapshot, not an executable migration. Keep its table
  // definitions unchanged, but resolve their foreign-key dependency order.
  const order = ['ministers', 'songs', 'repertoire', 'schedule_roles', 'schedule_quarters',
    'schedule_assignments', 'schedule_email_notifications', 'schedule_notifications', 'special_events']
  const definitions = new Map()
  for (const match of source.matchAll(/CREATE TABLE public\.(\w+) \([\s\S]*?\n\);/g)) definitions.set(match[1], match[0])
  if (definitions.size !== order.length || order.some((name) => !definitions.has(name))) {
    throw new Error('The reference schema changed. Review the local bootstrap before continuing.')
  }
  return '-- GENERATED LOCAL-ONLY BOOTSTRAP. Never apply to a hosted database.\n' +
    order.map((name) => definitions.get(name)).join('\n\n') + '\n'
}

export function assertLocalUrl(value, port) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.port !== String(port) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Refusing a non-local Supabase destination.')
  }
  return url.origin
}

export function localEnvironment(status, inherited = {}) {
  const api = assertLocalUrl(status.API_URL, 54321)
  const anon = status.ANON_KEY || status.PUBLISHABLE_KEY
  const service = status.SERVICE_ROLE_KEY || status.SECRET_KEY
  if (!anon || !service) throw new Error('Local authentication keys are unavailable. Check Supabase status.')
  return {
    ...inherited,
    NODE_ENV: 'development',
    NEXT_PUBLIC_SUPABASE_URL: api,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
    APP_BASE_URL: 'http://127.0.0.1:3001',
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3001',
    LOCAL_SUPABASE: 'true',
    LOCAL_DOCKER: '', SUPABASE_INTERNAL_URL: '', LOCAL_MAILPIT_URL: '',
    // Empty values prevent Next's .env.local loader from importing production integrations.
    RESEND_API_KEY: '', RESEND_FROM: '', RESEND_FROM_EMAIL: '',
    SCHEDULE_EMAIL_TEST_RECIPIENT: '', CRON_SECRET: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
    YOUTUBE_API_KEY: '',
    CIFRACLUB_IMPORTER_URL: '', CIFRACLUB_IMPORTER_TOKEN: '',
    SUPABASE_ACCESS_TOKEN: '', SUPABASE_DB_PASSWORD: '',
    NEXT_TELEMETRY_DISABLED: '1', SUPABASE_TELEMETRY_DISABLED: '1',
    WATCHPACK_POLLING: 'true', CHOKIDAR_USEPOLLING: 'true',
  }
}
