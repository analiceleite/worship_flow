import { NextResponse } from 'next/server'

export function scheduleMutationError(error: { message: string; details?: string }, allowOverride = false) {
  if (error.message.includes('WF32_SCHEDULE_CONFLICT')) {
    let conflict = null
    try { conflict = JSON.parse(error.details ?? 'null') } catch { /* Optional diagnostic only. */ }
    return NextResponse.json({ error: 'Este integrante já está escalado em um evento com horário conflitante.', conflict, override_allowed: allowOverride }, { status: 409 })
  }
  if (error.message.includes('WF32_FORBIDDEN')) {
    return NextResponse.json({ error: 'Somente administradores ou o líder ativo e escalado podem executar esta operação.' }, { status: 403 })
  }
  if (error.message.includes('WF32_ASSIGNMENT_NOT_FOUND')) {
    return NextResponse.json({ error: 'Célula da escala não encontrada nesta igreja.' }, { status: 404 })
  }
  if (/WF32_(INVALID_|IMMUTABLE_|AMBIGUOUS_)/.test(error.message) || /^(22|23)/.test((error as { code?: string }).code ?? '')) {
    return NextResponse.json({ error: 'Dados inválidos: confira o evento, integrante ativo, função e horários. A identidade da célula não pode ser alterada.' }, { status: 400 })
  }
  return NextResponse.json({ error: 'Não foi possível salvar a escala.' }, { status: 500 })
}
