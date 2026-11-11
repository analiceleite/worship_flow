'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { differenceInCalendarDays, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useIsMobile } from '@/hooks/use-mobile'
import { useToast } from '@/hooks/use-toast'
import { selectedChurchFetch } from '@/lib/auth/client-context'
import { useScheduleMutation } from '@/components/schedule/builder/use-schedule-mutation'
import { ROUTES } from '@/lib/routes'
import { getMediaCommitments, getScheduleTimeLabels, type ScheduleTimes } from '@/lib/schedule/media'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleGrid, type ScheduleAssignment, type ScheduleEventControl, type ScheduleRehearsal, type ScheduleRole } from '@/components/schedule/ScheduleGrid'
import { AlertCircle, BarChart3, MessageCircle, Music2, Settings2, UserCircle2 } from 'lucide-react'
import {
	buildPublishedScheduleWhatsAppMessage,
	openScheduleWhatsAppShare,
} from '@/lib/schedule-whatsapp'

type EventType = 'thursday' | 'sunday'

interface Commitment {
	date: string
	eventType: EventType
	roles: Array<{ id: string; name: string; isTrainee: boolean }>
}

type RehearsalState = 'loading' | 'error' | 'ready'

function formatFullDate(dateStr: string) {
	return format(new Date(`${dateStr}T12:00:00`), "EEEE, dd 'de' MMMM", { locale: ptBR })
}

function formatShortDate(dateStr: string) {
	return format(new Date(`${dateStr}T12:00:00`), 'EEE, dd/MM', { locale: ptBR })
}

function daysLabel(dateStr: string, now: Date) {
	const diff = differenceInCalendarDays(new Date(`${dateStr}T12:00:00`), now)
	if (diff === 0) return 'Hoje'
	if (diff === 1) return 'Amanhã'
	return `Em ${diff} dias`
}

interface BimesterSummary extends ScheduleTimes {
	id: string
	name: string
	start_date: string
	end_date: string
	is_published: boolean
	created_at: string
}

interface CurrentScheduleApiResponse {
	schedule: {
		quarter: BimesterSummary
		roles: ScheduleRole[]
		assignments: ScheduleAssignment[]
		event_controls: ScheduleEventControl[]
		dates: {
			sunday: string[]
			thursday: string[]
		}
	} | null
	viewer: {
		id: string
		name: string
		role: 'admin' | 'minister' | 'midia'
	} | null
}

interface CurrentSchedule {
	bimester: BimesterSummary
	roles: ScheduleRole[]
	assignments: ScheduleAssignment[]
	event_controls: ScheduleEventControl[]
	dates: {
		sunday: string[]
		thursday: string[]
	}
}

function formatRange(startDate: string, endDate: string) {
	const start = new Date(`${startDate}T12:00:00`)
	const end = new Date(`${endDate}T12:00:00`)

	const startText = start.toLocaleDateString('pt-BR', {
		day: '2-digit',
		month: 'long',
		year: 'numeric',
	})

	const endText = end.toLocaleDateString('pt-BR', {
		day: '2-digit',
		month: 'long',
		year: 'numeric',
	})

	return `${startText} a ${endText}`
}

function formatRehearsalSummary(rehearsal?: ScheduleRehearsal) {
	if (!rehearsal) return null

	const parts: string[] = []

	if (rehearsal.rehearsal_date) {
		parts.push(format(new Date(`${rehearsal.rehearsal_date}T12:00:00`), 'dd/MM', { locale: ptBR }))
	}

	if (rehearsal.rehearsal_time) {
		parts.push(rehearsal.rehearsal_time.slice(0, 5))
	}

	if (rehearsal.rehearsal_place) {
		parts.push(rehearsal.rehearsal_place)
	}

	return parts.length ? parts.join(' • ') : null
}

