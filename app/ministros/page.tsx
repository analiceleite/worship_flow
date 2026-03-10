'use client'

import { useEffect, useState, useCallback } from 'react'
import { Minister } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/header'
import { MinisterForm } from '@/components/minister-form'
import { DeleteDialog } from '@/components/delete-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Search, Users, Pencil, Trash2 } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'

export default function MinistrosPage() {
  const [ministers, setMinisters] = useState<Minister[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingMinister, setEditingMinister] = useState<Minister | null>(null)
  const [deletingMinister, setDeletingMinister] = useState<Minister | null>(null)

  const fetchMinisters = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('ministers')
      .select('*')
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

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao excluir ministro')
      }

      await fetchMinisters()
    } catch (error: any) {
      console.error('Erro ao excluir ministro:', error)
      alert(error.message || 'Erro ao excluir ministro')
    }
  }

  const filteredMinisters = ministers.filter(
    (minister) =>
      minister.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      minister.instrument.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const groupedMinisters = filteredMinisters.reduce(
    (acc, minister) => {
      const instrument = minister.instrument || 'Outros'
      if (!acc[instrument]) {
        acc[instrument] = []
      }
      acc[instrument].push(minister)
      return acc
    },
    {} as Record<string, Minister[]>
  )

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-8 w-8" />
          </div>
        ) : filteredMinisters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 rounded-full bg-muted p-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-1 text-lg font-medium text-foreground">
              {searchQuery ? 'Nenhum ministro encontrado' : 'Nenhum ministro cadastrado'}
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              {searchQuery
                ? 'Tente buscar por outro termo.'
                : 'Comece adicionando seu primeiro ministro.'}
            </p>
            {!searchQuery && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Adicionar Ministro
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedMinisters)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([instrument, instrumentMinisters]) => (
                <div key={instrument}>
                  <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Badge variant="secondary">{instrument}</Badge>
                    <span className="text-sm font-normal text-muted-foreground">
                      ({instrumentMinisters.length})
                    </span>
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {instrumentMinisters.map((minister) => (
                      <Card key={minister.id} className="transition-all hover:shadow-md">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate font-medium text-foreground">
                              {minister.name}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {minister.instrument}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
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
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setDeletingMinister(minister)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </main>

      <MinisterForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingMinister(null)
        }}
        minister={editingMinister}
        onSuccess={fetchMinisters}
      />

      <DeleteDialog
        open={!!deletingMinister}
        onOpenChange={(open) => !open && setDeletingMinister(null)}
        title="Excluir Ministro"
        description={`Tem certeza que deseja excluir "${deletingMinister?.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={handleDeleteMinister}
      />
    </div>
  )
}
