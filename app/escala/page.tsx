'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Header } from '@/components/header'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import {
    CloudUpload,
    FileSpreadsheet,
    FileText,
    ExternalLink,
    CheckCircle2,
    AlertCircle,
    Music2,
} from 'lucide-react'

interface WorshipSchedule {
    id: string
    file_name: string
    storage_path: string
    mime_type: string | null
    uploaded_by: string | null
    created_at: string
    signedUrl: string
}

export default function EscalaPage() {
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [uploadSuccess, setUploadSuccess] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [isAdmin, setIsAdmin] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [schedule, setSchedule] = useState<WorshipSchedule | null>(null)

    const loadRole = useCallback(async () => {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: minister } = await supabase
            .from('ministers')
            .select('role')
            .eq('user_id', user.id)
            .single()
        if (minister?.role === 'admin') setIsAdmin(true)
    }, [])

    const loadSchedule = useCallback(async () => {
        try {
            setError(null)
            const response = await fetch('/api/schedule/current', { cache: 'no-store' })
            const body = await response.json()
            if (!response.ok) throw new Error(body.error || 'Não foi possível carregar a escala')
            setSchedule(body.schedule)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao carregar escala')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadRole()
        loadSchedule()
    }, [loadRole, loadSchedule])

    const processFile = async (file: File) => {
        try {
            setUploading(true)
            setUploadSuccess(false)
            setError(null)
            const formData = new FormData()
            formData.append('file', file)
            const response = await fetch('/api/schedule/upload', { method: 'POST', body: formData })
            const body = await response.json()
            if (!response.ok) throw new Error(body.error || 'Não foi possível enviar o arquivo')
            setUploadSuccess(true)
            await loadSchedule()
            setTimeout(() => setUploadSuccess(false), 3000)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro no upload da escala')
        } finally {
            setUploading(false)
        }
    }

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        await processFile(file)
        e.target.value = ''
    }

    const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault()
        setIsDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) await processFile(file)
    }

    const uploadedAt = useMemo(() => {
        if (!schedule?.created_at) return null
        return new Date(schedule.created_at).toLocaleString('pt-BR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
    }, [schedule?.created_at])

    const isPdf = schedule?.mime_type === 'application/pdf'
    const officeViewerUrl = schedule?.signedUrl
        ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(schedule.signedUrl)}`
        : null

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

                {/* Page heading */}
                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-foreground">Escala de Louvor</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Todos os ministros visualizam sempre o último arquivo enviado pelo admin.
                    </p>
                </div>

                {/* Error */}
                {error && (
                    <Alert variant="destructive" className="mb-6">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {/* Upload — admin only */}
                {isAdmin && (
                    <Card className="mb-6">
                        <CardHeader className="py-4">
                            <CardTitle className="text-base">Enviar Nova Escala</CardTitle>
                            <CardDescription>
                                Arraste um arquivo ou clique para selecionar. Máximo de 20 MB.
                            </CardDescription>
                        </CardHeader>

                        <CardContent>
                            <label
                                className={[
                                    'group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-all duration-150 mb-4',
                                    isDragging
                                        ? 'border-primary bg-primary/5 scale-[1.01]'
                                        : uploadSuccess
                                            ? 'border-green-500/50 bg-green-500/5'
                                            : uploading
                                                ? 'cursor-not-allowed border-border bg-muted/20 opacity-60'
                                                : 'border-border hover:border-primary/50 hover:bg-muted/40',
                                ].join(' ')}
                                onDragOver={(e) => { e.preventDefault(); if (!uploading) setIsDragging(true) }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                            >
                                {/* Icon */}
                                <div
                                    className={[
                                        'flex h-11 w-11 items-center justify-center rounded-xl border transition-colors duration-150',
                                        uploadSuccess
                                            ? 'border-green-500/30 bg-green-500/10 text-green-500'
                                            : uploading
                                                ? 'border-border bg-muted text-muted-foreground'
                                                : 'border-border bg-muted text-muted-foreground group-hover:border-primary/40 group-hover:bg-primary/5 group-hover:text-primary',
                                    ].join(' ')}
                                >
                                    {uploading ? (
                                        <Spinner className="h-5 w-5" />
                                    ) : uploadSuccess ? (
                                        <CheckCircle2 className="h-5 w-5" />
                                    ) : (
                                        <CloudUpload className="h-5 w-5" />
                                    )}
                                </div>

                                {/* Text */}
                                <div className="space-y-0.5">
                                    <p className="text-sm font-medium text-foreground">
                                        {uploading
                                            ? 'Enviando arquivo…'
                                            : uploadSuccess
                                                ? 'Escala atualizada com sucesso!'
                                                : isDragging
                                                    ? 'Solte o arquivo aqui'
                                                    : 'Clique ou arraste o arquivo aqui'}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {uploadSuccess
                                            ? 'A nova escala já está disponível para todos os ministros.'
                                            : 'Formatos aceitos: XLSX, XLS, CSV, PDF'}
                                    </p>
                                </div>

                                {/* Format chips */}
                                {!uploading && !uploadSuccess && (
                                    <div className="flex flex-wrap justify-center gap-1.5">
                                        {['XLSX', 'XLS', 'CSV', 'PDF'].map((fmt) => (
                                            <span
                                                key={fmt}
                                                className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                                            >
                                                {fmt}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <input
                                    type="file"
                                    className="hidden"
                                    accept=".xlsx,.xls,.csv,.pdf"
                                    onChange={handleUpload}
                                    disabled={uploading}
                                />
                            </label>
                        </CardContent>
                    </Card>
                )}

                {/* Schedule viewer */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-20">
                        <Spinner className="h-7 w-7" />
                        <p className="text-sm text-muted-foreground">Carregando escala…</p>
                    </div>
                ) : !schedule ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
                                <Music2 className="h-6 w-6" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-foreground">Nenhuma escala disponível</p>
                                <p className="text-xs text-muted-foreground">
                                    {isAdmin
                                        ? 'Envie o primeiro arquivo usando o painel acima.'
                                        : 'O admin ainda não publicou a escala. Volte em breve.'}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="overflow-hidden">
                        {/* File meta + action */}
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <div
                                    className={[
                                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                                        isPdf
                                            ? 'border-red-500/20 bg-red-500/10 text-red-500'
                                            : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500',
                                    ].join(' ')}
                                >
                                    {isPdf
                                        ? <FileText className="h-4 w-4" />
                                        : <FileSpreadsheet className="h-4 w-4" />}
                                </div>

                                <div className="min-w-0">
                                    <p
                                        className="truncate text-sm font-medium text-foreground"
                                        title={schedule.file_name}
                                    >
                                        {schedule.file_name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Atualizado em {uploadedAt}
                                    </p>
                                </div>
                            </div>

                            <Button asChild size="sm">
                                <a href={schedule.signedUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                    Abrir arquivo
                                </a>
                            </Button>
                        </div>

                        {/* Embedded viewer */}
                        <div className="bg-muted/20">
                            {isPdf ? (
                                <iframe
                                    src={schedule.signedUrl}
                                    title="Escala de louvor"
                                    className="h-[72vh] w-full border-none block"
                                />
                            ) : (
                                <iframe
                                    src={officeViewerUrl ?? undefined}
                                    title="Visualização da escala"
                                    className="h-[72vh] w-full border-none block"
                                />
                            )}
                        </div>
                    </Card>
                )}
            </main>
        </div>
    )
}