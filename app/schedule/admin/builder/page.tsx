'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ROUTES } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { selectedChurchFetch } from '@/lib/auth/client-context'
import {
	AlertCircle,
	ArrowLeft,
	BarChart3,
	CheckCircle2,
	FileSpreadsheet,
	ListFilter,
	Megaphone,
	MegaphoneOff,
	Plus,
	Trash2,
} from 'lucide-react'
import { BimesterForm, type BimesterSummary } from '@/components/schedule/BimesterForm'
import { ScheduleGrid, type ScheduleAssignment, type ScheduleRole } from '@/components/schedule/ScheduleGrid'

interface BimesterAssignmentsResponse {
	bimester: BimesterSummary
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
	minister_avatar_url?: string | null
	is_trainee: boolean
}

interface ImportPreviewMinister {
	id: string
	name: string
}

interface ImportPreviewItem {
	id: string
	sheet_name: string
	row_index: number
	event_type: 'thursday' | 'sunday'
	role_name: string
	event_date: string | null
	raw_minister_name: string
	assignment_id: string | null
	current_minister_id: string | null
	matched_ministers: ImportPreviewMinister[]
	status:
	| 'ready'
	| 'ambiguous'
	| 'not-found'
	| 'invalid-role'
	| 'invalid-date'
	| 'assignment-not-found'
	message: string
}

interface ImportPreviewResponse {
	quarter: {
		id: string
		name: string
		start_date: string
		end_date: string
	}
	ministers: ImportPreviewMinister[]
	summary: {
		total_items: number
		ready_items: number
		ambiguous_items: number
		not_found_items: number
		invalid_items: number
	}
	items: ImportPreviewItem[]
}

const IMPORT_SKIP_VALUE = '__skip__'

