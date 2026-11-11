'use client'

import { PAGE_WIDTH } from '@/lib/page-layout'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { groupReleaseNotesByVersion, type ReleaseNote } from '@/lib/release-notes'

type ResponseData = { notes: ReleaseNote[]; unreadCount: number }

export default function ReleaseNotesPage() {
  const [data, setData] = useState<ResponseData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/release-notes')
      .then(async (response) => {
        if (!response.ok) throw new Error('failed')
        return response.json() as Promise<ResponseData>
      })
      .then((result) => {
        if (!active) return
        setData(result)
        // The GET response is a snapshot; notes published afterward are not marked read.
        void fetch('/api/release-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteIds: result.notes.map((note) => note.id) }) })
          .then((response) => {
            if (response.ok) window.dispatchEvent(new Event('release-notes-read'))
          })
          .catch(() => {})
      })
      .catch(() => active && setError(true))
    return () => { active = false }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <main className={`${PAGE_WIDTH} py-6`}>
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Novidades</h1>
          <p className="mt-2 text-sm text-muted-foreground">Melhorias recentes no Worship Flow.</p>
        </header>
        {!data && !error && <p role="status" className="text-sm text-muted-foreground">Carregando novidades…</p>}
        {error && <div role="alert" className="space-y-3"><p className="text-sm text-destructive">Não foi possível carregar as novidades.</p><Button variant="outline" onClick={() => window.location.reload()}>Tentar novamente</Button></div>}
        {data?.notes.length === 0 && <p className="text-sm text-muted-foreground">Ainda não há novidades publicadas.</p>}
        {data && data.notes.length > 0 && <div className="space-y-8">{groupReleaseNotesByVersion(data.notes).map((group) => (
          <section key={group.version} aria-label={`Versão ${group.version}`} className="space-y-4">
            <h2 className="border-b border-border pb-2 text-lg font-semibold">Versão {group.version}</h2>
            {group.notes.map((note) => (
          <Card key={note.id}>
            <CardHeader>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle className="text-base"><h3>{note.title}</h3></CardTitle>
                <time className="text-sm text-muted-foreground" dateTime={note.date}>{new Date(`${note.date}T00:00:00`).toLocaleDateString('pt-BR')}</time>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-foreground">{note.summary}</p>
              {note.href && <Button asChild variant="link" className="h-auto p-0"><Link href={note.href}>Saiba mais</Link></Button>}
            </CardContent>
          </Card>
            ))}
          </section>
        ))}</div>}
      </main>
    </div>
  )
}
