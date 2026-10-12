'use client'

import { useEffect, useState, useCallback } from 'react'
import { Minister } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/header'
import { MinisterForm } from '@/components/minister-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Plus, Search, Users, Pencil, Trash2 } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'

export default function MinistrosPage() {
    const [ministers, setMinisters] = useState<Minister[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [formOpen, setFormOpen] = useState(false)
    const [editingMinister, setEditingMinister] = useState<Minister | null>(null)
    const [deletingMinister, setDeletingMinister] = useState<Minister | null>(null)
    const [currentMinister, setCurrentMinister] = useState<Minister | null>(null)

    const fetchMinisters = useCallback(async () => {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            setLoading(false)
            return
        }

        const { data: viewer, error: viewerError } = await supabase
            .from('ministers')
            .select('*')
            .eq('user_id', user.id)
            .single()

        if (viewerError || !viewer) {
            console.error('Erro ao identificar ministro atual:', viewerError)
            setLoading(false)
            return
        }

        setCurrentMinister(viewer)

        const { data, error } = await supabase
            .from('ministers')
            .select('*')
            .eq('church_id', viewer.church_id)
            .order('name', { ascending: true })

        if (error) {
            console.error('Erro ao buscar ministros:', error)
        } else {
            setMinisters(data || [])
        }
        setLoading(false)
    }, [])

    useEffect(() => {
        fetchMinisters()
    }, [fetchMinisters])

    const handleDeleteMinister = async () => {
        if (!deletingMinister) return
        try {
            const response = await fetch(`/api/ministers/${deletingMinister.id}`, {
                method: 'DELETE',
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Erro ao excluir ministro')
            setDeletingMinister(null)
            await fetchMinisters()
        } catch (error: any) {
            console.error('Erro ao excluir ministro:', error)
            alert(error.message || 'Erro ao excluir ministro')
        }
    }

    const filteredMinisters = ministers.filter(
        (minister) =>
            minister.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (minister.role === 'midia' ? 'midia' : (minister.instrument || 'Outros')).toLowerCase().includes(searchQuery.toLowerCase())
    )

    const groupedMinisters = filteredMinisters.reduce(
        (acc, minister) => {
            const instrument = minister.role === 'midia' ? 'Midia' : (minister.instrument || 'Outros')
            if (!acc[instrument]) acc[instrument] = []
            acc[instrument].push(minister)
            return acc
        },
        {} as Record<string, Minister[]>
    )

    const instrumentGroups = Object.entries(groupedMinisters).sort(([a], [b]) =>
        a.localeCompare(b)
    )

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="mx-auto px-4 py-6 sm:px-6 lg:px-8">

                {/* ── Header ── */}
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Ministros</h1>
                        <p className="text-sm text-muted-foreground">
                            {ministers.length} {ministers.length === 1 ? 'ministro' : 'ministros'} no time
                        </p>
                    </div>
                    <Button onClick={() => setFormOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Novo Ministro
                    </Button>
                </div>

                {/* ── Search ── */}
                <div className="relative mb-6">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nome ou instrumento..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>

                {/* ── Content ── */}
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Spinner className="h-8 w-8" />
                    </div>

                ) : filteredMinisters.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="mb-4 rounded-2xl bg-muted p-5">
                            <Users className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="mb-1 text-base font-semibold text-foreground">
                            {searchQuery ? 'Nenhum resultado' : 'Nenhum ministro cadastrado'}
                        </h3>
                        <p className="mb-5 text-sm text-muted-foreground">
                            {searchQuery
                                ? `Nenhum ministro encontrado para "${searchQuery}".`
                                : 'Comece adicionando o primeiro ministro do time.'}
                        </p>
                        {!searchQuery && (
                            <Button onClick={() => setFormOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                Adicionar Ministro
                            </Button>
                        )}
                    </div>

                ) : (
                    <div className="space-y-8">
                        {instrumentGroups.map(([instrument, group]) => (
                            <div key={instrument}>

                                {/* ── Group label ── */}
                                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                    {instrument} · {group.length}
                                </p>

                                {/* ── Minister rows ── */}
                                <div className="space-y-2">
                                    {group.map((minister) => (
                                        <div
                                            key={minister.id}
                                            className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-shadow hover:shadow-sm"
                                        >
                                            {/* Avatar initial */}
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
                                                {minister.name.charAt(0).toUpperCase()}
                                            </div>

                                            {/* Info */}
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-semibold text-foreground">
                                                    {minister.name}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {minister.role === 'midia' ? 'Midia' : minister.instrument}
                                                </p>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex shrink-0 items-center">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-muted-foreground hover:text-foreground"
                                                    onClick={() => {
                                                        setEditingMinister(minister)
                                                        setFormOpen(true)
                                                    }}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                                    onClick={() => setDeletingMinister(minister)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* ── Minister form ── */}
            <MinisterForm
                open={formOpen}
                onOpenChange={(open) => {
                    setFormOpen(open)
                    if (!open) setEditingMinister(null)
                }}
                minister={editingMinister}
                currentMinister={currentMinister}
                onSuccess={fetchMinisters}
            />

            {/* ── Delete dialog ── */}
            <AlertDialog
                open={!!deletingMinister}
                onOpenChange={(open) => !open && setDeletingMinister(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir Ministro</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tem certeza que deseja excluir "{deletingMinister?.name}"? Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteMinister}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Excluir
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
