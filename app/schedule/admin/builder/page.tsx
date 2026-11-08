import { Suspense } from 'react'
import { ScheduleBuilder } from '@/components/schedule/builder/schedule-builder'

export default function ScheduleBuilderPage() {
  return <Suspense fallback={<div role="status" className="mx-auto max-w-7xl space-y-4 p-4"><p className="text-sm text-muted-foreground">Carregando escala…</p><div className="h-28 animate-pulse rounded-xl bg-muted" /><div className="h-64 animate-pulse rounded-xl bg-muted" /></div>}>
    <ScheduleBuilder />
  </Suspense>
}