function EscalaBuilderContent() {
	const { toast } = useToast()
	const searchParams = useSearchParams()

	const [loadingQuarters, setLoadingQuarters] = useState(true)
	const [loadingData, setLoadingData] = useState(false)
	const [formOpen, setFormOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const [bimesters, setBimesters] = useState<BimesterSummary[]>([])
	const [selectedBimesterId, setSelectedBimesterId] = useState<string>('')
	const [data, setData] = useState<BimesterAssignmentsResponse | null>(null)
	const [savingMap, setSavingMap] = useState<Record<string, boolean>>({})
	const [publishing, setPublishing] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const [importOpen, setImportOpen] = useState(false)
	const [importFile, setImportFile] = useState<File | null>(null)
	const [previewLoading, setPreviewLoading] = useState(false)
	const [applyingImport, setApplyingImport] = useState(false)
	const [importPreview, setImportPreview] = useState<ImportPreviewResponse | null>(null)
	const [importSelectionMap, setImportSelectionMap] = useState<Record<string, string>>({})

	const loadQuarters = useCallback(async () => {
		try {
			setError(null)
			const response = await selectedChurchFetch('/api/schedule/quarters')
			const body = await response.json()
			if (!response.ok) {
				throw new Error(body.error || 'Erro ao carregar bimestres')
			}

			const loaded: BimesterSummary[] = body.quarters ?? []
			setBimesters(loaded)

			if (!loaded.length) {
				setSelectedBimesterId('')
				return
			}

			const queryQuarter = searchParams.get('quarter')
			const selected =
				(queryQuarter && loaded.find((item) => item.id === queryQuarter)?.id) ||
				loaded.find((item) => item.is_published)?.id ||
				loaded[0].id

			setSelectedBimesterId(selected)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar bimestres')
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

			const response = await selectedChurchFetch(`/api/schedule/quarters/${quarterId}/assignments`)
			const body = await response.json()

			if (!response.ok) {
				throw new Error(body.error || 'Erro ao carregar grade da escala')
			}

			setData(body)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar dados do bimestre')
			setData(null)
		} finally {
			setLoadingData(false)
		}
	}, [])

	useEffect(() => {
		loadQuarters()
	}, [loadQuarters])

	useEffect(() => {
		if (selectedBimesterId) {
			loadQuarterData(selectedBimesterId)
		}
	}, [selectedBimesterId, loadQuarterData])

	const selectedBimester = useMemo(
		() => bimesters.find((item) => item.id === selectedBimesterId) ?? null,
		[bimesters, selectedBimesterId]
	)

	const unresolvedImportItems = useMemo(() => {
		if (!importPreview) return 0

		return importPreview.items.filter((item) => {
			if (!item.assignment_id) return false
			if (item.status === 'ready') return false

			const selected = importSelectionMap[item.id] ?? IMPORT_SKIP_VALUE
			return selected === IMPORT_SKIP_VALUE
		}).length
	}, [importPreview, importSelectionMap])

	const importApplyItemsCount = useMemo(() => {
		if (!importPreview) return 0

		return importPreview.items.filter((item) => {
			if (!item.assignment_id) return false

			const selected = importSelectionMap[item.id] ?? IMPORT_SKIP_VALUE
			if (selected === IMPORT_SKIP_VALUE) return false

			return selected !== (item.current_minister_id ?? null)
		}).length
	}, [importPreview, importSelectionMap])

	const handleSaveAssignment = async (payload: SavePayload) => {
		setSavingMap((current) => ({ ...current, [payload.id]: true }))

		const fallbackAssignment = {
			id: payload.id,
			quarter_id: payload.quarter_id,
			role_id: payload.role_id,
			event_date: payload.event_date,
			event_type: payload.event_type,
			minister_id: payload.minister_id,
			is_trainee: payload.is_trainee,
			minister: payload.minister_id && payload.minister_name
				? { id: payload.minister_id, name: payload.minister_name, avatar_url: payload.minister_avatar_url ?? null }
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
			const response = await selectedChurchFetch('/api/schedule/assignment', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: payload.id,
					quarter_id: payload.quarter_id,
					role_id: payload.role_id,
					event_date: payload.event_date,
					event_type: payload.event_type,
					minister_id: payload.minister_id,
					is_trainee: payload.is_trainee,
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
		if (!selectedBimester) return

		try {
			setPublishing(true)

			const response = await selectedChurchFetch(`/api/schedule/quarters/${selectedBimester.id}/publish`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ is_published: !selectedBimester.is_published }),
			})

			const body = await response.json()
			if (!response.ok) {
				throw new Error(body.error || 'Não foi possível atualizar a publicação')
			}

			const updated = body.quarter as BimesterSummary

			setBimesters((current) =>
				current.map((item) => {
					if (item.id === updated.id) return updated
					if (updated.is_published) return { ...item, is_published: false }
					return item
				})
			)

			setData((current) => (current ? { ...current, bimester: updated } : current))

			toast({
				title: updated.is_published ? 'Bimestre publicado' : 'Bimestre despublicado',
				description: updated.is_published
					? 'A nova escala está visível para toda a equipe.'
					: 'O bimestre voltou para o modo rascunho.',
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

	const deleteBimester = async () => {
		if (!selectedBimester) return

		try {
			setDeleting(true)

			const response = await selectedChurchFetch(`/api/schedule/quarters/${selectedBimester.id}`, {
				method: 'DELETE',
			})
			const body = await response.json()

			if (!response.ok) {
				throw new Error(body.error || 'Não foi possível apagar o bimestre')
			}

			const nextBimesters = bimesters.filter((item) => item.id !== selectedBimester.id)
			setBimesters(nextBimesters)

			if (!nextBimesters.length) {
				setSelectedBimesterId('')
				setData(null)
			} else {
				const nextSelectedId =
					nextBimesters.find((item) => item.is_published)?.id ?? nextBimesters[0].id
				setSelectedBimesterId(nextSelectedId)
			}

			toast({
				title: 'Bimestre apagado',
				description: 'O bimestre e suas alocações foram removidos com sucesso.',
			})
		} catch (err) {
			toast({
				variant: 'destructive',
				title: 'Falha ao apagar',
				description: err instanceof Error ? err.message : 'Erro ao apagar bimestre',
			})
		} finally {
			setDeleting(false)
		}
	}

	const resetImportState = () => {
		setImportFile(null)
		setImportPreview(null)
		setImportSelectionMap({})
	}

	const readFileAsBase64 = (file: File): Promise<string> =>
		new Promise((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = () => {
				const result = String(reader.result ?? '')
				const base64 = result.includes(',') ? result.split(',')[1] : result
				resolve(base64)
			}
			reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
			reader.readAsDataURL(file)
		})

	const analyzeImportFile = async () => {
		if (!selectedBimesterId) {
			toast({
				variant: 'destructive',
				title: 'Selecione um bimestre',
				description: 'Escolha um bimestre antes de importar a planilha.',
			})
			return
		}

		if (!importFile) {
			toast({
				variant: 'destructive',
				title: 'Arquivo não selecionado',
				description: 'Escolha um arquivo .xlsx para analisar.',
			})
			return
		}

		try {
			setPreviewLoading(true)
			const workbookBase64 = await readFileAsBase64(importFile)

			const response = await selectedChurchFetch(`/api/schedule/quarters/${selectedBimesterId}/import/preview`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workbook_base64: workbookBase64 }),
			})

			const body = (await response.json()) as ImportPreviewResponse & { error?: string }
			if (!response.ok) {
				throw new Error(body.error || 'Não foi possível processar a planilha')
			}

			setImportPreview(body)

			const defaultSelection: Record<string, string> = {}
			for (const item of body.items) {
				if (!item.assignment_id) continue

				if (item.status === 'ready' && item.matched_ministers.length === 1) {
					defaultSelection[item.id] = item.matched_ministers[0].id
					continue
				}

				defaultSelection[item.id] = IMPORT_SKIP_VALUE
			}

			setImportSelectionMap(defaultSelection)
		} catch (err) {
			toast({
				variant: 'destructive',
				title: 'Falha ao analisar planilha',
				description: err instanceof Error ? err.message : 'Erro ao processar arquivo',
			})
		} finally {
			setPreviewLoading(false)
		}
	}

	const applyImportChanges = async () => {
		if (!importPreview) return

		const itemsToApply = importPreview.items
			.filter((item) => item.assignment_id)
			.map((item) => {
				const selection = importSelectionMap[item.id] ?? IMPORT_SKIP_VALUE
				if (selection === IMPORT_SKIP_VALUE) return null

				return {
					assignment_id: item.assignment_id as string,
					minister_id: selection,
					is_trainee: false,
				}
			})
			.filter((item): item is { assignment_id: string; minister_id: string; is_trainee: boolean } => Boolean(item))

		if (!itemsToApply.length) {
			toast({
				variant: 'destructive',
				title: 'Nada para aplicar',
				description: 'Faça pelo menos uma correspondência para aplicar a importação.',
			})
			return
		}

		try {
			setApplyingImport(true)

			const response = await selectedChurchFetch(`/api/schedule/quarters/${selectedBimesterId}/import/apply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: itemsToApply }),
			})

			const body = (await response.json()) as { error?: string; updated_count?: number; skipped_count?: number }
			if (!response.ok) {
				throw new Error(body.error || 'Falha ao aplicar importação')
			}

			await loadQuarterData(selectedBimesterId)
			setImportOpen(false)
			resetImportState()

			toast({
				title: 'Importação aplicada',
				description: `${body.updated_count ?? 0} células atualizadas (${body.skipped_count ?? 0} ignoradas).`,
			})
		} catch (err) {
			toast({
				variant: 'destructive',
				title: 'Falha ao aplicar importação',
				description: err instanceof Error ? err.message : 'Erro ao aplicar alterações',
			})
		} finally {
			setApplyingImport(false)
		}
	}

	return (
		<div className="min-h-screen bg-background">

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
							Monte o bimestre por função e data com auto-save em cada célula.
						</p>
					</div>

					<div className="flex flex-wrap gap-2">
						<Button asChild variant="outline">
							<Link href={ROUTES.SCHEDULE_ADMIN_DASHBOARD}>
								<BarChart3 className="mr-2 h-4 w-4" />
								Dashboard
							</Link>
						</Button>
						<Button asChild variant="outline">
							<Link href={ROUTES.SCHEDULE_ADMIN_QUARTERS}>
								<ListFilter className="mr-2 h-4 w-4" />
								Ver bimestres
							</Link>
						</Button>
						<Dialog
							open={importOpen}
							onOpenChange={(nextOpen) => {
								setImportOpen(nextOpen)
								if (!nextOpen) {
									resetImportState()
								}
							}}
						>
							<DialogTrigger asChild>
								<Button variant="outline" disabled={!selectedBimesterId}>
									<FileSpreadsheet className="mr-2 h-4 w-4" />
									Importar planilha
								</Button>
							</DialogTrigger>
							<DialogContent className="max-w-5xl">
								<DialogHeader>
									<DialogTitle>Importar escala por planilha</DialogTitle>
									<DialogDescription>
										Envie o arquivo, revise as correspondências e ajuste os nomes antes de aplicar.
									</DialogDescription>
								</DialogHeader>

								<div className="space-y-4">
									<div className="flex flex-col gap-3 md:flex-row md:items-end">
										<div className="flex-1 space-y-2">
											<p className="text-xs font-medium text-muted-foreground">Arquivo (.xlsx)</p>
											<Input
												type="file"
												accept=".xlsx,.xls"
												onChange={(event) => {
													setImportPreview(null)
													setImportSelectionMap({})
													setImportFile(event.target.files?.[0] ?? null)
												}}
											/>
										</div>
										<Button onClick={analyzeImportFile} disabled={previewLoading || !importFile}>
											{previewLoading ? 'Analisando...' : 'Gerar prévia'}
										</Button>
									</div>

									{importPreview && (
										<>
											<div className="flex flex-wrap gap-2 text-xs">
												<Badge variant="outline">Itens: {importPreview.summary.total_items}</Badge>
												<Badge>Prontos: {importPreview.summary.ready_items}</Badge>
												<Badge variant="secondary">Ambíguos: {importPreview.summary.ambiguous_items}</Badge>
												<Badge variant="secondary">Não encontrados: {importPreview.summary.not_found_items}</Badge>
												<Badge variant="destructive">Inválidos: {importPreview.summary.invalid_items}</Badge>
												{unresolvedImportItems > 0 && (
													<Badge variant="destructive">Pendentes de ajuste: {unresolvedImportItems}</Badge>
												)}
											</div>

											<div className="max-h-[420px] space-y-2 overflow-y-auto rounded-md border p-2">
												{importPreview.items.map((item) => {
													const selectedMinister = importSelectionMap[item.id] ?? IMPORT_SKIP_VALUE

													return (
														<div key={item.id} className="rounded-md border p-2">
															<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
																<p className="font-medium text-foreground">
																	{item.event_date ?? 'Data inválida'} • {item.event_type === 'thursday' ? 'Quinta' : 'Domingo'} • {item.role_name}
																</p>
																<Badge variant={item.status === 'ready' ? 'default' : 'outline'}>{item.status}</Badge>
															</div>
															<p className="mt-1 text-xs text-muted-foreground">Planilha: {item.raw_minister_name}</p>
															<p className="text-xs text-muted-foreground">{item.message}</p>

															{item.assignment_id && (
																<div className="mt-2">
																	<Select
																		value={selectedMinister}
																		onValueChange={(value) => {
																			setImportSelectionMap((current) => ({
																				...current,
																				[item.id]: value,
																			}))
																		}}
																	>
																		<SelectTrigger>
																			<SelectValue placeholder="Escolha um ministro" />
																		</SelectTrigger>
																		<SelectContent>
																			<SelectItem value={IMPORT_SKIP_VALUE}>Não aplicar nesta célula</SelectItem>
																			{importPreview.ministers.map((minister) => (
																				<SelectItem key={minister.id} value={minister.id}>
																					{minister.name}
																				</SelectItem>
																			))}
																		</SelectContent>
																	</Select>
																</div>
															)}
														</div>
													)
												})}
											</div>
										</>
									)}
								</div>

								<DialogFooter>
									<Button variant="outline" onClick={() => setImportOpen(false)} disabled={applyingImport}>
										Fechar
									</Button>
									<Button
										onClick={applyImportChanges}
										disabled={!importPreview || applyingImport || importApplyItemsCount === 0}
									>
										{applyingImport ? 'Aplicando...' : `Aplicar importação (${importApplyItemsCount})`}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
						<Button onClick={() => setFormOpen(true)}>
							<Plus className="mr-2 h-4 w-4" />
							Novo bimestre
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
						<CardTitle className="text-base">Bimestre ativo no builder</CardTitle>
						<CardDescription>Escolha o bimestre que você quer editar.</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-wrap items-center gap-3">
						<div className="min-w-72 flex-1">
							<Select value={selectedBimesterId} onValueChange={setSelectedBimesterId} disabled={loadingQuarters || !bimesters.length}>
								<SelectTrigger>
									<SelectValue placeholder={loadingQuarters ? 'Carregando bimestres...' : 'Selecione um bimestre'} />
								</SelectTrigger>
								<SelectContent>
									{bimesters.map((bimester) => (
										<SelectItem key={bimester.id} value={bimester.id}>
											{bimester.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{selectedBimester && (
							<>
								{selectedBimester.is_published ? <Badge>Publicado</Badge> : <Badge variant="outline">Rascunho</Badge>}
								<Button variant="outline" size="sm" onClick={togglePublish} disabled={publishing}>
									{selectedBimester.is_published ? (
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
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button variant="destructive" size="sm" disabled={deleting}>
											<Trash2 className="mr-2 h-4 w-4" />
											Apagar bimestre
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Apagar bimestre?</AlertDialogTitle>
											<AlertDialogDescription>
												Esta ação é irreversível e vai apagar definitivamente este bimestre, incluindo
												todas as alocações e ensaios vinculados.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
											<AlertDialogAction onClick={deleteBimester} disabled={deleting}>
												{deleting ? 'Apagando...' : 'Sim, apagar bimestre'}
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
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
							<p className="text-sm font-medium text-foreground">Nenhum bimestre selecionado</p>
							<p className="mt-1 text-xs text-muted-foreground">Crie um bimestre para começar a montar a escala.</p>
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
											O bimestre não possui datas de quinta-feira nesse período.
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
											O bimestre não possui datas de domingo nesse período.
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

			<BimesterForm
				open={formOpen}
				onOpenChange={setFormOpen}
				existingBimesters={bimesters}
				onCreated={(bimester) => {
					setBimesters((current) => [bimester, ...current])
					setSelectedBimesterId(bimester.id)
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
