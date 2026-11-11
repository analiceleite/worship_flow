import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ministerLoad, planTeamCopy, rolesInSameEvent, sortByLoad } from '../lib/schedule/montar-escala.ts'

// Testes das funções puras da tela Montar escala. Executados com o type stripping do Node.

type Minister = { id: string; name: string; avatar_url?: string | null }

const ana: Minister = { id: 'm-ana', name: 'Ana' }
const bruno: Minister = { id: 'm-bruno', name: 'Bruno' }
const carla: Minister = { id: 'm-carla', name: 'Carla' }

const roles = [
  { id: 'r-voz', name: 'Voz principal', category: 'vocal', display_order: 1 },
  { id: 'r-violao', name: 'Violão', category: 'instrumento', display_order: 2 },
  { id: 'r-bateria', name: 'Bateria', category: 'instrumento', display_order: 3 },
] as const

function assignment(id: string, roleId: string, date: string, type: 'thursday' | 'sunday', minister: Minister | null, isTrainee = false) {
  return {
    id, quarter_id: 'q1', role_id: roleId, minister_id: minister?.id ?? null,
    is_trainee: isTrainee, event_date: date, event_type: type, minister,
  }
}

function event(date: string, type: 'thursday' | 'sunday', assignments: ReturnType<typeof assignment>[], cancelled = false) {
  const filled = assignments.filter(item => item.minister_id).length
  return {
    key: `${date}_${type}`, date, type, assignments, control: undefined, rehearsal: undefined,
    total: assignments.length, filled, missing: [], cancelled,
  }
}

test('carga conta cultos distintos por pessoa e ignora cultos cancelados', () => {
  const data = {
    assignments: [
      assignment('a1', 'r-voz', '2026-12-06', 'sunday', ana),
      assignment('a2', 'r-violao', '2026-12-06', 'sunday', ana), // mesmo culto: conta uma vez
      assignment('a3', 'r-voz', '2026-12-10', 'thursday', ana),
      assignment('a4', 'r-voz', '2026-12-13', 'sunday', bruno),
      assignment('a5', 'r-voz', '2026-12-20', 'sunday', ana), // culto cancelado
    ],
    event_controls: [{ event_date: '2026-12-20', event_type: 'sunday', status: 'cancelled' }],
  } as never

  const load = ministerLoad(data)
  assert.equal(load.get('m-ana'), 2)
  assert.equal(load.get('m-bruno'), 1)
  assert.equal(load.get('m-carla'), undefined)
})

test('duplicidade no mesmo culto lista as outras funções, sem contar a vaga em edição', () => {
  const culto = event('2026-12-06', 'sunday', [
    assignment('a1', 'r-voz', '2026-12-06', 'sunday', ana),
    assignment('a2', 'r-violao', '2026-12-06', 'sunday', ana),
    assignment('a3', 'r-bateria', '2026-12-06', 'sunday', bruno),
  ])
  assert.deepEqual(rolesInSameEvent(culto, [...roles] as never, 'm-ana', 'a1'), ['Violão'])
  assert.deepEqual(rolesInSameEvent(culto, [...roles] as never, 'm-carla', 'a1'), [])
})

test('ordenação por carga coloca quem tem menos cultos primeiro e preserva a ordem nos empates', () => {
  const load = new Map([['m-ana', 3], ['m-bruno', 0], ['m-carla', 0]])
  const sorted = sortByLoad([{ id: 'm-ana' }, { id: 'm-carla' }, { id: 'm-bruno' }], load)
  assert.deepEqual(sorted.map(item => item.id), ['m-carla', 'm-bruno', 'm-ana'])
})

test('cópia no modo "empty" preenche só vagas abertas e mantém as preenchidas', () => {
  const source = event('2026-12-06', 'sunday', [
    assignment('s1', 'r-voz', '2026-12-06', 'sunday', ana),
    assignment('s2', 'r-violao', '2026-12-06', 'sunday', bruno, true),
    assignment('s3', 'r-bateria', '2026-12-06', 'sunday', null),
  ])
  const target = event('2026-12-13', 'sunday', [
    assignment('t1', 'r-voz', '2026-12-13', 'sunday', carla),
    assignment('t2', 'r-violao', '2026-12-13', 'sunday', null),
    assignment('t3', 'r-bateria', '2026-12-13', 'sunday', null),
  ])
  const preview = planTeamCopy(source, target, 'empty')
  assert.deepEqual(preview.fill.map(item => [item.assignment.id, item.ministerId, item.isTrainee]), [['t2', 'm-bruno', true]])
  assert.deepEqual(preview.replace, [])
  assert.deepEqual(preview.keep.map(item => item.id), ['t1', 't3'])
})

test('cópia no modo "replace" substitui vagas preenchidas com pessoa diferente', () => {
  const source = event('2026-12-06', 'sunday', [assignment('s1', 'r-voz', '2026-12-06', 'sunday', ana)])
  const target = event('2026-12-13', 'sunday', [assignment('t1', 'r-voz', '2026-12-13', 'sunday', carla)])
  const preview = planTeamCopy(source, target, 'replace')
  assert.deepEqual(preview.fill, [])
  assert.deepEqual(preview.replace.map(item => [item.assignment.id, item.ministerName]), [['t1', 'Ana']])
})

test('mesma pessoa na origem e no destino não gera alteração', () => {
  const source = event('2026-12-06', 'sunday', [assignment('s1', 'r-voz', '2026-12-06', 'sunday', ana)])
  const target = event('2026-12-13', 'sunday', [assignment('t1', 'r-voz', '2026-12-13', 'sunday', ana)])
  const preview = planTeamCopy(source, target, 'replace')
  assert.equal(preview.fill.length + preview.replace.length, 0)
  assert.deepEqual(preview.keep.map(item => item.id), ['t1'])
})

test('culto cancelado como origem ou destino não recebe cópia', () => {
  const source = event('2026-12-06', 'sunday', [assignment('s1', 'r-voz', '2026-12-06', 'sunday', ana)])
  const target = event('2026-12-13', 'sunday', [assignment('t1', 'r-voz', '2026-12-13', 'sunday', null)], true)
  const preview = planTeamCopy(source, target, 'empty')
  assert.equal(preview.fill.length, 0)
  assert.deepEqual(preview.keep.map(item => item.id), ['t1'])
})