function CommitmentCard({
	commitment,
	bimester,
	rehearsal,
	rehearsalState,
	hero,
	now,
}: {
	commitment: Commitment
	bimester: BimesterSummary
	rehearsal?: ScheduleRehearsal
	rehearsalState: RehearsalState
	hero: boolean
	now: Date
}) {
	const times = getScheduleTimeLabels(commitment.eventType, bimester)
	const rehearsalSummary = formatRehearsalSummary(rehearsal)

	return (
		<Card className={hero ? 'border-primary/40 bg-primary/5' : undefined}>
			<CardContent className={hero ? 'space-y-4 p-5' : 'space-y-2 p-4'}>
				<div className="flex items-center justify-between gap-2">
					<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						{hero ? 'Próximo compromisso' : commitment.eventType === 'thursday' ? 'Quinta' : 'Domingo'}
					</p>
					<Badge variant={hero ? 'default' : 'outline'}>{daysLabel(commitment.date, now)}</Badge>
				</div>

				<p className={hero ? 'text-xl font-bold capitalize text-foreground' : 'text-sm font-semibold capitalize text-foreground'}>
					{hero ? formatFullDate(commitment.date) : formatShortDate(commitment.date)}
				</p>

				<ul className="space-y-1.5">
					{commitment.roles.map(role => (
						<li key={role.id} className="flex items-center gap-2 text-sm text-foreground">
							<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
							{role.name}
							{role.isTrainee ? <span className="text-muted-foreground">(Aprendiz)</span> : null}
						</li>
					))}
				</ul>

				<p className="text-sm text-muted-foreground">
					Chegada: {times.arrival ?? 'não informada'} · Início do culto: {times.service ?? 'não informado'}
				</p>

				{rehearsalState === 'ready' && (
					<p className="text-sm text-muted-foreground">
						<span className="font-medium text-foreground">Ensaio:</span> {rehearsalSummary ?? 'informações não cadastradas'}
					</p>
				)}
			</CardContent>
		</Card>
	)
}

