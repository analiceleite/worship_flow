'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { selectedChurchFetch } from '@/lib/auth/client-context'
import type { FirstStep } from '@/lib/onboarding/rules'

// WF-26 "Primeiros passos": optional, resumable, computed from real data.
// Nothing blocks the church from being used, and the card disappears once complete.
export function FirstStepsCard() {
  const [steps, setSteps] = useState<FirstStep[] | null>(null)

  useEffect(() => {
    let active = true
    selectedChurchFetch('/api/onboarding/checklist')
      .then(async response => {
        if (!response.ok) return null
        const data = await response.json()
        return data.steps as FirstStep[]
      })
      .then(result => { if (active) setSteps(result) })
      .catch(() => { if (active) setSteps(null) })
    return () => { active = false }
  }, [])

  if (!steps || steps.every(step => step.done)) return null

  const doneCount = steps.filter(step => step.done).length

  return (
    <Card className="py-4" aria-label="Primeiros passos">
      <CardHeader className="pb-2">
        <h2 className="text-sm font-semibold">Primeiros passos</h2>
        <p className="text-xs text-muted-foreground">
          {doneCount} de {steps.length} concluídos. Você pode fazer isso no seu ritmo.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {steps.map(step => (
            <li key={step.id} className="flex items-center gap-2 text-sm">
              {step.done
                ? <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
                : <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />}
              <span className={step.done ? 'text-muted-foreground line-through' : ''}>{step.label}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
