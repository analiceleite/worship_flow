const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const page = fs.readFileSync(path.join(root, 'app/schedule/admin/dashboard/page.tsx'), 'utf8')
const api = fs.readFileSync(path.join(root, 'app/api/schedule/admin/analytics/route.ts'), 'utf8')

test('sobrecarga usa 30% acima da média no marcador visual e na API', () => {
  assert.match(page, /const OVERLOAD_FACTOR = 1\.3/)
  assert.doesNotMatch(page, /avg \* 1\.6/)
  assert.match(api, /averageAssignmentsPerMinister \* 1\.3/)
})

test('pendências oferecem link para a escala com evento', () => {
  assert.match(page, /buildScheduleHref\(quarterId, \{ event \}\)/)
  assert.match(page, /ROUTES\.SCHEDULE_ADMIN_BUILDER/)
  assert.match(page, /params\.set\('event', `\$\{target\.event\.event_date\}_\$\{target\.event\.event_type\}`\)/)
})

test('resumo e KPIs vêm antes das ações; vagas em cultos passados ficam recolhidas', () => {
  const summary = page.indexOf('<SummaryLine')
  const kpis = page.indexOf('label="Cobertura geral"')
  const actions = page.indexOf('title="Ações"')
  assert.ok(summary > 0 && summary < kpis && kpis < actions, 'ordem: resumo, KPIs, ações')
  assert.match(page, /Vagas em cultos passados/)
  assert.match(page, /event\.event_date >= today|e\.event_date >= today/)
})

test('filtro por ministro existe no builder e é usado pelo dashboard', () => {
  const builder = fs.readFileSync(path.join(root, 'components/schedule/builder/schedule-builder.tsx'), 'utf8')
  assert.match(builder, /params\.get\('minister'\)/)
  assert.match(builder, /event\.assignments\.some\(item => item\.minister_id === minister\)/)
  assert.match(page, /ministerId: item\.minister_id/)
})

test('subutilizados aparece como KPI e a média é explicada por ministro', () => {
  assert.match(page, /label="Subutilizados"/)
  assert.match(page, /alocações por ministro/)
})

test('badges de status ficam visíveis em todos os tamanhos', () => {
  assert.doesNotMatch(page, /hidden sm:inline-flex/)
})

test('listas cortadas oferecem "Ver mais"', () => {
  assert.match(page, /function ExpandableList/)
  assert.doesNotMatch(page, /\.slice\(0, (8|10|16|20)\)/)
})

test('funções faltantes não são cortadas por truncate', () => {
  assert.doesNotMatch(page, /className="[^"]*\btruncate\b/)
})

test('erro sem dados é distinto de ausência de bimestre', () => {
  assert.match(page, /error && !analytics/)
  assert.match(page, /Tentar novamente/)
})
