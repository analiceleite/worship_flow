import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    })
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@worshipflow.app'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@12345'
const DEMO_CHURCH_SLUG = process.env.DEMO_CHURCH_SLUG ?? 'demo-worship-flow'

function toDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function nextDow(from, dow) {
  const date = new Date(from)
  const delta = (dow - date.getDay() + 7) % 7 || 7
  date.setDate(date.getDate() + delta)
  return date
}

function generateServiceDates(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${endDate}T12:00:00`)
  const dates = []
  const current = new Date(start)

  while (current <= end) {
    if (current.getDay() === 4) dates.push({ event_date: toDateString(current), event_type: 'thursday' })
    if (current.getDay() === 0) dates.push({ event_date: toDateString(current), event_type: 'sunday' })
    current.setDate(current.getDate() + 1)
  }

  return dates
}

async function ok(label, promise) {
  const result = await promise
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function findOrCreateDemoUser() {
  const created = await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { name: 'Admin Demo' },
  })

  if (!created.error && created.data.user) return created.data.user.id
  if (!/already|registered|exists/i.test(created.error?.message ?? '')) {
    throw new Error(`auth create demo user: ${created.error?.message}`)
  }

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error

    const user = data.users.find((item) => item.email?.toLowerCase() === DEMO_EMAIL)
    if (user) {
      await supabase.auth.admin.updateUserById(user.id, { password: DEMO_PASSWORD, email_confirm: true })
      return user.id
    }

    if (data.users.length < 100) break
  }

  throw new Error('Demo user exists but was not found by listUsers')
}

async function upsertMinister(row) {
  const existing = await ok(`find minister ${row.email}`, supabase
    .from('ministers')
    .select('id')
    .eq('church_id', row.church_id)
    .eq('email', row.email)
    .maybeSingle())

  if (existing?.id) {
    return ok(`update minister ${row.email}`, supabase
      .from('ministers')
      .update(row)
      .eq('id', existing.id)
      .select('*')
      .single())
  }

  return ok(`insert minister ${row.email}`, supabase.from('ministers').insert(row).select('*').single())
}

async function main() {
  const demoChurch = await ok('demo church', supabase
    .from('churches')
    .select('*')
    .eq('slug', DEMO_CHURCH_SLUG)
    .single())

  const demoUserId = await findOrCreateDemoUser()

  const admin = await upsertMinister({
    church_id: demoChurch.id,
    name: 'Admin Demo',
    email: DEMO_EMAIL,
    instrument: 'Voz, Violão',
    user_id: demoUserId,
    role: 'admin',
    is_active: true,
    email_reminders_enabled: true,
  })

  const fakeMinisterInputs = [
    ['Ana Demo', 'ana.demo@worshipflow.app', 'Voz'],
    ['Bruno Demo', 'bruno.demo@worshipflow.app', 'Violão'],
    ['Carla Demo', 'carla.demo@worshipflow.app', 'Teclado'],
    ['Diego Demo', 'diego.demo@worshipflow.app', 'Bateria'],
    ['Equipe Mídia Demo', 'midia.demo@worshipflow.app', 'Midia', 'midia'],
  ]

  const fakeMinisters = []
  for (const [name, email, instrument, role = 'minister'] of fakeMinisterInputs) {
    fakeMinisters.push(await upsertMinister({
      church_id: demoChurch.id,
      name,
      email,
      instrument,
      user_id: null,
      role,
      is_active: true,
      email_reminders_enabled: true,
    }))
  }

  const songOwner = fakeMinisters.find((minister) => /voz/i.test(minister.instrument ?? '')) ?? admin
  const { count: demoSongsCount } = await supabase
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .eq('church_id', demoChurch.id)

  let demoSongs = await ok('existing demo songs', supabase
    .from('songs')
    .select('*')
    .eq('church_id', demoChurch.id)
    .order('title')
    .limit(10))

  if ((demoSongsCount ?? 0) < 10) {
    const sourceSongs = await ok('source songs', supabase
      .from('songs')
      .select('*')
      .neq('church_id', demoChurch.id)
      .order('created_at', { ascending: false })
      .limit(10))

    const existingTitles = new Set(demoSongs.map((song) => `${song.title}:::${song.artist}`.toLowerCase()))
    const rows = sourceSongs
      .filter((song) => !existingTitles.has(`${song.title}:::${song.artist}`.toLowerCase()))
      .map((song) => ({
        church_id: demoChurch.id,
        title: song.title,
        artist: song.artist,
        tone: song.tone,
        youtube_url: song.youtube_url,
        cipher_url: song.cipher_url,
        youtube_video_title: song.youtube_video_title,
        cifra_content: song.cifra_content,
        available_tones: song.available_tones,
        capo_frets: song.capo_frets ?? 0,
        minister_id: songOwner.id,
      }))

    if (rows.length) await ok('insert demo songs', supabase.from('songs').insert(rows))
    demoSongs = await ok('reload demo songs', supabase
      .from('songs')
      .select('*')
      .eq('church_id', demoChurch.id)
      .order('title')
      .limit(10))
  }

  const sunday = nextDow(new Date(), 0)
  const sundayStr = toDateString(sunday)
  await ok('delete existing demo Sunday repertoire', supabase
    .from('repertoire')
    .delete()
    .eq('church_id', demoChurch.id)
    .eq('event_date', sundayStr)
    .eq('event_name', 'Culto de Domingo'))

  if (demoSongs.length) {
    await ok('insert demo Sunday repertoire', supabase.from('repertoire').insert(
      demoSongs.slice(0, 6).map((song, index) => ({
        church_id: demoChurch.id,
        song_id: song.id,
        minister_id: songOwner.id,
        event_name: 'Culto de Domingo',
        event_date: sundayStr,
        order_index: index + 1,
      }))
    ))
  }

  const specialDate = toDateString(nextDow(sunday, 4))
  const existingEvent = await ok('find special event', supabase
    .from('special_events')
    .select('id')
    .eq('church_id', demoChurch.id)
    .eq('name', 'Noite de Louvor Demo')
    .eq('event_date', specialDate)
    .maybeSingle())

  if (!existingEvent) {
    await ok('insert special event', supabase.from('special_events').insert({
      church_id: demoChurch.id,
      name: 'Noite de Louvor Demo',
      event_date: specialDate,
      created_by: admin.id,
    }))
  }

  await ok('delete special event repertoire', supabase
    .from('repertoire')
    .delete()
    .eq('church_id', demoChurch.id)
    .eq('event_date', specialDate)
    .eq('event_name', 'Noite de Louvor Demo'))

  if (demoSongs.length) {
    await ok('insert special repertoire', supabase.from('repertoire').insert(
      demoSongs.slice(4, 10).map((song, index) => ({
        church_id: demoChurch.id,
        song_id: song.id,
        minister_id: songOwner.id,
        event_name: 'Noite de Louvor Demo',
        event_date: specialDate,
        order_index: index + 1,
      }))
    ))
  }

  const start = new Date()
  start.setDate(1)
  const end = new Date(start.getFullYear(), start.getMonth() + 2, 0)
  const startDate = toDateString(start)
  const endDate = toDateString(end)

  let quarter = await ok('find demo quarter', supabase
    .from('schedule_quarters')
    .select('*')
    .eq('church_id', demoChurch.id)
    .eq('name', 'Demo - Escala Publicada')
    .maybeSingle())

  if (!quarter) {
    quarter = await ok('insert demo quarter', supabase.from('schedule_quarters').insert({
      church_id: demoChurch.id,
      name: 'Demo - Escala Publicada',
      start_date: startDate,
      end_date: endDate,
      is_published: true,
      created_by: admin.id,
      thursday_arrival_time: '19:00',
      thursday_service_time: '20:00',
      sunday_arrival_time: '16:00',
      sunday_service_time: '18:30',
    }).select('*').single())
  } else if (!quarter.is_published) {
    await ok('publish demo quarter', supabase
      .from('schedule_quarters')
      .update({ is_published: true })
      .eq('id', quarter.id)
      .eq('church_id', demoChurch.id))
  }

  const roles = await ok('roles', supabase.from('schedule_roles').select('*').order('display_order'))
  const serviceDates = generateServiceDates(startDate, endDate)
  await ok('clear demo assignments', supabase.from('schedule_assignments').delete().eq('church_id', demoChurch.id).eq('quarter_id', quarter.id))
  await ok('clear demo rehearsals', supabase.from('schedule_rehearsals').delete().eq('church_id', demoChurch.id).eq('quarter_id', quarter.id))

  const assignable = [admin, ...fakeMinisters]
  const assignments = []
  for (const [dateIndex, serviceDate] of serviceDates.entries()) {
    for (const [roleIndex, role] of roles.entries()) {
      const mediaMinister = fakeMinisters.find((minister) => minister.role === 'midia')
      const minister = role.category === 'midia'
        ? mediaMinister
        : assignable[(dateIndex + roleIndex) % assignable.length]
      assignments.push({
        church_id: demoChurch.id,
        quarter_id: quarter.id,
        role_id: role.id,
        minister_id: minister?.id ?? null,
        is_trainee: roleIndex % 7 === 0,
        event_date: serviceDate.event_date,
        event_type: serviceDate.event_type,
      })
    }
  }
  if (assignments.length) await ok('insert demo assignments', supabase.from('schedule_assignments').insert(assignments))

  const rehearsals = serviceDates.slice(0, 12).map((dateInfo) => ({
    church_id: demoChurch.id,
    quarter_id: quarter.id,
    event_date: dateInfo.event_date,
    event_type: dateInfo.event_type,
    rehearsal_date: dateInfo.event_date,
    rehearsal_time: dateInfo.event_type === 'thursday' ? '19:00' : '16:00',
    rehearsal_place: dateInfo.event_type === 'thursday' ? 'Sala de Ensaio Demo' : 'Auditório Principal Demo',
  }))
  if (rehearsals.length) await ok('insert demo rehearsals', supabase.from('schedule_rehearsals').insert(rehearsals))

  console.log(JSON.stringify({
    demoChurch: demoChurch.name,
    login: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    ministers: 1 + fakeMinisters.length,
    songs: demoSongs.length,
    repertoireEvents: ['Culto de Domingo', 'Noite de Louvor Demo'],
    quarter: quarter.name,
    assignments: assignments.length,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
