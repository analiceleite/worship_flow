'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Header } from '@/components/header'
import { ROUTES } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { QuarterForm, type QuarterSummary } from '@/components/schedule/QuarterForm'
import { Plus, AlertCircle, ExternalLink, ArrowLeft, BarChart3 } from 'lucide-react'

function formatRange(startDate: string, endDate: string) {
	const start = new Date(`${startDate}T12:00:00`)
	const end = new Date(`${endDate}T12:00:00`)

	const startText = start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
	const endText = end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })

	return `${startText} - ${endText}`
}

export default function EscalaQuartersPage() {
	const [loading, setLoading] = useState(true)
	const [formOpen, setFormOpen] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [quarters, setQuarters] = useState<QuarterSummary[]>([])

	const loadQuarters = useCallback(async () => {
		try {
			setError(null)
			const response = await fetch('/api/schedule/quarters', { cache: 'no-store' })
			const body = await response.json()

			if (!response.ok) {
				throw new Error(body.error || 'Não foi possível carregar os trimestres')
			}

			setQuarters(body.quarters ?? [])
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar trimestres')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadQuarters()
	}, [loadQuarters])

	const publishedQuarterId = useMemo(
		() => quarters.find((item) => item.is_published)?.id ?? null,
		[quarters]
	)

	return (
		<div className="min-h-screen bg-background">
			<Header />

			<main className="mx-auto px-4 py-6 sm:px-6 lg:px-8">
				<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
					<div>
						<Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
							<Link href={ROUTES.SCHEDULE}>
								<ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
								Voltar para a escala
							</Link>
						</Button>
						<h1 className="text-2xl font-bold text-foreground">Trimestres da Escala</h1>
						<p className="text-sm text-muted-foreground">
							Crie trimestres e abra o builder para preencher as funções de cada culto.
						</p>
					</div>

					<div className="flex flex-wrap gap-2">
						<Button asChild variant="outline">
							<Link href={ROUTES.SCHEDULE_ADMIN_DASHBOARD}>
								<BarChart3 className="mr-2 h-4 w-4" />
								Dashboard
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

				{loading ? (
					<div className="flex items-center justify-center py-16">
						<Spinner className="h-6 w-6" />
					</div>
				) : quarters.length === 0 ? (
					<Card>
						<CardContent className="py-12 text-center">
							<p className="text-sm font-medium text-foreground">Nenhum trimestre cadastrado</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Clique em "Novo trimestre" para começar a montar a escala.
							</p>
						</CardContent>
					</Card>
				) : (
					<div className="grid gap-4">
						{quarters.map((quarter) => (
							<Card key={quarter.id}>
								<CardHeader className="pb-3">
									<div className="flex flex-wrap items-start justify-between gap-3 mt-4">
										<div>
											<CardTitle className="text-base">{quarter.name}</CardTitle>
											<CardDescription>{formatRange(quarter.start_date, quarter.end_date)}</CardDescription>
										</div>

										{quarter.id === publishedQuarterId ? (
											<Badge>Publicado</Badge>
										) : (
											<Badge variant="outline">Rascunho</Badge>
										)}
									</div>
								</CardHeader>
								<CardContent>
									<div className="flex flex-wrap gap-2 mb-4">
										<Button asChild size="sm">
											<Link href={`${ROUTES.SCHEDULE_ADMIN_BUILDER}?quarter=${quarter.id}`}>
												Abrir builder
												<ExternalLink className="ml-2 h-3.5 w-3.5" />
											</Link>
										</Button>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</main>

			<QuarterForm
				open={formOpen}
				onOpenChange={setFormOpen}
				onCreated={(quarter) => {
					setQuarters((current) => [quarter, ...current])
				}}
			/>
		</div>
	)
}
