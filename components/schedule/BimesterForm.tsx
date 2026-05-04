'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'

export interface BimesterSummary {
    id: string
    name: string
    start_date: string
    end_date: string
    is_published: boolean
    created_at: string
}

interface BimesterFormProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onCreated: (bimester: BimesterSummary) => void
    existingBimesters?: BimesterSummary[]
}

function toDateString(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function getMonthStart(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, amount: number) {
    return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function getMonthEnd(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function buildPeriodName(startDate: Date, endDate: Date) {
    const startMonth = startDate.toLocaleDateString('pt-BR', { month: 'long' })
    const endMonth = endDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return `${startMonth.charAt(0).toUpperCase()}${startMonth.slice(1)} a ${endMonth}`
}

export function BimesterForm({ open, onOpenChange, onCreated, existingBimesters = [] }: BimesterFormProps) {
    const [name, setName] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const latestBimester = useMemo(() => {
        if (!existingBimesters.length) return null

        return [...existingBimesters].sort((a, b) => {
            if (a.end_date === b.end_date) return 0
            return a.end_date < b.end_date ? 1 : -1
        })[0]
    }, [existingBimesters])

    const hasPreviousPeriod = Boolean(latestBimester)

    useEffect(() => {
        if (!open) return

        if (latestBimester) {
            const latestEndDate = new Date(`${latestBimester.end_date}T12:00:00`)
            const nextStart = getMonthStart(latestEndDate)
            const nextEnd = getMonthEnd(addMonths(nextStart, 2))
            setStartDate(toDateString(nextStart))
            setEndDate(toDateString(nextEnd))
            setName(buildPeriodName(nextStart, nextEnd))
            return
        }

        const currentMonthStart = getMonthStart(new Date())
        const currentWindowEnd = getMonthEnd(addMonths(currentMonthStart, 2))
        setStartDate(toDateString(currentMonthStart))
        setEndDate(toDateString(currentWindowEnd))
        setName(buildPeriodName(currentMonthStart, currentWindowEnd))
    }, [open, latestBimester])

    const handleClose = (nextOpen: boolean) => {
        if (!saving) {
            onOpenChange(nextOpen)
            if (!nextOpen) {
                setError(null)
            }
        }
    }

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        try {
            setSaving(true)
            setError(null)

            const response = await fetch('/api/schedule/quarters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    start_date: startDate,
                    end_date: endDate,
                    use_bimonthly_flow: true,
                }),
            })

            const body = await response.json()
            if (!response.ok) {
                throw new Error(body.error || 'Não foi possível criar o bimestre')
            }

            onCreated(body.quarter)
            setName('')
            setStartDate('')
            setEndDate('')
            onOpenChange(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao criar bimestre')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Novo Bimestre</DialogTitle>
                    <DialogDescription>
                        O builder mantém o último mês do período anterior e adiciona os dois próximos meses automaticamente.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="bimester-name">Nome</Label>
                        <Input
                            id="bimester-name"
                            placeholder="Ex.: Março a Maio 2026"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            required
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="bimester-start">Data inicial</Label>
                            <Input
                                id="bimester-start"
                                type="date"
                                value={startDate}
                                onChange={(event) => setStartDate(event.target.value)}
                                disabled={hasPreviousPeriod}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="bimester-end">Data final</Label>
                            <Input
                                id="bimester-end"
                                type="date"
                                value={endDate}
                                onChange={(event) => setEndDate(event.target.value)}
                                disabled={hasPreviousPeriod}
                                required
                            />
                        </div>
                    </div>

                    {hasPreviousPeriod && (
                        <p className="text-xs text-muted-foreground">
                            Período calculado automaticamente a partir do último mês da escala anterior.
                        </p>
                    )}

                    {error && (
                        <p className="text-sm text-destructive" role="alert">
                            {error}
                        </p>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {saving ? 'Criando...' : 'Criar bimestre'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
