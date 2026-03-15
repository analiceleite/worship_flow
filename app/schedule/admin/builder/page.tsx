'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/header'
import { ROUTES } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	ListFilter,
	Megaphone,
	MegaphoneOff,
	Plus,
} from 'lucide-react'
import { QuarterForm, type QuarterSummary } from '@/components/schedule/QuarterForm'
import { ScheduleGrid, type ScheduleAssignment, type ScheduleRole } from '@/components/schedule/ScheduleGrid'

interface QuarterAssignmentsResponse {
	quarter: QuarterSummary
	roles: ScheduleRole[]
	assignments: ScheduleAssignment[]
	dates: {
		sunday: string[]
		thursday: string[]
	}
}

interface SavePayload {
	id: string
	quarter_id: string
	role_id: string
	event_date: string
	event_type: 'thursday' | 'sunday'
	minister_id: string | null
	minister_name: string | null
}

function EscalaBuilderContent() {
	const { toast } = useToast()
	const searchParams = useSearchParams()

	const [loadingQuarters, setLoadingQuarters] = useState(true)
	const [loadingData, setLoadingData] = useState(false)
	const [formOpen, setFormOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const [quarters, setQuarters] = useState<QuarterSummary[]>([])
	const [selectedQuarterId, setSelectedQuarterId] = useState<string>('')
	const [data, setData] = useState<QuarterAssignmentsResponse | null>(null)
	const [savingMap, setSavingMap] = useState<Record<string, boolean>>({})
	const [publishing, setPublishing] = useState(false)

	const loadQuarters = useCallback(async () => {
		try {
			setError(null)
			const response = await fetch('/api/schedule/quarters', { cache: 'no-store' })
			const body = await response.json()
			if (!response.ok) {
				throw new Error(body.error || 'Erro ao carregar trimestres')
			}

			const loaded: QuarterSummary[] = body.quarters ?? []
			setQuarters(loaded)

			if (!loaded.length) {
				setSelectedQuarterId('')
				return
			}

			const queryQuarter = searchParams.get('quarter')
			const selected =
				(queryQuarter && loaded.find((item) => item.id === queryQuarter)?.id) ||
				loaded.find((item) => item.is_published)?.id ||
				loaded[0].id

			setSelectedQuarterId(selected)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar trimestres')
		} finally {
			setLoadingQuarters(false)
		}
	}, [searchParams])

	const loadQuarterData = useCallback(async (quarterId: string) => {
		if (!quarterId) {
			setData(null)
			return
		}

		try {
			setLoadingData(true)
			setError(null)

			const response = await fetch(`/api/schedule/quarters/${quarterId}/assignments`, {
				cache: 'no-store',
			})
			const body = await response.json()

			if (!response.ok) {
				throw new Error(body.error || 'Erro ao carregar grade da escala')
			}

			setData(body)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar dados do trimestre')
			setData(null)
		} finally {
			setLoadingData(false)
		}
	}, [])

	useEffect(() => {
		loadQuarters()
	}, [loadQuarters])

	useEffect(() => {
		if (selectedQuarterId) {
			loadQuarterData(selectedQuarterId)
		}
	}, [selectedQuarterId, loadQuarterData])

	const selectedQuarter = useMemo(
		() => quarters.find((item) => item.id === selectedQuarterId) ?? null,
		[quarters, selectedQuarterId]
	)

	const handleSaveAssignment = async (payload: SavePayload) => {
		setSavingMap((current) => ({ ...current, [payload.id]: true }))

		const fallbackAssignment = {
			id: payload.id,
			quarter_id: payload.quarter_id,
			role_id: payload.role_id,
			event_date: payload.event_date,
			event_type: payload.event_type,
			minister_id: payload.minister_id,
			minister: payload.minister_id && payload.minister_name
				? { id: payload.minister_id, name: payload.minister_name }
				: null,
		}

		setData((current) => {
			if (!current) return current
			return {
				...current,
				assignments: current.assignments.map((assignment) =>
					assignment.id === payload.id ? fallbackAssignment : assignment
				),
			}
		})

		try {
			const response = await fetch('/api/schedule/assignment', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: payload.id,
					quarter_id: payload.quarter_id,
					role_id: payload.role_id,
					event_date: payload.event_date,
					event_type: payload.event_type,
					minister_id: payload.minister_id,
				}),
			})

			const body = await response.json()
			if (!response.ok) {
				throw new Error(body.error || 'Falha ao salvar a célula')
			}

			setData((current) => {
				if (!current) return current
				return {
					...current,
					assignments: current.assignments.map((assignment) =>
						assignment.id === payload.id ? body.assignment : assignment
					),
				}
			})
		} catch (err) {
			toast({
				variant: 'destructive',
				title: 'Não foi possível salvar',
				description: err instanceof Error ? err.message : 'Erro no auto-save da escala',
			})
			await loadQuarterData(payload.quarter_id)
		} finally {
			setSavingMap((current) => {
				const next = { ...current }
				delete next[payload.id]
				return next
			})
		}
	}

	const togglePublish = async () => {
		if (!selectedQuarter) return

		try {
			setPublishing(true)

			const response = await fetch(`/api/schedule/quarters/${selectedQuarter.id}/publish`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ is_published: !selectedQuarter.is_published }),
			})

			const body = await response.json()
			if (!response.ok) {
				throw new Error(body.error || 'Não foi possível atualizar a publicação')
			}

			const updated = body.quarter as QuarterSummary

			setQuarters((current) =>
				current.map((item) => {
					if (item.id === updated.id) return updated
					if (updated.is_published) return { ...item, is_published: false }
					return item
				})
			)

			setData((current) => (current ? { ...current, quarter: updated } : current))

			toast({
				title: updated.is_published ? 'Trimestre publicado' : 'Trimestre despublicado',
				description: updated.is_published
					? 'A nova escala está visível para toda a equipe.'
					: 'O trimestre voltou para o modo rascunho.',
			})
		} catch (err) {
			toast({
				variant: 'destructive',
				title: 'Falha ao publicar',
				description: err instanceof Error ? err.message : 'Erro ao atualizar publicação',
			})
		} finally {
			setPublishing(false)
		}
	}

	return (
		<div className="min-h-screen bg-background">
			<Header />

			<main className="mx-auto  px-4 py-6 sm:px-6 lg:px-8">
				<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
					<div>
						<Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
							<Link href={ROUTES.SCHEDULE}>
								<ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
								Voltar para a escala
							</Link>
						</Button>
						<h1 className="text-2xl font-bold text-foreground">Builder da Escala</h1>
						<p className="text-sm text-muted-foreground">
							Monte o trimestre por função e data com auto-save em cada célula.
						</p>
					</div>

					<div className="flex flex-wrap gap-2">
						<Button asChild variant="outline">
							<Link href={ROUTES.SCHEDULE_ADMIN_QUARTERS}>
								<ListFilter className="mr-2 h-4 w-4" />
								Ver trimestres
							</Link>
						</Button>
						<Button onClick={() => setFormOpen(true)}>
							<Plus className="mr-2 h-4 w-4" />
							Novo trimestre
						</Button>
					</div>
				</div>

				{error && (
					<Alert variant="destructive" className="mb-4">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				<Card className="py-4 mb-4">
					<CardHeader className="pb-3">
						<CardTitle className="text-base">Trimestre ativo no builder</CardTitle>
						<CardDescription>Escolha o trimestre que você quer editar.</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-wrap items-center gap-3">
						<div className="min-w-72 flex-1">
							<Select value={selectedQuarterId} onValueChange={setSelectedQuarterId} disabled={loadingQuarters || !quarters.length}>
								<SelectTrigger>
									<SelectValue placeholder={loadingQuarters ? 'Carregando trimestres...' : 'Selecione um trimestre'} />
								</SelectTrigger>
								<SelectContent>
									{quarters.map((quarter) => (
										<SelectItem key={quarter.id} value={quarter.id}>
											{quarter.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{selectedQuarter && (
							<>
								{selectedQuarter.is_published ? <Badge>Publicado</Badge> : <Badge variant="outline">Rascunho</Badge>}
								<Button variant="outline" size="sm" onClick={togglePublish} disabled={publishing}>
									{selectedQuarter.is_published ? (
										<>
											<MegaphoneOff className="mr-2 h-4 w-4" />
											Despublicar
										</>
									) : (
										<>
											<Megaphone className="mr-2 h-4 w-4" />
											Publicar
										</>
									)}
								</Button>
							</>
						)}
					</CardContent>
				</Card>

				{loadingData ? (
					<div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
						<Spinner className="h-6 w-6" />
						Carregando grade...
					</div>
				) : !data ? (
					<Card>
						<CardContent className="py-14 text-center">
							<p className="text-sm font-medium text-foreground">Nenhum trimestre selecionado</p>
							<p className="mt-1 text-xs text-muted-foreground">Crie um trimestre para começar a montar a escala.</p>
						</CardContent>
					</Card>
				) : (
					<div className="space-y-4">
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<CheckCircle2 className="h-4 w-4 text-green-500" />
							Alterações são salvas automaticamente ao selecionar cada ministro.
						</div>

						<Tabs defaultValue="thursday" className="w-full">
							<TabsList>
								<TabsTrigger value="thursday">Quintas</TabsTrigger>
								<TabsTrigger value="sunday">Domingos</TabsTrigger>
							</TabsList>

							<TabsContent value="thursday" className="mt-3">
								{data.dates.thursday.length === 0 ? (
									<Card>
										<CardContent className="py-12 text-center text-sm text-muted-foreground">
											O trimestre não possui datas de quinta-feira nesse período.
										</CardContent>
									</Card>
								) : (
									<ScheduleGrid
										roles={data.roles}
										dates={data.dates.thursday}
										eventType="thursday"
										assignments={data.assignments}
										savingKeys={savingMap}
										onSaveAssignment={handleSaveAssignment}
									/>
								)}
							</TabsContent>

							<TabsContent value="sunday" className="mt-3">
								{data.dates.sunday.length === 0 ? (
									<Card>
										<CardContent className="py-12 text-center text-sm text-muted-foreground">
											O trimestre não possui datas de domingo nesse período.
										</CardContent>
									</Card>
								) : (
									<ScheduleGrid
										roles={data.roles}
										dates={data.dates.sunday}
										eventType="sunday"
										assignments={data.assignments}
										savingKeys={savingMap}
										onSaveAssignment={handleSaveAssignment}
									/>
								)}
							</TabsContent>
						</Tabs>
					</div>
				)}
			</main>

			<QuarterForm
				open={formOpen}
				onOpenChange={setFormOpen}
				onCreated={(quarter) => {
					setQuarters((current) => [quarter, ...current])
					setSelectedQuarterId(quarter.id)
				}}
			/>
		</div>
	)
}

export default function EscalaBuilderPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
					<Spinner className="h-6 w-6" />
					Carregando builder...
				</div>
			}
		>
			<EscalaBuilderContent />
		</Suspense>
	)
}
