import { createAdminClient } from '@/lib/supabase/admin'

type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped'
type NotificationType = 'quarter_published' | 'reminder_7days' | 'reminder_1day'

type QueueRow = {
  dedupe_key: string
  notification_type: NotificationType
  quarter_id: string | null
  minister_id: string
  event_date: string | null
  payload_json: Record<string, unknown>
}

type AssignmentWithRelations = {
  minister_id: string | null
  event_date: string
  event_type: 'thursday' | 'sunday'
  minister: { id: string; name: string; email: string | null; is_active: boolean } | null
  role: { name: string } | null
}

function formatEventType(eventType: 'thursday' | 'sunday') {
  return eventType === 'thursday' ? 'Quinta-feira' : 'Domingo'
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

function groupAssignmentsByMinister(assignments: AssignmentWithRelations[]) {
  const grouped = new Map<
    string,
    {
      minister_id: string
      minister_name: string
      minister_email: string | null
      items: Array<{ event_date: string; event_type: 'thursday' | 'sunday'; role_name: string }>
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

    grouped.get(row.minister_id)!.items.push({
      event_date: row.event_date,
      event_type: row.event_type,
      role_name: row.role?.name ?? 'Função',
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

export async function enqueueQuarterPublishedNotifications(input: {
  quarterId: string
  quarterName: string
}) {
  const admin = createAdminClient()

  const { data: assignments, error } = await admin
    .from('schedule_assignments')
    .select(
      'minister_id, event_date, event_type, minister:ministers(id, name, email, is_active), role:schedule_roles(name)'
    )
    .eq('quarter_id', input.quarterId)
    .not('minister_id', 'is', null)

  if (error) throw new Error(error.message)

  const grouped = groupAssignmentsByMinister((assignments ?? []) as AssignmentWithRelations[])
  if (grouped.length === 0) return { queued: 0 }

  const rows: QueueRow[] = grouped.map((g) => ({
    dedupe_key: `quarter_published:${input.quarterId}:${g.minister_id}`,
    notification_type: 'quarter_published',
    quarter_id: input.quarterId,
    minister_id: g.minister_id,
    event_date: null,
    status: 'pending',
    attempts: 0,
    last_error: null,
    sent_at: null,
    payload_json: {
      quarter_name: input.quarterName,
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

async function enqueueReminderNotifications(input: {
  targetDate: string
  notificationType: Extract<NotificationType, 'reminder_7days' | 'reminder_1day'>
}) {
  const admin = createAdminClient()

  const { data: publishedQuarter, error: quarterError } = await admin
    .from('schedule_quarters')
    .select('id, name')
    .eq('is_published', true)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (quarterError) throw new Error(quarterError.message)
  if (!publishedQuarter) return { queued: 0 }

  const { data: assignments, error } = await admin
    .from('schedule_assignments')
    .select(
      'minister_id, event_date, event_type, minister:ministers(id, name, email, is_active), role:schedule_roles(name)'
    )
    .eq('quarter_id', publishedQuarter.id)
    .eq('event_date', input.targetDate)
    .not('minister_id', 'is', null)

  if (error) throw new Error(error.message)

  const grouped = groupAssignmentsByMinister((assignments ?? []) as AssignmentWithRelations[])
  if (grouped.length === 0) return { queued: 0 }

  const rows: QueueRow[] = grouped.map((g) => ({
    dedupe_key: `${input.notificationType}:${g.minister_id}:${input.targetDate}`,
    notification_type: input.notificationType,
    quarter_id: publishedQuarter.id,
    minister_id: g.minister_id,
    event_date: input.targetDate,
    status: 'pending',
    attempts: 0,
    last_error: null,
    sent_at: null,
    payload_json: {
      quarter_name: publishedQuarter.name,
      minister_name: g.minister_name,
      minister_email: g.minister_email,
      target_date: input.targetDate,
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

export async function enqueueReminder7DaysNotifications(targetDate: string) {
  return enqueueReminderNotifications({
    targetDate,
    notificationType: 'reminder_7days',
  })
}

export async function enqueueReminder1DayNotifications(targetDate: string) {
  return enqueueReminderNotifications({
    targetDate,
    notificationType: 'reminder_1day',
  })
}

type EmailTemplateInput = {
  notificationType: NotificationType
  payload: Record<string, unknown>
}

function buildEmailTemplate(input: EmailTemplateInput) {
  const ministerName = String(input.payload.minister_name ?? 'Ministro(a)')
  const quarterName = String(input.payload.quarter_name ?? 'Escala')
  const items = Array.isArray(input.payload.items) ? input.payload.items : []
  const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '')
  const scheduleUrl = baseUrl ? `${baseUrl}/escala` : '/escala'

  const lines = items.map((item) => {
    const event = item as { event_date?: string; event_type?: 'thursday' | 'sunday'; role_name?: string }
    const eventDate = event.event_date ? toPtDate(event.event_date) : '-'
    const eventType = event.event_type ? formatEventType(event.event_type) : 'Culto'
    const roleName = event.role_name ?? 'Função'
    return `${eventDate} • ${eventType} • ${roleName}`
  })

  const itemCards = lines
    .map(
      (line) =>
        `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;background:#ffffff;margin-bottom:10px;font-size:14px;line-height:1.5;color:#111827;">${line}</div>`
    )
    .join('')

  const emailShell = (content: {
    eyebrow: string
    title: string
    message: string
    accentColor: string
    accentSoft: string
    ctaLabel: string
  }) => `
    <div style="margin:0;padding:32px 16px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(17,24,39,0.08);">
        <div style="padding:28px 28px 20px;background:${content.accentSoft};border-bottom:1px solid #e5e7eb;">
          <div style="display:inline-block;padding:6px 10px;border-radius:999px;background:#ffffff;color:${content.accentColor};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">
            ${content.eyebrow}
          </div>
          <h1 style="margin:16px 0 8px;font-size:26px;line-height:1.2;color:#111827;">${content.title}</h1>
          <p style="margin:0;font-size:15px;line-height:1.7;color:#4b5563;">${content.message}</p>
        </div>

        <div style="padding:24px 28px;">
          <div style="margin-bottom:16px;padding:14px 16px;border-radius:14px;background:#f9fafb;border:1px solid #e5e7eb;">
            <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
              <strong style="color:#111827;">Ministro:</strong> ${ministerName}
            </p>
          </div>

          <div style="margin-bottom:10px;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;">
            Detalhes da sua escala
          </div>

          <div style="margin-bottom:24px;">
            ${itemCards || '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;background:#ffffff;font-size:14px;color:#6b7280;">Nenhuma escala encontrada.</div>'}
          </div>

          <div style="text-align:center;margin-bottom:10px;">
            <a href="${scheduleUrl}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:${content.accentColor};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">
              ${content.ctaLabel}
            </a>
          </div>

          <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">
            Você está recebendo esta mensagem porque está escalado(a) no sistema Worship Flow.
          </p>
        </div>
      </div>
    </div>`

  if (input.notificationType === 'quarter_published') {
    return {
      subject: `Nova escala publicada - ${quarterName}`,
      text: [
        `Olá, ${ministerName}!`,
        '',
        `A escala trimestral "${quarterName}" foi publicada.`,
        '',
        'Suas escalas:',
        ...lines,
        '',
        `Acesse o sistema para mais detalhes: ${scheduleUrl}`,
      ].join('\n'),
      html: emailShell({
        eyebrow: 'Nova escala',
        title: `Sua escala do trimestre foi publicada`,
        message: `Olá, ${ministerName}. A escala trimestral "${quarterName}" já está disponível com todas as suas datas e funções.`,
        accentColor: '#2563eb',
        accentSoft: '#eff6ff',
        ctaLabel: 'Ver minha escala',
      }),
    }
  }

  const targetDate = String(input.payload.target_date ?? '')
  const isOneDayReminder = input.notificationType === 'reminder_1day'
  return {
    subject: isOneDayReminder
      ? `Lembrete: sua escala é amanhã (${targetDate})`
      : `Lembrete: sua escala é em 7 dias (${targetDate})`,
    text: [
      `Olá, ${ministerName}!`,
      '',
      isOneDayReminder
        ? `Sua escala acontece amanhã (${toPtDate(targetDate)}).`
        : `Sua próxima escala está próxima (${toPtDate(targetDate)}).`,
      isOneDayReminder
        ? 'Passe esta mensagem em revista e se organize para chegar preparado(a) para sua função.'
        : 'Não esqueça de ensaiar e se preparar para sua função.',
      '',
      'Detalhes:',
      ...lines,
      '',
      `Veja mais em: ${scheduleUrl}`,
    ].join('\n'),
    html: emailShell({
      eyebrow: isOneDayReminder ? 'Amanhã' : 'Lembrete',
      title: isOneDayReminder ? 'Sua escala é amanhã' : 'Sua escala está chegando',
      message: isOneDayReminder
        ? `Olá, ${ministerName}. Sua escala acontece amanhã, ${toPtDate(targetDate)}. Confira os detalhes e deixe tudo preparado para servir com tranquilidade.`
        : `Olá, ${ministerName}. Sua próxima escala acontece em breve, no dia ${toPtDate(targetDate)}. Reserve um tempo para ensaiar e se preparar com tranquilidade.`,
      accentColor: isOneDayReminder ? '#dc2626' : '#d97706',
      accentSoft: isOneDayReminder ? '#fef2f2' : '#fff7ed',
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
        to: email,
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
