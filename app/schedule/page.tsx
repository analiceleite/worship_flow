'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, getISOWeek, getISOWeekYear } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useIsMobile } from '@/hooks/use-mobile'
import { useToast } from '@/hooks/use-toast'
import { ROUTES } from '@/lib/routes'
import { getMediaCommitments, getScheduleTimeLabels, type ScheduleTimes } from '@/lib/schedule/media'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleGrid, type ScheduleAssignment, type ScheduleRehearsal, type ScheduleRole } from '@/components/schedule/ScheduleGrid'
import { AlertCircle, BarChart3, MessageCircle, Music2, Settings2, UserCircle2 } from 'lucide-react'
import {
	buildPublishedScheduleWhatsAppMessage,
	openScheduleWhatsAppShare,
} from '@/lib/schedule-whatsapp'

function formatWeekTag(dateStr: string) {
	return `S${getISOWeek(new Date(`${dateStr}T12:00:00`))}`
}

function formatFullDate(dateStr: string) {
	return format(new Date(`${dateStr}T12:00:00`), "EEEE, dd 'de' MMMM", { locale: ptBR })
}

function isoWeekKey(dateStr: string) {
	const date = new Date(`${dateStr}T12:00:00`)
	return `${getISOWeekYear(date)}-${String(getISOWeek(date)).padStart(2, '0')}`
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

export default function EscalaPage() {
	const { toast } = useToast()
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [schedule, setSchedule] = useState<CurrentSchedule | null>(null)
	const [viewer, setViewer] = useState<CurrentScheduleApiResponse['viewer']>(null)
	const [rehearsalByDate, setRehearsalByDate] = useState<Record<string, ScheduleRehearsal>>({})
	const [rehearsalError, setRehearsalError] = useState<string | null>(null)
	const [rehearsalLoading, setRehearsalLoading] = useState(false)
	const [rehearsalAttempt, setRehearsalAttempt] = useState(0)
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
			const response = await fetch('/api/schedule/current', { cache: 'no-store', signal: controller.signal })
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
				const response = await fetch(`/api/schedule/rehearsal?quarter_id=${schedule.bimester.id}`, {
					cache: 'no-store',
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
	const canEditRehearsal = viewer?.role === 'admin' || viewer?.role === 'minister'
	const today = format(new Date(), 'yyyy-MM-dd')
	const mediaCommitments = useMemo(
		() => getMediaCommitments(schedule?.assignments ?? [], schedule?.roles ?? [], viewer?.id ?? '', today),
		[schedule, viewer?.id, today],
	)

	const assignedCount = useMemo(() => {
		if (!schedule || !viewer?.id) return 0
		return schedule.assignments.filter((item) => item.minister_id === viewer.id).length
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

		const today = new Date()
		today.setHours(0, 0, 0, 0)

		const filterCurrentAndFutureDates = (dates: string[]) =>
			dates.filter((date) => {
				const parsed = new Date(`${date}T12:00:00`)
				parsed.setHours(0, 0, 0, 0)
				return parsed >= today
			})

		return {
			thursday: filterCurrentAndFutureDates(schedule.dates.thursday),
			sunday: filterCurrentAndFutureDates(schedule.dates.sunday),
		}
	}, [isMobile, schedule])

	const weekPairs = useMemo(() => {
		if (!schedule || !viewer?.id) return []

		const weekMap = new Map<string, { thursday: string | null; sunday: string | null }>()
		for (const date of schedule.dates.thursday) {
			const week = isoWeekKey(date)
			if (!weekMap.has(week)) weekMap.set(week, { thursday: null, sunday: null })
			weekMap.get(week)!.thursday = date
		}
		for (const date of schedule.dates.sunday) {
			const week = isoWeekKey(date)
			if (!weekMap.has(week)) weekMap.set(week, { thursday: null, sunday: null })
			weekMap.get(week)!.sunday = date
		}

		const myRolesBySlot = new Map<string, Array<{ role: ScheduleRole; isTrainee: boolean }>>()
		for (const a of schedule.assignments) {
			if (a.minister_id !== viewer.id) continue
			const slotKey = `${a.event_date}_${a.event_type}`
			if (!myRolesBySlot.has(slotKey)) myRolesBySlot.set(slotKey, [])
			const role = schedule.roles.find((r) => r.id === a.role_id)
			if (role) myRolesBySlot.get(slotKey)!.push({ role, isTrainee: a.is_trainee })
		}

		const today = new Date()
		today.setHours(0, 0, 0, 0)
		const currentISOWeek = getISOWeek(today)
		const currentYear = getISOWeekYear(today)

		return Array.from(weekMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([weekKey, { thursday, sunday }]) => {
				const week = Number(weekKey.split('-')[1])
				const latestDateStr = sunday ?? thursday!
				const latestDate = new Date(`${latestDateStr}T12:00:00`)
				const weekYear = getISOWeekYear(latestDate)
				const isPast = latestDate < today
				const isCurrentWeek = week === currentISOWeek && weekYear === currentYear
				return {
					weekKey,
					week,
					thursday,
					sunday,
					// null = date doesn't exist; [] = date exists but user not assigned
					thursdayRoles: thursday ? (myRolesBySlot.get(`${thursday}_thursday`) ?? []) : null,
					sundayRoles: sunday ? (myRolesBySlot.get(`${sunday}_sunday`) ?? []) : null,
					isCurrentWeek,
					isPast,
				}
			})
			.filter(({ isPast }) => !isPast)
	}, [schedule, viewer?.id])

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
		eventType: 'thursday' | 'sunday'
		rehearsalDate: string | null
		rehearsalTime: string | null
		rehearsalPlace: string | null
	}) => {
		if (!schedule) return

		const response = await fetch('/api/schedule/rehearsal', {
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
		})

		const body = (await response.json()) as { rehearsal?: ScheduleRehearsal; error?: string }
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

		toast({
			title: 'Ensaio atualizado',
			description: 'As informações já estão visíveis para toda a equipe.',
		})
	}, [schedule, toast])

	return (
		<div className="min-h-screen bg-background">

			<main className="mx-auto px-4 py-6 sm:px-6 lg:px-8">
				<div className="mb-6">
					<h1 className="text-2xl font-bold text-foreground">Escala de Louvor</h1>
					<p className="text-sm text-muted-foreground">
						Visualização da escala publicada. Suas células aparecem destacadas.
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

				{isAdmin && (
					<Card className="mb-6">
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
											{assignedCount} {assignedCount === 1 ? 'atribuição' : 'atribuições'} para você.
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
							<TabsContent value="mine" className="mt-3">
								{isMedia ? (
									<div className="space-y-3">
										<p className="text-sm text-muted-foreground">Seus compromissos de hoje em diante. Consulte também a aba Escala Geral.</p>
										{mediaCommitments.upcoming.length === 0 ? (
											<Card>
												<CardContent className="py-10 text-center text-sm">
													{mediaCommitments.total === 0
														? 'Você não possui atribuições neste período publicado.'
														: 'Você não possui próximos compromissos neste período publicado.'}
												</CardContent>
											</Card>
										) : mediaCommitments.upcoming.map(commitment => {
											const times = getScheduleTimeLabels(commitment.eventType, schedule.bimester)
											const rehearsal = rehearsalByDate[`${commitment.date}_${commitment.eventType}`]
											return (
												<Card key={`${commitment.date}_${commitment.eventType}`}>
													<CardHeader className="pb-2">
														<CardTitle className="text-base">{formatFullDate(commitment.date)}</CardTitle>
													</CardHeader>
													<CardContent className="space-y-2 text-sm">
														<ul>
															{commitment.roles.map(role => (
																<li key={role.id}>{role.name}{role.isTrainee ? ' (Aprendiz)' : ''}</li>
															))}
														</ul>
														<p>Chegada: {times.arrival ?? 'não informada'} · Início do culto: {times.service ?? 'não informado'}</p>
														{!rehearsalLoading && !rehearsalError && <p>Ensaio: {formatRehearsalSummary(rehearsal) ?? 'informações não cadastradas'}</p>}
													</CardContent>
												</Card>
											)
										})}
									</div>
								) : weekPairs.length === 0 ? (
									<Card>
										<CardContent className="flex flex-col items-center gap-3 py-16 text-center">
											<div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
												<UserCircle2 className="h-6 w-6" />
											</div>
											<div className="space-y-1">
												<p className="text-sm font-medium text-foreground">Nenhuma próxima data neste período publicado</p>
												<p className="text-xs text-muted-foreground">
													Consulte a aba Escala Geral para ver as datas disponíveis.
												</p>
											</div>
										</CardContent>
									</Card>
								) : (
									<div className="space-y-3">
										{weekPairs.map(({ weekKey, week, thursday, sunday, thursdayRoles, sundayRoles, isCurrentWeek }) => (
											<Card key={weekKey}>
												<CardContent className="p-3">
													{/* Week tag */}
													<div className="mb-2.5 flex items-center gap-1.5">
														<span className="inline-flex rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
															S{week}
														</span>
														{isCurrentWeek && (
															<span className="inline-flex rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
																Semana atual
															</span>
														)}
													</div>

													{/* Two columns */}
													<div className="grid grid-cols-2 gap-2">
														{/* Thursday */}
														{thursday ? (
															(() => {
																const rehearsalSummary = formatRehearsalSummary(rehearsalByDate[`${thursday}_thursday`])
																return (
																	<div
																		className={[
																			'rounded-lg border p-3',
																			thursdayRoles && thursdayRoles.length > 0
																				? 'border-primary/30 bg-primary/5'
																				: 'border-border bg-muted/20',
																		].join(' ')}
																	>
																		<p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Quinta</p>
																		<p className="mb-2 text-xs text-foreground">
																			{format(new Date(`${thursday}T12:00:00`), 'dd/MM')}
																		</p>
																		{rehearsalSummary && (
																			<p className="mb-2 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
																				<span className="font-medium text-foreground">Ensaio:</span> {rehearsalSummary}
																			</p>
																		)}
																		{thursdayRoles && thursdayRoles.length > 0 ? (
																			<div className="space-y-1">
																				{thursdayRoles.map(({ role, isTrainee }) => (
																					<div key={role.id} className="flex items-center gap-1.5">
																						<div className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
																						<span className="text-xs font-medium text-foreground">
																							{role.name}
																							{isTrainee ? ' (Aprendiz)' : ''}
																						</span>
																					</div>
																				))}
																			</div>
																		) : (
																			<p className="text-[11px] italic text-muted-foreground">Você não toca nessa escala</p>
																		)}
																	</div>
																)
															})()
														) : (
															<div className="rounded-lg border border-dashed border-border/50 p-3 opacity-40">
																<p className="text-[10px] text-muted-foreground">Sem quinta nessa semana</p>
															</div>
														)}

														{/* Sunday */}
														{sunday ? (
															(() => {
																const rehearsalSummary = formatRehearsalSummary(rehearsalByDate[`${sunday}_sunday`])
																return (
																	<div
																		className={[
																			'rounded-lg border p-3',
																			sundayRoles && sundayRoles.length > 0
																				? 'border-primary/30 bg-primary/5'
																				: 'border-border bg-muted/20',
																		].join(' ')}
																	>
																		<p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Domingo</p>
																		<p className="mb-2 text-xs text-foreground">
																			{format(new Date(`${sunday}T12:00:00`), 'dd/MM')}
																		</p>
																		{rehearsalSummary && (
																			<p className="mb-2 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
																				<span className="font-medium text-foreground">Ensaio:</span> {rehearsalSummary}
																			</p>
																		)}
																		{sundayRoles && sundayRoles.length > 0 ? (
																			<div className="space-y-1">
																				{sundayRoles.map(({ role, isTrainee }) => (
																					<div key={role.id} className="flex items-center gap-1.5">
																						<div className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
																						<span className="text-xs font-medium text-foreground">
																							{role.name}
																							{isTrainee ? ' (Aprendiz)' : ''}
																						</span>
																					</div>
																				))}
																			</div>
																		) : (
																			<p className="text-[11px] italic text-muted-foreground">Você não toca nessa escala</p>
																		)}
																	</div>
																)
															})()
														) : (
															<div className="rounded-lg border border-dashed border-border/50 p-3 opacity-40">
																<p className="text-[10px] text-muted-foreground">Sem domingo nessa semana</p>
															</div>
														)}
													</div>
												</CardContent>
											</Card>
										))}
									</div>
								)}
							</TabsContent>

							{/* ── Escala Geral ───────────────────────────────── */}
							<TabsContent value="all" className="mt-3">
								{isMobile && <p className="mb-3 text-sm text-muted-foreground">No celular, a escala geral mostra as datas de hoje em diante.</p>}
								<Tabs defaultValue="thursday" className="w-full">
									<TabsList>
										<TabsTrigger value="thursday">Quintas</TabsTrigger>
										<TabsTrigger value="sunday">Domingos</TabsTrigger>
									</TabsList>

									<TabsContent value="thursday" className="mt-3">
										{generalDates.thursday.length === 0 ? (
											<Card>
												<CardContent className="py-12 text-center text-sm text-muted-foreground">
													{isMobile
														? 'Não há escalas atuais de quinta-feira para mostrar no celular.'
														: 'O bimestre publicado não possui datas de quinta-feira.'}
												</CardContent>
											</Card>
										) : (
											<ScheduleGrid
												roles={schedule.roles}
												dates={generalDates.thursday}
												eventType="thursday"
												assignments={schedule.assignments}
												readOnly
												highlightedMinisterId={viewer?.id ?? null}
												rehearsalByDate={rehearsalByDate}
												rehearsalStatus={rehearsalLoading ? 'loading' : rehearsalError ? 'error' : 'ready'}
												canEditRehearsal={canEditRehearsal}
												onSaveRehearsal={handleSaveRehearsal}
											/>
										)}
									</TabsContent>

									<TabsContent value="sunday" className="mt-3">
										{generalDates.sunday.length === 0 ? (
											<Card>
												<CardContent className="py-12 text-center text-sm text-muted-foreground">
													{isMobile
														? 'Não há escalas atuais de domingo para mostrar no celular.'
														: 'O bimestre publicado não possui datas de domingo.'}
												</CardContent>
											</Card>
										) : (
											<ScheduleGrid
												roles={schedule.roles}
												dates={generalDates.sunday}
												eventType="sunday"
												assignments={schedule.assignments}
												readOnly
												highlightedMinisterId={viewer?.id ?? null}
												rehearsalByDate={rehearsalByDate}
												rehearsalStatus={rehearsalLoading ? 'loading' : rehearsalError ? 'error' : 'ready'}
												canEditRehearsal={canEditRehearsal}
												onSaveRehearsal={handleSaveRehearsal}
											/>
										)}
									</TabsContent>
								</Tabs>
							</TabsContent>
						</Tabs>
					</div>
				)}
			</main>
		</div>
	)
}
