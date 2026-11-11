const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Verificação estática das regras de interface da tela Montar escala (SPEC/PLAN montar-escala-admin).
// Inspeção de código não substitui validação renderizada em navegador.

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const builder = read('components/schedule/builder/schedule-builder.tsx')
const header = read('components/schedule/builder/schedule-builder-header.tsx')
const editor = read('components/schedule/builder/schedule-event-editor.tsx')
const picker = read('components/schedule/builder/assignment-picker.tsx')
const copy = read('components/schedule/builder/copy-team-sheet.tsx')

test('seletor ordena por carga, mostra cultos no período e sinaliza duplicidade sem bloquear', () => {
  assert.match(picker, /sortByLoad\(options, load\)/)
  assert.match(picker, /countLabel\(load\.get\(option\.id\)/)
  assert.match(picker, /Já escalado neste culto/)
  assert.doesNotMatch(picker, /disabled=\{[^}]*sameEvent/)
  assert.match(editor, /rolesInSameEvent\(event, data\.roles, ministerId, assignmentId\)/)
})

test('cópia de equipe: prévia no componente, salvamento por vaga pelo fluxo existente', () => {
  assert.match(copy, /planTeamCopy\(source, event, mode\)/)
  assert.doesNotMatch(copy, /fetch\(|selectedChurchFetch/)
  assert.match(editor, /CopyTeamSheet/)
  assert.match(editor, /for \(const \[index, item\] of items\.entries\(\)\)/)
  assert.match(editor, /await onSaveAssignment\(item\.assignment/)
  assert.match(editor, /Copiar equipe de outro culto/)
})

test('cópia padrão é "Só vagas em aberto"; substituição tem rótulo próprio', () => {
  assert.match(copy, /useState<CopyMode>\('empty'\)/)
  assert.match(copy, /Só vagas em aberto/)
  assert.match(copy, /Substituir tudo/)
})

test('grade no celular só aparece com filtro de tipo; no desktop continua disponível', () => {
  assert.match(builder, /const gridOnMobile = view === 'grid' && type !== 'all'/)
  assert.match(builder, /gridOnMobile \? 'block' : 'hidden lg:block'/)
  assert.match(builder, /type === 'all' \? 'hidden lg:flex' : 'flex'/)
})

test('filtros são recolhíveis no celular com resumo visível e id referenciado por aria-controls', () => {
  assert.match(builder, /aria-controls="builder-filters"/)
  assert.match(builder, /id="builder-filters"/)
  assert.match(builder, /Filtros: \{filterSummary\}/)
  assert.match(builder, /aria-expanded=\{filtersOpen\}/)
})

test('textos de salvamento refletem o estado real', () => {
  assert.doesNotMatch(builder, /'Salvamento automático'/)
  assert.match(builder, /Alterações salvas automaticamente/)
  assert.match(builder, /Há alterações não salvas/)
})

test('cabeçalho móvel é compacto e mantém o rótulo do seletor acessível', () => {
  assert.match(header, /sr-only sm:not-sr-only/)
  assert.match(header, /sm:hidden/)
  assert.match(header, /hidden text-sm text-muted-foreground sm:block/)
})
