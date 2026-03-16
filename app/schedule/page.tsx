'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, getISOWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Header } from '@/components/header'
import { ROUTES } from '@/lib/routes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleGrid, type ScheduleAssignment, type ScheduleRole } from '@/components/schedule/ScheduleGrid'
import { AlertCircle, Music2, Settings2, UserCircle2 } from 'lucide-react'

function formatWeekTag(dateStr: string) {
	return `S${getISOWeek(new Date(`${dateStr}T12:00:00`))}`
}

function formatFullDate(dateStr: string) {
	return format(new Date(`${dateStr}T12:00:00`), "EEEE, dd 'de' MMMM", { locale: ptBR })
}

interface QuarterSummary {
	id: string
	name: string
	start_date: string
	end_date: string
	is_published: boolean
	created_at: string
}

interface CurrentScheduleResponse {
	schedule: {
		quarter: QuarterSummary
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

export default function EscalaPage() {
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [schedule, setSchedule] = useState<CurrentScheduleResponse['schedule']>(null)
	const [viewer, setViewer] = useState<CurrentScheduleResponse['viewer']>(null)

	const loadSchedule = useCallback(async () => {
		try {
			setError(null)
			const response = await fetch('/api/schedule/current', { cache: 'no-store' })
			const body = (await response.json()) as CurrentScheduleResponse & { error?: string }

			if (!response.ok) {
				throw new Error(body.error || 'Não foi possível carregar a escala')
			}

			setSchedule(body.schedule)
			setViewer(body.viewer)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar escala')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadSchedule()
	}, [loadSchedule])

	const isAdmin = viewer?.role === 'admin'

	const assignedCount = useMemo(() => {
		if (!schedule || !viewer?.id) return 0
		return schedule.assignments.filter((item) => item.minister_id === viewer.id).length
	}, [schedule, viewer?.id])

	const weekPairs = useMemo(() => {
		if (!schedule || !viewer?.id) return []

		const weekMap = new Map<number, { thursday: string | null; sunday: string | null }>()
		for (const date of schedule.dates.thursday) {
			const week = getISOWeek(new Date(`${date}T12:00:00`))
			if (!weekMap.has(week)) weekMap.set(week, { thursday: null, sunday: null })
			weekMap.get(week)!.thursday = date
		}
		for (const date of schedule.dates.sunday) {
			const week = getISOWeek(new Date(`${date}T12:00:00`))
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
		const currentYear = today.getFullYear()

		return Array.from(weekMap.entries())
			.sort(([a], [b]) => a - b)
			.map(([week, { thursday, sunday }]) => {
				const latestDateStr = sunday ?? thursday!
				const latestDate = new Date(`${latestDateStr}T12:00:00`)
				const weekYear = latestDate.getFullYear()
				const isPast = latestDate < today
				const isCurrentWeek = week === currentISOWeek && weekYear === currentYear
				return {
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

	return (
		<div className="min-h-screen bg-background">
			<Header />

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
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{isAdmin && (
					<Card className="mb-6">
						<CardHeader className="py-4">
							<CardTitle className="text-base">Gerenciar Escala</CardTitle>
							<CardDescription>
								Crie trimestres, preencha o builder e publique para liberar esta visualização.
							</CardDescription>
							<div className="flex flex-wrap gap-2 pt-2">
								<Button asChild size="sm" variant="outline">
									<Link href={ROUTES.SCHEDULE_ADMIN_QUARTERS}>
										<Settings2 className="mr-2 h-3.5 w-3.5" />
										Trimestres
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
					<div className="flex flex-col items-center justify-center gap-3 py-20">
						<Spinner className="h-7 w-7" />
						<p className="text-sm text-muted-foreground">Carregando escala...</p>
					</div>
				) : !schedule ? (
					<Card>
						<CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
							<div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
								<Music2 className="h-6 w-6" />
							</div>
							<div className="space-y-1">
								<p className="text-sm font-medium text-foreground">Nenhuma escala publicada</p>
								<p className="text-xs text-muted-foreground">
									{isAdmin
										? 'Publique um trimestre no builder para exibir aqui.'
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
										<CardTitle className="text-base">{schedule.quarter.name}</CardTitle>
										<CardDescription>
											{formatRange(schedule.quarter.start_date, schedule.quarter.end_date)}
										</CardDescription>
									</div>

									<div className="flex flex-wrap items-center gap-2">
										<Badge>Publicado</Badge>
										<Badge variant="outline" className='p-1'>
										 {assignedCount} {assignedCount === 1 ? 'atribuição' : 'atribuições'} para você.
										</Badge>
									</div>
								</div>
							</CardHeader>
						</Card>

						<Tabs defaultValue="mine" className="w-full">
							<TabsList>
								<TabsTrigger value="mine">Minha Escala</TabsTrigger>
								<TabsTrigger value="all">Escala Geral</TabsTrigger>
							</TabsList>

							{/* ── Minha Escala ───────────────────────────────── */}
							<TabsContent value="mine" className="mt-3">
								{weekPairs.length === 0 ? (
									<Card>
										<CardContent className="flex flex-col items-center gap-3 py-16 text-center">
											<div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
												<UserCircle2 className="h-6 w-6" />
											</div>
											<div className="space-y-1">
												<p className="text-sm font-medium text-foreground">Nenhuma escala publicada</p>
												<p className="text-xs text-muted-foreground">
													Não há datas neste trimestre ainda.
												</p>
											</div>
										</CardContent>
									</Card>
								) : (
									<div className="space-y-3">
										{weekPairs.map(({ week, thursday, sunday, thursdayRoles, sundayRoles, isCurrentWeek }) => (
											<Card key={week}>
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
														) : (
															<div className="rounded-lg border border-dashed border-border/50 p-3 opacity-40">
																<p className="text-[10px] text-muted-foreground">Sem quinta nessa semana</p>
															</div>
														)}

														{/* Sunday */}
														{sunday ? (
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
								<Tabs defaultValue="thursday" className="w-full">
									<TabsList>
										<TabsTrigger value="thursday">Quintas</TabsTrigger>
										<TabsTrigger value="sunday">Domingos</TabsTrigger>
									</TabsList>

									<TabsContent value="thursday" className="mt-3">
										{schedule.dates.thursday.length === 0 ? (
											<Card>
												<CardContent className="py-12 text-center text-sm text-muted-foreground">
													O trimestre publicado não possui datas de quinta-feira.
												</CardContent>
											</Card>
										) : (
											<ScheduleGrid
												roles={schedule.roles}
												dates={schedule.dates.thursday}
												eventType="thursday"
												assignments={schedule.assignments}
												readOnly
												highlightedMinisterId={viewer?.id ?? null}
											/>
										)}
									</TabsContent>

									<TabsContent value="sunday" className="mt-3">
										{schedule.dates.sunday.length === 0 ? (
											<Card>
												<CardContent className="py-12 text-center text-sm text-muted-foreground">
													O trimestre publicado não possui datas de domingo.
												</CardContent>
											</Card>
										) : (
											<ScheduleGrid
												roles={schedule.roles}
												dates={schedule.dates.sunday}
												eventType="sunday"
												assignments={schedule.assignments}
												readOnly
												highlightedMinisterId={viewer?.id ?? null}
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
