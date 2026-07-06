import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/routes'
import {
  computeEventArrivalDateTime,
  BRAZIL_UTC_OFFSET_HOURS,
  type EventType,
  type QuarterTimeConfig,
} from '@/lib/schedule/event-time'

type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped'
type NotificationType = 'quarter_published' | 'reminder_7days' | 'reminder_1day' | 'reminder_offset'
const BIMESTER_PUBLISHED_NOTIFICATION_TYPE: NotificationType = 'quarter_published'

type QueueRow = {
  dedupe_key: string
  notification_type: NotificationType
  quarter_id: string | null
  minister_id: string
  event_date: string | null
  status: NotificationStatus
  attempts: number
  last_error: string | null
  sent_at: string | null
  payload_json: Record<string, unknown>
}

type AssignmentWithRelations = {
  minister_id: string | null
  event_date: string
  event_type: EventType
  minister: {
    id: string
    name: string
    email: string | null
    is_active: boolean
    email_reminders_enabled: boolean
    email_reminder_offsets_minutes: number[] | null
  } | null
  role: { name: string } | null
}

type RehearsalRow = {
  event_date: string
  event_type: EventType
  rehearsal_date: string | null
  rehearsal_time: string | null
  rehearsal_place: string | null
}

function toPtDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, (month ?? 1) - 1, day ?? 1)
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function capitalizePt(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

/** Ex.: "Domingo, 31/05/2026" — dia da semana uma vez só. */
function formatEventDateLabel(eventDate: string) {
  return capitalizePt(toPtDate(eventDate))
}

function toRehearsalSummary(input: {
  rehearsal_date?: string | null
  rehearsal_time?: string | null
  rehearsal_place?: string | null
}) {
  const parts: string[] = []

  if (input.rehearsal_date) {
    parts.push(toPtDate(input.rehearsal_date))
  }
  if (input.rehearsal_time) {
    parts.push(String(input.rehearsal_time).slice(0, 5))
  }
  if (input.rehearsal_place) {
    parts.push(input.rehearsal_place)
  }

  return parts.length ? parts.join(' - ') : null
}

export function groupAssignmentsByMinister(
  assignments: AssignmentWithRelations[],
  rehearsalsByEvent: Map<string, RehearsalRow>
) {
  const grouped = new Map<
    string,
    {
      minister_id: string
      minister_name: string
      minister_email: string | null
      items: Array<{
        event_date: string
        event_type: 'thursday' | 'sunday'
        role_name: string
        rehearsal_date: string | null
        rehearsal_time: string | null
        rehearsal_place: string | null
      }>
    }
  >()

  for (const row of assignments) {
    if (!row.minister_id || !row.minister || !row.minister.is_active) continue

    if (!grouped.has(row.minister_id)) {
      grouped.set(row.minister_id, {
        minister_id: row.minister_id,
        minister_name: row.minister.name,
        minister_email: row.minister.email,
        items: [],
      })
    }

    const rehearsal = rehearsalsByEvent.get(`${row.event_date}_${row.event_type}`)

    grouped.get(row.minister_id)!.items.push({
      event_date: row.event_date,
      event_type: row.event_type,
      role_name: row.role?.name ?? 'Função',
      rehearsal_date: rehearsal?.rehearsal_date ?? null,
      rehearsal_time: rehearsal?.rehearsal_time ?? null,
      rehearsal_place: rehearsal?.rehearsal_place ?? null,
    })
  }

  for (const value of grouped.values()) {
    value.items.sort((a, b) => {
      if (a.event_date !== b.event_date) return a.event_date < b.event_date ? -1 : 1
      if (a.event_type !== b.event_type) return a.event_type === 'thursday' ? -1 : 1
      return a.role_name.localeCompare(b.role_name)
    })
  }

  return Array.from(grouped.values())
}

export async function enqueueBimesterPublishedNotifications(input: {
  bimesterId: string
  bimesterName: string
}) {
  const admin = createAdminClient()

  const [assignmentsRes, rehearsalsRes] = await Promise.all([
    admin
      .from('schedule_assignments')
      .select(
        'minister_id, event_date, event_type, minister:ministers(id, name, email, is_active), role:schedule_roles(name)'
      )
      .eq('quarter_id', input.bimesterId)
      .not('minister_id', 'is', null),
    admin
      .from('schedule_rehearsals')
      .select('event_date, event_type, rehearsal_date, rehearsal_time, rehearsal_place')
      .eq('quarter_id', input.bimesterId),
  ])

  if (assignmentsRes.error) throw new Error(assignmentsRes.error.message)
  if (rehearsalsRes.error) throw new Error(rehearsalsRes.error.message)

  const rehearsalsByEvent = new Map<string, RehearsalRow>()
  for (const rehearsal of (rehearsalsRes.data ?? []) as RehearsalRow[]) {
    rehearsalsByEvent.set(`${rehearsal.event_date}_${rehearsal.event_type}`, rehearsal)
  }

  const grouped = groupAssignmentsByMinister(
    (assignmentsRes.data ?? []) as AssignmentWithRelations[],
    rehearsalsByEvent
  )
  if (grouped.length === 0) return { queued: 0 }

  const rows: QueueRow[] = grouped.map((g) => ({
    dedupe_key: `quarter_published:${input.bimesterId}:${g.minister_id}`,
    notification_type: BIMESTER_PUBLISHED_NOTIFICATION_TYPE,
    quarter_id: input.bimesterId,
    minister_id: g.minister_id,
    event_date: null,
    status: 'pending',
    attempts: 0,
    last_error: null,
    sent_at: null,
    payload_json: {
      bimester_name: input.bimesterName,
      minister_name: g.minister_name,
      minister_email: g.minister_email,
      items: g.items,
    },
  }))

  const dedupeKeys = rows.map((r) => r.dedupe_key)
  const { data: alreadySent } = await admin
    .from('schedule_email_notifications')
    .select('dedupe_key')
    .in('dedupe_key', dedupeKeys)
    .eq('status', 'sent')

  const sentKeys = new Set((alreadySent ?? []).map((r: { dedupe_key: string }) => r.dedupe_key))
  const rowsToUpsert = rows.filter((r) => !sentKeys.has(r.dedupe_key))

  if (rowsToUpsert.length === 0) return { queued: 0 }

  const { error: insertError } = await admin
    .from('schedule_email_notifications')
    .upsert(rowsToUpsert, { onConflict: 'dedupe_key' })

  if (insertError) throw new Error(insertError.message)
  return { queued: rowsToUpsert.length }
}

// Deve casar com o default da coluna ministers.email_reminder_offsets_minutes (migração 025).
const DEFAULT_EMAIL_REMINDER_OFFSETS_MINUTES = [10080, 1440] // 7 dias, 1 dia
// Cobre o maior offset hoje disponível na UI (7 dias) + folga.
const OFFSET_REMINDER_LOOKAHEAD_DAYS = 8

function normalizeReminderOffsets(raw: unknown): number[] {
  const offsets = Array.isArray(raw) ? raw : DEFAULT_EMAIL_REMINDER_OFFSETS_MINUTES
  return offsets
    .map((v) => (typeof v === 'string' ? parseInt(v, 10) : v))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
}

function toBrazilDateString(date: Date): string {
  return new Date(date.getTime() - BRAZIL_UTC_OFFSET_HOURS * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function enqueueOffsetReminderNotifications(input?: { now?: Date }) {
  const now = input?.now ?? new Date()
  const admin = createAdminClient()

  const { data: publishedBimesterRaw, error: publishedBimesterError } = await admin
    .from('schedule_quarters')
    .select('id, name, thursday_arrival_time, thursday_service_time, sunday_arrival_time, sunday_service_time')
    .eq('is_published', true)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (publishedBimesterError) throw new Error(publishedBimesterError.message)
  if (!publishedBimesterRaw) return { queued: 0 }

  const publishedBimester = publishedBimesterRaw as QuarterTimeConfig & { id: string; name: string }

  const todayStr = toBrazilDateString(now)
  const lookaheadEnd = new Date(now.getTime() + OFFSET_REMINDER_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)
  const lookaheadEndStr = toBrazilDateString(lookaheadEnd)

  const [assignmentsRes, rehearsalsRes] = await Promise.all([
    admin
      .from('schedule_assignments')
      .select(
        'minister_id, event_date, event_type, minister:ministers(id, name, email, is_active, email_reminders_enabled, email_reminder_offsets_minutes), role:schedule_roles(name)'
      )
      .eq('quarter_id', publishedBimester.id)
      .gte('event_date', todayStr)
      .lte('event_date', lookaheadEndStr)
      .not('minister_id', 'is', null),
    admin
      .from('schedule_rehearsals')
      .select('event_date, event_type, rehearsal_time')
      .eq('quarter_id', publishedBimester.id),
  ])

  if (assignmentsRes.error) throw new Error(assignmentsRes.error.message)
  if (rehearsalsRes.error) throw new Error(rehearsalsRes.error.message)

  const assignments = (assignmentsRes.data ?? []) as AssignmentWithRelations[]

  const rehearsalTimeByEvent = new Map<string, string | null>()
  for (const r of (rehearsalsRes.data ?? []) as Array<{ event_date: string; event_type: EventType; rehearsal_time: string | null }>) {
    rehearsalTimeByEvent.set(`${r.event_date}_${r.event_type}`, r.rehearsal_time)
  }

  // Calcula o instante real de chegada de cada evento distinto uma única vez (reaproveitado entre ministros).
  const arrivalByEvent = new Map<string, Date>()
  for (const row of assignments) {
    const eventKey = `${row.event_date}_${row.event_type}`
    if (arrivalByEvent.has(eventKey)) continue
    arrivalByEvent.set(
      eventKey,
      computeEventArrivalDateTime({
        eventDate: row.event_date,
        eventType: row.event_type,
        quarter: publishedBimester,
        rehearsalTimeOverride: rehearsalTimeByEvent.get(eventKey) ?? null,
      })
    )
  }

  // Lembretes não incluem ensaio: a data do ensaio pode ser dias antes do culto.
  const grouped = groupAssignmentsByMinister(assignments, new Map())
    // Filtrar ministros que desabilitaram lembretes por email
    .filter((g) => {
      const minister = assignments.find((a) => a.minister_id === g.minister_id)?.minister
      return minister?.email_reminders_enabled !== false
    })

  if (grouped.length === 0) return { queued: 0 }

  const rows: QueueRow[] = []

  for (const g of grouped) {
    const minister = assignments.find((a) => a.minister_id === g.minister_id)?.minister
    const offsets = normalizeReminderOffsets(minister?.email_reminder_offsets_minutes)

    // Eventos distintos deste ministro (uma ou mais funções no mesmo dia contam como um só evento).
    const eventsForMinister = new Map<string, { event_date: string; event_type: EventType }>()
    for (const item of g.items) {
      eventsForMinister.set(`${item.event_date}_${item.event_type}`, {
        event_date: item.event_date,
        event_type: item.event_type,
      })
    }

    for (const [eventKey, evt] of eventsForMinister) {
      const arrival = arrivalByEvent.get(eventKey)
      if (!arrival || arrival.getTime() <= now.getTime()) continue // evento já começou/passou

      for (const offsetMinutes of offsets) {
        const triggerAt = arrival.getTime() - offsetMinutes * 60_000
        if (triggerAt > now.getTime()) continue // ainda não venceu

        rows.push({
          dedupe_key: `reminder_offset:${g.minister_id}:${eventKey}:${offsetMinutes}`,
          notification_type: 'reminder_offset',
          quarter_id: publishedBimester.id,
          minister_id: g.minister_id,
          event_date: evt.event_date,
          status: 'pending',
          attempts: 0,
          last_error: null,
          sent_at: null,
          payload_json: {
            bimester_name: publishedBimester.name,
            minister_name: g.minister_name,
            minister_email: g.minister_email,
            target_date: evt.event_date,
            offset_minutes: offsetMinutes,
            items: g.items.filter((i) => i.event_date === evt.event_date && i.event_type === evt.event_type),
          },
        })
      }
    }
  }

  if (rows.length === 0) return { queued: 0 }

  const dedupeKeys = rows.map((r) => r.dedupe_key)
  const { data: alreadySent } = await admin
    .from('schedule_email_notifications')
    .select('dedupe_key')
    .in('dedupe_key', dedupeKeys)
    .eq('status', 'sent')

  const sentKeys = new Set((alreadySent ?? []).map((r: { dedupe_key: string }) => r.dedupe_key))
  const rowsToUpsert = rows.filter((r) => !sentKeys.has(r.dedupe_key))

  if (rowsToUpsert.length === 0) return { queued: 0 }

  const { error: insertError } = await admin
    .from('schedule_email_notifications')
    .upsert(rowsToUpsert, { onConflict: 'dedupe_key' })

  if (insertError) throw new Error(insertError.message)
  return { queued: rowsToUpsert.length }
}

type EmailTemplateInput = {
  notificationType: NotificationType
  payload: Record<string, unknown>
}

// Fallback para linhas 'reminder_7days'/'reminder_1day' já enfileiradas antes desta migração
// (a fila pode ter linhas pendentes no momento do deploy).
const LEGACY_REMINDER_OFFSET_BY_TYPE: Partial<Record<NotificationType, number>> = {
  reminder_7days: 10080,
  reminder_1day: 1440,
}

function resolveOffsetMinutes(input: EmailTemplateInput): number {
  if (input.notificationType === 'reminder_offset') {
    const raw = input.payload.offset_minutes
    const parsed = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return LEGACY_REMINDER_OFFSET_BY_TYPE[input.notificationType] ?? 1440
}

function formatOffsetPhrase(minutes: number): string {
  if (minutes === 1440) return 'amanhã'
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return `em ${days} dia${days > 1 ? 's' : ''}`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `em ${hours} hora${hours > 1 ? 's' : ''}`
  }
  return `em ${minutes} minutos`
}

function buildEmailTemplate(input: EmailTemplateInput) {
  const ministerName = String(input.payload.minister_name ?? 'Ministro(a)').trim()
  const bimesterName = String(input.payload.bimester_name ?? input.payload.quarter_name ?? 'Escala')
  const items = Array.isArray(input.payload.items) ? input.payload.items : []
  const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '')
  const scheduleUrl = baseUrl ? `${baseUrl}${ROUTES.SCHEDULE}` : ROUTES.SCHEDULE
  const isReminder =
    input.notificationType === 'reminder_offset' ||
    input.notificationType === 'reminder_7days' ||
    input.notificationType === 'reminder_1day'
  const offsetMinutes = isReminder ? resolveOffsetMinutes(input) : 0
  const offsetPhrase = isReminder ? formatOffsetPhrase(offsetMinutes) : ''
  const isOneDayPhrasing = offsetMinutes === 1440
  const isLongLeadReminder = isReminder && offsetMinutes >= 10080
  const targetDate = String(input.payload.target_date ?? '')

  const groupedByEvent = new Map<string, {
    eventDate: string
    eventType: 'thursday' | 'sunday'
    roles: string[]
    rehearsal: string | null
  }>()

  for (const item of items) {
    const event = item as {
      event_date?: string
      event_type?: 'thursday' | 'sunday'
      role_name?: string
      rehearsal_date?: string | null
      rehearsal_time?: string | null
      rehearsal_place?: string | null
    }

    const rawEventDate = event.event_date ?? ''
    const rawEventType = event.event_type ?? 'thursday'
    const key = `${rawEventDate}_${rawEventType}`

    if (!groupedByEvent.has(key)) {
      groupedByEvent.set(key, {
        eventDate: rawEventDate,
        eventType: rawEventType,
        roles: [],
        rehearsal: isReminder ? null : toRehearsalSummary(event),
      })
    }

    const roleName = event.role_name ?? 'Função'
    const group = groupedByEvent.get(key)!
    if (!group.roles.includes(roleName)) {
      group.roles.push(roleName)
    }
  }

  const sortedEvents = Array.from(groupedByEvent.values())
    .sort((a, b) => {
      if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1
      if (a.eventType !== b.eventType) return a.eventType === 'thursday' ? -1 : 1
      return 0
    })

  const reminderEventLabel = targetDate ? formatEventDateLabel(targetDate) : ''

  const lines = sortedEvents.map((event) => ({
    header: event.eventDate ? formatEventDateLabel(event.eventDate) : '-',
    roles: event.roles,
    rehearsal: event.rehearsal,
  }))

  const textDetailsLabel = isReminder
    ? (isOneDayPhrasing ? 'Suas funções amanhã:' : 'Suas funções neste culto:')
    : 'Detalhes:'

  const htmlDetailsLabel = isReminder
    ? (isOneDayPhrasing ? 'Suas funções amanhã' : 'Suas funções neste culto')
    : 'Detalhes da sua escala'

  const itemCards = lines
    .map((line) => {
      const rehearsalBlock =
        line.rehearsal && !isReminder
          ? `<div style="margin-top:6px;font-size:12px;color:#6b7280;"><strong>Ensaio:</strong> ${line.rehearsal}</div>`
          : ''
      return `<div style="border:1px solid #e4e4e7;border-radius:12px;padding:12px 14px;background:#f6f6f7;margin-bottom:10px;font-size:14px;line-height:1.5;color:#1f2937;"><div style="font-weight:700;margin-bottom:4px;">${line.header}</div><div style="font-size:13px;color:#4b5563;"><strong>Funções:</strong> ${line.roles.join(', ')}</div>${rehearsalBlock}</div>`
    })
    .join('')

  const emailShell = (content: {
    eyebrow: string
    title: string
    message: string
    accentColor: string
    accentSoft: string
    ctaLabel: string
  }) => `
    <div style="margin:0;padding:32px 16px;background:#f6f6f7;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,Helvetica,sans-serif;color:#1f2937;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:20px;overflow:hidden;box-shadow:0 10px 26px rgba(15,23,42,0.07);">
        <div style="height:4px;background:#ff3b30;"></div>
        <div style="padding:28px 28px 20px;background:${content.accentSoft};border-bottom:1px solid #e4e4e7;">
          <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:#ffffff;color:${content.accentColor};border:1px solid #e4e4e7;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">
            ${content.eyebrow}
          </div>
          <h1 style="margin:16px 0 8px;font-size:26px;line-height:1.2;color:#1f2937;">${content.title}</h1>
          <p style="margin:0;font-size:15px;line-height:1.7;color:#6b7280;">${content.message}</p>
        </div>

        <div style="padding:24px 28px;">
          <div style="margin-bottom:10px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;">
            ${htmlDetailsLabel}
          </div>

          <div style="margin-bottom:24px;">
            ${itemCards || '<div style="border:1px solid #e4e4e7;border-radius:12px;padding:12px 14px;background:#ffffff;font-size:14px;color:#6b7280;">Nenhuma escala encontrada.</div>'}
          </div>

          <div style="text-align:center;margin-bottom:10px;">
            <a href="${scheduleUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:${content.accentColor};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">
              ${content.ctaLabel}
            </a>
          </div>

          <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">
            Você está recebendo esta mensagem porque está escalado(a) no sistema Worship Flow.
          </p>
        </div>
      </div>
    </div>`

  if (input.notificationType === BIMESTER_PUBLISHED_NOTIFICATION_TYPE) {
    return {
      subject: `Nova escala publicada - ${bimesterName}`,
      text: [
        `Olá, ${ministerName}!`,
        '',
        `A escala bimestral "${bimesterName}" foi publicada.`,
        '',
        'Suas escalas:',
        ...lines.map((line) => {
          const base = `${line.header} | Funções: ${line.roles.join(', ')}`
          return line.rehearsal ? `${base} | Ensaio: ${line.rehearsal}` : base
        }),
        '',
        `Acesse o sistema para mais detalhes: ${scheduleUrl}`,
      ].join('\n'),
      html: emailShell({
        eyebrow: 'Nova escala',
        title: `Sua escala do bimestre foi publicada`,
        message: `Olá, ${ministerName}. A escala bimestral "${bimesterName}" já está disponível com todas as suas datas e funções.`,
        accentColor: '#ff3b30',
        accentSoft: '#fff1f0',
        ctaLabel: 'Ver minha escala',
      }),
    }
  }

  const reminderIntro = reminderEventLabel
    ? `Sua escala é ${offsetPhrase}: ${reminderEventLabel}.`
    : `Sua escala é ${offsetPhrase}.`
  const reminderGuidance = isLongLeadReminder
    ? 'Use esta semana para se organizar, revisar repertório e combinar com a equipe. Os detalhes do ensaio, quando houver, estão na escala no sistema.'
    : 'Revise suas funções abaixo e chegue preparado(a) para o culto.'

  return {
    subject: reminderEventLabel
      ? `Lembrete: escala ${offsetPhrase} — ${reminderEventLabel}`
      : `Lembrete: sua escala é ${offsetPhrase}`,
    text: [
      `Olá, ${ministerName}!`,
      '',
      reminderIntro,
      reminderGuidance,
      '',
      textDetailsLabel,
      ...lines.map((line) => `${line.header} | Funções: ${line.roles.join(', ')}`),
      '',
      `Veja a escala completa em: ${scheduleUrl}`,
    ].join('\n'),
    html: emailShell({
      eyebrow: `Escala ${offsetPhrase}`,
      title: reminderEventLabel
        ? `Sua escala é ${offsetPhrase} — ${reminderEventLabel}`
        : `Sua escala é ${offsetPhrase}`,
      message: `Olá, ${ministerName}. ${reminderIntro} ${reminderGuidance}`,
      accentColor: '#ff3b30',
      accentSoft: '#fff1f0',
      ctaLabel: 'Abrir escala',
    }),
  }
}

async function sendEmail(params: { to: string; subject: string; text: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL

  if (!apiKey || !from) {
    throw new Error('Configuração de e-mail ausente (RESEND_API_KEY / RESEND_FROM_EMAIL).')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    const retryAfterHeader = response.headers.get('retry-after')
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null
    const error = new Error(`Erro ao enviar e-mail: ${body}`) as Error & {
      status?: number
      retryAfterMs?: number | null
    }
    error.status = response.status
    error.retryAfterMs = Number.isFinite(retryAfterMs) ? retryAfterMs : null
    throw error
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendEmailWithRetry(params: { to: string; subject: string; text: string; html: string }) {
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await sendEmail(params)
      return
    } catch (err) {
      const error = err as Error & { status?: number; retryAfterMs?: number | null }
      const isRateLimit = error.status === 429
      const isLastAttempt = attempt === maxAttempts

      if (!isRateLimit || isLastAttempt) {
        throw err
      }

      const waitMs = error.retryAfterMs && error.retryAfterMs > 0
        ? error.retryAfterMs
        : attempt * 1000

      await sleep(waitMs)
    }
  }
}

function resolveNotificationRecipient(email: string) {
  const testRecipient = (process.env.SCHEDULE_EMAIL_TEST_RECIPIENT ?? '').trim()

  if (!testRecipient) {
    return email
  }

  return testRecipient
}

async function markQueueStatus(input: {
  id: string
  status: NotificationStatus
  attempts: number
  lastError: string | null
  sentAt?: string | null
}) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('schedule_email_notifications')
    .update({
      status: input.status,
      attempts: input.attempts,
      last_error: input.lastError,
      sent_at: input.sentAt ?? null,
    })
    .eq('id', input.id)

  if (error) throw new Error(error.message)
}

export async function processScheduleEmailQueue(batchSize = 50) {
  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .from('schedule_email_notifications')
    .select('id, notification_type, attempts, payload_json, status')
    .in('status', ['pending', 'failed'])
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (error) throw new Error(error.message)

  let sent = 0
  let failed = 0
  let skipped = 0
  let lastSendAt = 0

  for (const row of rows ?? []) {
    const payload = (row.payload_json ?? {}) as Record<string, unknown>
    const email = String(payload.minister_email ?? '').trim()
    const recipient = resolveNotificationRecipient(email)
    const attempts = Number(row.attempts ?? 0) + 1

    if (!email) {
      await markQueueStatus({
        id: row.id,
        status: 'skipped',
        attempts,
        lastError: 'Ministro sem e-mail cadastrado.',
      })
      skipped += 1
      continue
    }

    try {
      const template = buildEmailTemplate({
        notificationType: row.notification_type as NotificationType,
        payload,
      })

      const elapsedMs = Date.now() - lastSendAt
      const minIntervalMs = 600
      if (lastSendAt > 0 && elapsedMs < minIntervalMs) {
        await sleep(minIntervalMs - elapsedMs)
      }

      await sendEmailWithRetry({
        to: recipient,
        subject: template.subject,
        text: template.text,
        html: template.html,
      })
      lastSendAt = Date.now()

      await markQueueStatus({
        id: row.id,
        status: 'sent',
        attempts,
        lastError: null,
        sentAt: new Date().toISOString(),
      })
      sent += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido no envio.'
      await markQueueStatus({
        id: row.id,
        status: 'failed',
        attempts,
        lastError: message,
      })
      failed += 1
    }
  }

  return {
    processed: (rows ?? []).length,
    sent,
    failed,
    skipped,
  }
}
