# PLAN — WF-36: Dashboard administrativo de alocação (celular)

**SPEC:** [sdd/spec/SPEC-WF-36-dashboard-admin-mobile.md](../spec/SPEC-WF-36-dashboard-admin-mobile.md)
**Branch:** `feat/wf-36-dashboard-admin-mobile`
**Data:** 2026-11-11

## Escopo desta entrega

Implementa somente as decisões aprovadas (SPEC §5) e os requisitos de §6 que não dependem de decisão pendente. Arquivos afetados:

- `app/schedule/admin/dashboard/page.tsx` — única tela alterada.
- `tests/wf36-dashboard.test.cjs` — verificação estática das regras (novo).
- `package.json` — script `test:wf36`.

Sem mudança em API, regra de negócio do backend, permissões ou em outras telas.

## Decisões de implementação (escolhas minhas, reversíveis)

| Tema | Decisão | Fundamento |
|---|---|---|
| Limite de sobrecarga | Marcador do gráfico passa de `média × 1,6` para `média × 1,3`; API (`> média × 1,3`) e textos (+30%) já estavam corretos. | SPEC §5.1 |
| Subutilização | Mantida em `< média × 0,7` (API). | SPEC §5.1 |
| Hierarquia | Bloco "Alertas de Sobrecarga" + "Eventos com Lacunas" sobe logo após o cabeçalho do bimestre, antes dos KPIs. | SPEC §5.2 |
| Encaminhamento | Cada evento com lacuna e cada alerta de sobrecarga linkam para `/schedule/admin/builder?quarter=<id>` e, para evento, `&event=<data>_<tipo>` (o builder já aceita ambos). | SPEC §5.3 |
| Destino de sobrecarga | Sem filtro por ministro no builder; o link leva à escala do bimestre. Limitação registrada. | Inspeção de `schedule-builder.tsx` |
| Badges | `Sobrecarregado` / `Subutilizado` sempre visíveis (remove `hidden sm:inline-flex`). | SPEC §5.4 |
| Listas | Componente `ExpandableList` com "Ver mais" / "Ver menos" em todas as listas cortadas. Os alertas no topo mostram 3 itens inicialmente. | SPEC §5.5 |
| Truncamento | Remove `truncate` em nomes, eventos e funções faltantes (texto completo quebra linha). | SPEC §6.2 |
| Estado de erro | Falha sem dados mostra cartão de erro com "Tentar novamente", distinto de "Nenhum bimestre". | SPEC §6.3 |
| Bimestre sem alocações | Aviso textual no cabeçalho. | SPEC §6.3 |
| Abas de filtro | Semântica `tablist`/`tab` com `aria-selected`. | SPEC §6.3 |

## Perguntas ainda em aberto (não implementadas)

- Falha parcial (ex.: bimestres carregam mas indicadores não): tratada apenas como erro geral.
- Destino exato da sobrecarga (filtrar o builder por ministro exigiria mudança na tela de escala).
- Validação renderizada em 360 CSS px, teclado e leitor de tela: não executada nesta sessão; registrar no aceite.

## Verificação

1. `pnpm test:wf36` (verificação estática das regras).
2. `pnpm lint`.
3. `pnpm build`.
4. Revisão visual em 360 px e desktop: pendente, a ser registrada no validation.