export default function EscalaPage() {
	const { toast } = useToast()
	const { request: scheduleMutationFetch, conflictDialog } = useScheduleMutation()
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [schedule, setSchedule] = useState<CurrentSchedule | null>(null)
	const [viewer, setViewer] = useState<CurrentScheduleApiResponse['viewer']>(null)
	const [rehearsalByDate, setRehearsalByDate] = useState<Record<string, ScheduleRehearsal>>({})
	const [rehearsalError, setRehearsalError] = useState<string | null>(null)
	const [rehearsalLoading, setRehearsalLoading] = useState(false)
	const [rehearsalAttempt, setRehearsalAttempt] = useState(0)
	const [generalType, setGeneralType] = useState<EventType>('thursday')
	const [onlyMine, setOnlyMine] = useState(false)
	const scheduleRequest = useRef<AbortController | null>(null)
	const isMobile = useIsMobile()

	const loadSchedule = useCallback(async () => {
		scheduleRequest.current?.abort()
		const controller = new AbortController()
		scheduleRequest.current = controller
		setLoading(true)
		setSchedule(null)
		setViewer(null)
		setRehearsalByDate({})
		try {
			setError(null)
			const response = await selectedChurchFetch('/api/schedule/current', { signal: controller.signal })
			const body = (await response.json()) as CurrentScheduleApiResponse & { error?: string }
			if (controller.signal.aborted) return

			if (!response.ok) {
				throw new Error(body.error || 'Não foi possível carregar a escala')
			}

			setSchedule(
				body.schedule
					? {
						bimester: body.schedule.quarter,
						roles: body.schedule.roles,
						assignments: body.schedule.assignments,
						event_controls: body.schedule.event_controls ?? [],
						dates: body.schedule.dates,
					}
					: null
			)
			setViewer(body.viewer)
		} catch (err) {
			if (controller.signal.aborted) return
			setError(err instanceof Error ? err.message : 'Erro ao carregar escala')
		} finally {
			if (!controller.signal.aborted) setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadSchedule()
		return () => scheduleRequest.current?.abort()
	}, [loadSchedule])

	useEffect(() => {
		const controller = new AbortController()
		setRehearsalByDate({})
		setRehearsalError(null)
		setRehearsalLoading(Boolean(schedule?.bimester.id))
		const loadRehearsals = async () => {
			if (!schedule?.bimester.id) {
				setRehearsalByDate({})
				return
			}

			try {
				const response = await selectedChurchFetch(`/api/schedule/rehearsal?quarter_id=${schedule.bimester.id}`, {
					signal: controller.signal,
				})
				const body = (await response.json()) as { rehearsals?: ScheduleRehearsal[]; error?: string }
				if (controller.signal.aborted) return

				if (!response.ok) {
					throw new Error(body.error || 'Erro ao carregar ensaios')
				}

				const byDate = Object.fromEntries(
					(body.rehearsals ?? []).map((item) => [`${item.event_date}_${item.event_type}`, item])
				)
				setRehearsalByDate(byDate)
			} catch {
				if (!controller.signal.aborted) setRehearsalError('Não foi possível carregar as informações de ensaio.')
			} finally {
				if (!controller.signal.aborted) setRehearsalLoading(false)
			}
		}

		loadRehearsals()
		return () => controller.abort()
	}, [schedule?.bimester.id, rehearsalAttempt])

	const isAdmin = viewer?.role === 'admin'
	const isMedia = viewer?.role === 'midia'
	const canEditRehearsal = useCallback((eventDate: string, eventType: EventType) => {
		const control = schedule?.event_controls.find(item => item.event_date === eventDate && item.event_type === eventType)
		if (control?.status === 'cancelled') return false
		if (viewer?.role === 'admin') return true
		return Boolean(viewer && control?.leader_minister_id === viewer.id)
	}, [schedule?.event_controls, viewer])
	const now = new Date()
	const today = format(now, 'yyyy-MM-dd')
	const rehearsalState: RehearsalState = rehearsalLoading ? 'loading' : rehearsalError ? 'error' : 'ready'

	const mediaCommitments = useMemo(
		() => getMediaCommitments(schedule?.assignments ?? [], schedule?.roles ?? [], viewer?.id ?? '', today),
		[schedule, viewer?.id, today],
	)

	// Próximas escalas do ministro (não-mídia), agrupadas por culto, da mais próxima para a mais distante.
	const viewerCommitments = useMemo<Commitment[]>(() => {
		if (!schedule || !viewer?.id) return []
		const slots = new Map<string, Commitment>()
		for (const a of schedule.assignments) {
			if (a.minister_id !== viewer.id) continue
			if (a.event_date < today) continue
			const role = schedule.roles.find((r) => r.id === a.role_id)
			if (!role) continue
			const eventType = a.event_type as EventType
			const key = `${a.event_date}_${eventType}`
			if (!slots.has(key)) slots.set(key, { date: a.event_date, eventType, roles: [] })
			slots.get(key)!.roles.push({ id: role.id, name: role.name, isTrainee: a.is_trainee })
		}
		return [...slots.values()].sort((x, y) => x.date.localeCompare(y.date) || x.eventType.localeCompare(y.eventType))
	}, [schedule, viewer?.id, today])

	// Mídia já usa a regra própria de compromissos; os demais usam o agrupamento acima.
	const commitments = useMemo<Commitment[]>(() => {
		if (!isMedia) return viewerCommitments
		return mediaCommitments.upcoming.map(item => ({
			date: item.date,
			eventType: item.eventType as EventType,
			roles: item.roles.map(role => ({ id: role.id, name: role.name, isTrainee: role.isTrainee })),
		}))
	}, [isMedia, viewerCommitments, mediaCommitments])

	const assignedCount = useMemo(() => {
		if (!schedule || !viewer?.id) return 0
		return schedule.assignments.filter((item) => item.minister_id === viewer.id).length
	}, [schedule, viewer?.id])

	const mySlotKeys = useMemo(() => {
		if (!schedule || !viewer?.id) return new Set<string>()
		return new Set(
			schedule.assignments
				.filter((item) => item.minister_id === viewer.id)
				.map((item) => `${item.event_date}_${item.event_type}`),
		)
	}, [schedule, viewer?.id])

	const generalDates = useMemo(() => {
		if (!schedule) {
			return { thursday: [], sunday: [] as string[] }
		}

		if (!isMobile) {
			return {
				thursday: schedule.dates.thursday,
				sunday: schedule.dates.sunday,
			}
		}

		const todayStart = new Date()
		todayStart.setHours(0, 0, 0, 0)

		const filterCurrentAndFutureDates = (dates: string[]) =>
			dates.filter((date) => {
				const parsed = new Date(`${date}T12:00:00`)
				parsed.setHours(0, 0, 0, 0)
				return parsed >= todayStart
			})

		return {
			thursday: filterCurrentAndFutureDates(schedule.dates.thursday),
			sunday: filterCurrentAndFutureDates(schedule.dates.sunday),
		}
	}, [isMobile, schedule])

	const generalShownDates = generalDates[generalType].filter(
		(date) => !onlyMine || mySlotKeys.has(`${date}_${generalType}`),
	)
	const generalLabel = generalType === 'thursday' ? 'quinta-feira' : 'domingo'

	const handleShareWhatsApp = useCallback(() => {
		if (!schedule) return

		const message = buildPublishedScheduleWhatsAppMessage({
			bimesterName: schedule.bimester.name,
			roles: schedule.roles,
			assignments: schedule.assignments,
			dates: schedule.dates,
		})

		if (!message) {
			toast({
				title: 'Não foi possível montar a mensagem',
				description: 'Verifique se há datas e o papel de ministro na escala.',
				variant: 'destructive',
			})
			return
		}

		openScheduleWhatsAppShare(message)
	}, [schedule, toast])

	const handleSaveRehearsal = useCallback(async (payload: {
		eventDate: string
		eventType: EventType
		rehearsalDate: string | null
		rehearsalTime: string | null
		rehearsalPlace: string | null
	}) => {
		if (!schedule) return

		const response = await scheduleMutationFetch('/api/schedule/rehearsal', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				quarter_id: schedule.bimester.id,
				event_date: payload.eventDate,
				event_type: payload.eventType,
				rehearsal_date: payload.rehearsalDate,
				rehearsal_time: payload.rehearsalTime,
				rehearsal_place: payload.rehearsalPlace,
			}),
		}, viewer?.role === 'admin')

		const body = (await response.json()) as {
			rehearsal?: ScheduleRehearsal; error?: string; notification_error?: string
			notification?: { failed: number }; calendar_sync?: { errors: unknown[] }
		}
		if (!response.ok || !body.rehearsal) {
			const message = body.error || 'Não foi possível salvar o ensaio'
			toast({
				variant: 'destructive',
				title: 'Falha ao salvar ensaio',
				description: message,
			})
			throw new Error(message)
		}

		setRehearsalByDate((current) => ({
			...current,
			[`${body.rehearsal!.event_date}_${body.rehearsal!.event_type}`]: body.rehearsal!,
		}))

		const warnings = [body.notification_error,
			body.notification?.failed ? 'Um ou mais avisos requerem nova tentativa ou conferência administrativa.' : null,
			body.calendar_sync?.errors?.length ? 'Houve falha ao sincronizar o calendário.' : null].filter(Boolean)
		toast({
			variant: warnings.length ? 'destructive' : 'default', title: 'Ensaio atualizado',
			description: warnings.join(' ') || 'As informações já estão visíveis para toda a equipe.',
		})
	}, [schedule, toast, viewer?.role, scheduleMutationFetch])

	const [nextCommitment, ...laterCommitments] = commitments

	return (
		<div className="bg-background">
			{conflictDialog}

			<main className="mx-auto px-4 py-6 sm:px-6 lg:px-8">
				<div className="mb-6">
					<h1 className="text-2xl font-bold text-foreground">Escala de Louvor</h1>
					<p className="text-sm text-muted-foreground">
						Veja quando você toca e a escala de toda a equipe.
					</p>
				</div>

				{error && (
					<Alert variant="destructive" className="mb-6">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>
							{error}
							<Button variant="outline" className="ml-2" onClick={() => loadSchedule()}>Tentar novamente</Button>
						</AlertDescription>
					</Alert>
				)}

				{loading ? (
					<div role="status" className="flex flex-col items-center justify-center gap-3 py-20">
						<Spinner className="h-7 w-7" />
						<p className="text-sm text-muted-foreground">Carregando escala...</p>
					</div>
				) : error ? null : !schedule ? (
					<Card>
						<CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
							<div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
								<Music2 className="h-6 w-6" />
							</div>
							<div className="space-y-1">
								<p className="text-sm font-medium text-foreground">Nenhuma escala publicada</p>
								<p className="text-xs text-muted-foreground">
									{isAdmin
										? 'Publique um bimestre no builder para exibir aqui.'
										: 'O admin ainda não publicou a escala. Volte em breve.'}
								</p>
							</div>
						</CardContent>
					</Card>
				) : (
					<div className="space-y-4">
						<Card>
							<CardHeader className="pb-3 py-4">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<CardTitle className="text-base">{schedule.bimester.name}</CardTitle>
										<CardDescription>
											{formatRange(schedule.bimester.start_date, schedule.bimester.end_date)}
										</CardDescription>
									</div>

									<div className="flex flex-wrap items-center gap-2">
										<Badge>Publicado</Badge>
										<Badge variant="outline" className="p-1">
											{commitments.length === 0
												? 'Sem escalas futuras para você'
												: `${commitments.length} ${commitments.length === 1 ? 'escala futura' : 'escalas futuras'} para você`}
										</Badge>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="h-8 gap-1.5"
											onClick={handleShareWhatsApp}
										>
											<MessageCircle className="h-4 w-4 text-[#25D366]" />
											Enviar no WhatsApp
										</Button>
									</div>
								</div>
							</CardHeader>
						</Card>

						{rehearsalLoading && <p role="status" className="text-sm text-muted-foreground">Carregando informações de ensaio...</p>}
						{rehearsalError && (
							<Alert variant="destructive">
								<AlertCircle className="h-4 w-4" />
								<AlertDescription>
									{rehearsalError}
									<Button variant="outline" className="ml-2" onClick={() => setRehearsalAttempt(value => value + 1)}>Tentar carregar ensaios novamente</Button>
								</AlertDescription>
							</Alert>
						)}

						<Tabs defaultValue="mine" className="w-full">
							<TabsList>
								<TabsTrigger value="mine">{isMedia ? 'Meus compromissos' : 'Minha Escala'}</TabsTrigger>
								<TabsTrigger value="all">Escala Geral</TabsTrigger>
							</TabsList>

							{/* ── Minha Escala ───────────────────────────────── */}
							<TabsContent value="mine" className="mt-3 space-y-4">
								{!nextCommitment ? (
									<Card>
										<CardContent className="flex flex-col items-center gap-3 py-16 text-center">
											<div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
												<UserCircle2 className="h-6 w-6" />
											</div>
											<div className="space-y-1">
												<p className="text-sm font-medium text-foreground">
													{(isMedia ? mediaCommitments.total : assignedCount) === 0
														? 'Você não está escalado neste bimestre publicado.'
														: 'Você não tem escalas futuras neste bimestre.'}
												</p>
												<p className="text-xs text-muted-foreground">
													Consulte a aba Escala Geral para ver a equipe em cada data.
												</p>
											</div>
										</CardContent>
									</Card>
								) : (
									<>
										<CommitmentCard
											commitment={nextCommitment}
											bimester={schedule.bimester}
											rehearsal={rehearsalByDate[`${nextCommitment.date}_${nextCommitment.eventType}`]}
											rehearsalState={rehearsalState}
											hero
											now={now}
										/>

										{laterCommitments.length > 0 && (
											<section className="space-y-2">
												<h2 className="text-sm font-semibold text-foreground">Próximas datas</h2>
												{laterCommitments.map(commitment => (
													<CommitmentCard
														key={`${commitment.date}_${commitment.eventType}`}
														commitment={commitment}
														bimester={schedule.bimester}
														rehearsal={rehearsalByDate[`${commitment.date}_${commitment.eventType}`]}
														rehearsalState={rehearsalState}
														hero={false}
														now={now}
													/>
												))}
											</section>
										)}
									</>
								)}
							</TabsContent>

							{/* ── Escala Geral ───────────────────────────────── */}
							<TabsContent value="all" className="mt-3 space-y-3">
								{isMobile && <p className="text-sm text-muted-foreground">No celular, a escala geral mostra as datas de hoje em diante.</p>}

								<div className="flex flex-wrap items-center gap-2">
									<div role="group" aria-label="Tipo de culto" className="inline-flex gap-1 rounded-md border border-border p-1">
										<Button
											type="button"
											size="sm"
											variant={generalType === 'thursday' ? 'default' : 'ghost'}
											aria-pressed={generalType === 'thursday'}
											onClick={() => setGeneralType('thursday')}
										>
											Quintas
										</Button>
										<Button
											type="button"
											size="sm"
											variant={generalType === 'sunday' ? 'default' : 'ghost'}
											aria-pressed={generalType === 'sunday'}
											onClick={() => setGeneralType('sunday')}
										>
											Domingos
										</Button>
									</div>
									<Button
										type="button"
										size="sm"
										variant={onlyMine ? 'default' : 'outline'}
										aria-pressed={onlyMine}
										onClick={() => setOnlyMine(value => !value)}
									>
										Só minhas datas
									</Button>
								</div>

								{generalShownDates.length === 0 ? (
									<Card>
										<CardContent className="py-12 text-center text-sm text-muted-foreground">
											{onlyMine
												? `Você não toca em nenhum ${generalLabel} ${isMobile ? 'a partir de hoje' : 'neste bimestre'}.`
												: isMobile
													? `Não há escalas atuais de ${generalLabel} para mostrar no celular.`
													: `O bimestre publicado não possui datas de ${generalLabel}.`}
										</CardContent>
									</Card>
								) : (
									<ScheduleGrid
										roles={schedule.roles}
										dates={generalShownDates}
										eventType={generalType}
										assignments={schedule.assignments}
										eventControls={schedule.event_controls}
										readOnly
										highlightedMinisterId={viewer?.id ?? null}
										rehearsalByDate={rehearsalByDate}
										rehearsalStatus={rehearsalState}
										canEditRehearsal={canEditRehearsal}
										onSaveRehearsal={handleSaveRehearsal}
									/>
								)}
							</TabsContent>
						</Tabs>
					</div>
				)}

				{isAdmin && (
					<Card className="mt-8">
						<CardHeader className="py-4">
							<CardTitle className="text-base">Gerenciar Escala</CardTitle>
							<CardDescription>
								Crie bimestres, preencha o builder e publique para liberar esta visualização.
							</CardDescription>
							<div className="flex flex-wrap gap-2 pt-2">
								<Button asChild size="sm" variant="outline">
									<Link href={ROUTES.SCHEDULE_ADMIN_DASHBOARD}>
										<BarChart3 className="mr-2 h-3.5 w-3.5" />
										Dashboard
									</Link>
								</Button>
								<Button asChild size="sm" variant="outline">
									<Link href={ROUTES.SCHEDULE_ADMIN_QUARTERS}>
										<Settings2 className="mr-2 h-3.5 w-3.5" />
										Bimestres
									</Link>
								</Button>
								<Button asChild size="sm" variant="outline">
									<Link href={ROUTES.SCHEDULE_ADMIN_BUILDER}>
										<Settings2 className="mr-2 h-3.5 w-3.5" />
										Abrir Builder
									</Link>
								</Button>
							</div>
						</CardHeader>
					</Card>
				)}
			</main>
		</div>
	)
}
