'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Minister } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { MinisterForm } from '@/components/minister-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Search, Users, Pencil, UserRoundX, UserRoundCheck, RefreshCw, Ban } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { churchFetch, loadChurchContext } from '@/lib/auth/client-context'
import type { InvitationSummary } from '@/lib/invitations/types'

export default function MinistrosPage() {
    const [ministers, setMinisters] = useState<Minister[]>([])
    const [invitations, setInvitations] = useState<InvitationSummary[]>([])
    const [inviteActionId, setInviteActionId] = useState<string | null>(null)
    const [inviteError, setInviteError] = useState<string | null>(null)
    const [revokeInvite, setRevokeInvite] = useState<InvitationSummary | null>(null)
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [formOpen, setFormOpen] = useState(false)
    const [editingMinister, setEditingMinister] = useState<Minister | null>(null)
    const [accessMinister, setAccessMinister] = useState<Minister | null>(null)
    const [accessSaving, setAccessSaving] = useState(false)
    const [accessError, setAccessError] = useState<string | null>(null)
    const [transferMinister, setTransferMinister] = useState<Minister | null>(null)
    const [transferTargetId, setTransferTargetId] = useState('')
    const [transferSaving, setTransferSaving] = useState(false)
    const [transferError, setTransferError] = useState<string | null>(null)
    const [currentMinister, setCurrentMinister] = useState<Minister | null>(null)
    const [effectiveChurchId, setEffectiveChurchId] = useState<string | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [viewerIsAdmin, setViewerIsAdmin] = useState(false)
    const loadedChurchId = useRef<string | null>(null)

    const fetchMinisters = useCallback(async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const { context } = await loadChurchContext(loadedChurchId.current ?? undefined)
            const [membersResult, invitationsResult] = await Promise.all([
                createClient().from('ministers').select('*')
                    .eq('church_id', context.churchId).order('name', { ascending: true }),
                churchFetch(context.churchId, '/api/invitations').catch(() => null),
            ])
            if (membersResult.error) throw new Error('Não foi possível carregar a equipe.')
            const rows = (membersResult.data ?? []) as Minister[]
            setCurrentMinister(rows.find(row => row.id === context.ministerId) ?? null)
            setViewerIsAdmin(context.isAdmin)
            setEffectiveChurchId(context.churchId)
            loadedChurchId.current = context.churchId
            setMinisters(rows)
            if (invitationsResult?.ok) {
                const payload = await invitationsResult.json().catch(() => ({}))
                setInvitations(Array.isArray(payload.invitations) ? payload.invitations : [])
            } else {
                setInvitations([])
            }
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar a equipe.')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchMinisters()
    }, [fetchMinisters])

    const handleChangeAccess = async () => {
        if (!accessMinister || accessSaving) return
        setAccessSaving(true)
        setAccessError(null)
        try {
            const response = await churchFetch(effectiveChurchId ?? accessMinister.church_id, `/api/ministers/${accessMinister.id}/access`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: accessMinister.access_state === 'suspended' ? 'active' : 'suspended' }),
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Erro ao alterar o acesso')
            setAccessMinister(null)
            await fetchMinisters()
        } catch (error: unknown) {
            setAccessError(error instanceof Error ? error.message : 'Erro ao alterar o acesso')
        } finally {
            setAccessSaving(false)
        }
    }

    const handleTransferSongs = async () => {
        if (!transferMinister || !transferTargetId || transferSaving || !effectiveChurchId) return
        setTransferSaving(true)
        setTransferError(null)
        try {
            const response = await churchFetch(effectiveChurchId, '/api/songs/transfer', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_minister_id: transferMinister.id, to_minister_id: transferTargetId }),
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Não foi possível transferir as músicas.')
            setTransferMinister(null)
            setTransferTargetId('')
        } catch (error) {
            setTransferError(error instanceof Error ? error.message : 'Não foi possível transferir as músicas.')
        } finally {
            setTransferSaving(false)
        }
    }

    const handleInviteAction = async (invitation: InvitationSummary, action: 'resend' | 'revoke') => {
        if (!effectiveChurchId || inviteActionId) return
        setInviteActionId(invitation.id)
        setInviteError(null)
        try {
            const response = await churchFetch(effectiveChurchId, `/api/invitations/${invitation.id}/${action}`, {
                method: 'POST',
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a ação do convite.')
            if (action === 'revoke') setRevokeInvite(null)
            await fetchMinisters()
        } catch (error: unknown) {
            setInviteError(error instanceof Error ? error.message : 'Não foi possível concluir a ação do convite.')
        } finally {
            setInviteActionId(null)
        }
    }

    const pendingInvitations = invitations.filter(invitation => invitation.state === 'pending')

    const deliveryLabel = (invitation: InvitationSummary) => {
        if (invitation.delivery?.status === 'sent') return 'E-mail enviado'
        if (invitation.delivery?.status === 'failed') return 'Falha no envio · use Reenviar'
        if (invitation.delivery?.status === 'sending') return 'Enviando...'
        return 'Envio pendente'
    }

    const formatInviteDate = (value: string) => {
        try {
            return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        } catch {
            return value
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

            <main className="mx-auto px-4 py-6 sm:px-6 lg:px-8">

                {/* ── Header ── */}
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Ministros</h1>
                        <p className="text-sm text-muted-foreground">
                            {ministers.length} {ministers.length === 1 ? 'ministro' : 'ministros'} no time
                        </p>
                    </div>
                    <Button onClick={() => setFormOpen(true)} disabled={!effectiveChurchId}>
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

                ) : loadError ? (
                    <Alert variant="destructive"><AlertDescription role="alert">{loadError}</AlertDescription><Button variant="outline" onClick={() => void fetchMinisters()}>Tentar novamente</Button></Alert>
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
                                            <Avatar className="h-9 w-9 shrink-0 rounded-lg">
                                                {viewerIsAdmin && minister.avatar_url && (
                                                    <AvatarImage
                                                        src={minister.avatar_url}
                                                        alt={`Foto de ${minister.name}`}
                                                        className="object-cover"
                                                    />
                                                )}
                                                <AvatarFallback className="rounded-lg text-sm font-semibold text-muted-foreground">
                                                    {minister.name.charAt(0).toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>

                                            {/* Info */}
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-semibold text-foreground">
                                                    {minister.name}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {minister.role === 'midia' ? 'Midia' : minister.instrument}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {minister.access_state === 'suspended' ? 'Acesso suspenso' : minister.access_state === 'pending' ? 'Acesso pendente' : 'Ativo'}
                                                </p>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex shrink-0 items-center">
                                                {viewerIsAdmin && minister.access_state === 'suspended' && ministers.some(item => item.access_state === 'active' && item.is_active && item.id !== minister.id) && (
                                                    <Button
                                                        variant="outline" size="sm" className="mr-1"
                                                        onClick={() => {
                                                            setTransferError(null)
                                                            setTransferMinister(minister)
                                                            setTransferTargetId('')
                                                        }}
                                                    >
                                                        Transferir músicas
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-muted-foreground hover:text-foreground"
                                                    aria-label={`Editar funções de ${minister.name}`}
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
                                                    disabled={minister.access_state === 'pending'}
                                                    aria-label={`${minister.access_state === 'suspended' ? 'Reativar' : 'Suspender'} acesso de ${minister.name}`}
                                                    onClick={() => {
                                                        setAccessError(null)
                                                        setAccessMinister(minister)
                                                    }}
                                                >
                                                    {minister.access_state === 'suspended' ? <UserRoundCheck className="h-4 w-4" /> : <UserRoundX className="h-4 w-4" />}
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {viewerIsAdmin && (
                    <section className="mt-12" aria-labelledby="invitations-title">
                        <h2 id="invitations-title" className="mb-1 text-lg font-semibold text-foreground">Convites</h2>
                        <p className="mb-4 text-sm text-muted-foreground">
                            {pendingInvitations.length} {pendingInvitations.length === 1 ? 'convite pendente' : 'convites pendentes'}. Convites aceitos e revogados ficam no histórico.
                        </p>
                        {inviteError && (
                            <Alert variant="destructive" className="mb-4"><AlertDescription role="alert">{inviteError}</AlertDescription></Alert>
                        )}
                        {invitations.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nenhum convite enviado ainda.</p>
                        ) : (
                            <ul className="space-y-2">
                                {invitations.map(invitation => {
                                    const busy = inviteActionId === invitation.id
                                    const actionable = invitation.state === 'pending' || invitation.state === 'expired'
                                    return (
                                        <li key={invitation.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-semibold text-foreground">{invitation.name}</p>
                                                <p className="truncate text-xs text-muted-foreground">
                                                    {invitation.email} · {invitation.role === 'midia' ? 'Mídia' : invitation.instrument}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {invitation.state === 'pending' && `Válido até ${formatInviteDate(invitation.expires_at)} · ${deliveryLabel(invitation)}`}
                                                    {invitation.state === 'expired' && 'Convite expirado · reenvie para gerar um novo link'}
                                                    {invitation.state === 'accepted' && 'Aceito'}
                                                    {invitation.state === 'revoked' && 'Revogado'}
                                                </p>
                                            </div>
                                            {actionable && (
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={busy}
                                                        onClick={() => void handleInviteAction(invitation, 'resend')}
                                                        aria-label={`Reenviar convite para ${invitation.email}`}
                                                    >
                                                        <RefreshCw className="mr-2 h-4 w-4" />
                                                        Reenviar
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={busy}
                                                        className="text-muted-foreground hover:text-destructive"
                                                        onClick={() => setRevokeInvite(invitation)}
                                                        aria-label={`Revogar convite de ${invitation.email}`}
                                                    >
                                                        <Ban className="mr-2 h-4 w-4" />
                                                        Revogar
                                                    </Button>
                                                </div>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </section>
                )}

                <Dialog open={Boolean(transferMinister)} onOpenChange={open => { if (!open && !transferSaving) setTransferMinister(null) }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Transferir músicas</DialogTitle>
                            <DialogDescription>
                                As músicas de {transferMinister?.name} serão atribuídas ao integrante escolhido. A transferência é registrada e não altera atribuições ou histórico da escala.
                            </DialogDescription>
                        </DialogHeader>
                        <label className="space-y-2 text-sm font-medium">
                            Integrante ativo de destino
                            <select
                                value={transferTargetId}
                                onChange={event => setTransferTargetId(event.target.value)}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                                <option value="">Selecione uma pessoa</option>
                                {ministers.filter(item => item.access_state === 'active' && item.is_active && item.id !== transferMinister?.id)
                                    .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                        </label>
                        {transferError && <Alert variant="destructive"><AlertDescription role="alert">{transferError}</AlertDescription></Alert>}
                        <DialogFooter>
                            <Button variant="outline" disabled={transferSaving} onClick={() => setTransferMinister(null)}>Cancelar</Button>
                            <Button disabled={!transferTargetId || transferSaving} onClick={() => void handleTransferSongs()}>
                                {transferSaving ? 'Transferindo…' : 'Confirmar transferência'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
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
                effectiveChurchId={effectiveChurchId}
                onSuccess={fetchMinisters}
            />

            <AlertDialog
                open={!!revokeInvite}
                onOpenChange={(open) => { if (!open && !inviteActionId) setRevokeInvite(null) }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Revogar convite</AlertDialogTitle>
                        <AlertDialogDescription>
                            O link enviado para {revokeInvite?.email} deixará de funcionar. Esta ação não remove nenhuma conta existente.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={!!inviteActionId}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={!!inviteActionId}
                            onClick={(event) => {
                                event.preventDefault()
                                if (revokeInvite) void handleInviteAction(revokeInvite, 'revoke')
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {inviteActionId ? 'Revogando...' : 'Revogar convite'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Access changes preserve the global account and musical history. */}
            <AlertDialog
                open={!!accessMinister}
                onOpenChange={(open) => { if (!open && !accessSaving) setAccessMinister(null) }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{accessMinister?.access_state === 'suspended' ? 'Reativar acesso' : 'Suspender acesso'}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {accessMinister?.access_state === 'suspended'
                                ? `Reativar o acesso de ${accessMinister?.name} a esta igreja?`
                                : `Suspender o acesso de ${accessMinister?.name} somente nesta igreja? A conta, as músicas e o histórico serão preservados.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {accessError && <Alert variant="destructive"><AlertDescription role="alert">{accessError}</AlertDescription></Alert>}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={accessSaving}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={accessSaving}
                            onClick={(event) => { event.preventDefault(); void handleChangeAccess() }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {accessSaving ? 'Salvando...' : accessMinister?.access_state === 'suspended' ? 'Reativar acesso' : 'Suspender acesso'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
