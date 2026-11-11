# PLAN — Melhorias na tela Montar escala (administrador)

**SPEC:** [sdd/spec/SPEC-montar-escala-admin.md](../spec/SPEC-montar-escala-admin.md)
**Branch sugerida:** `feat/montar-escala-admin` (a partir de `main`)
**Data:** 2026-11-11

## Escopo desta entrega

Implementa as cinco decisões aprovadas (SPEC §6) e os requisitos §5.1 a §5.6. Não altera publicação, cancelamento, notificações, calendário, permissões nem regras de conflito entre cultos.

Arquivos prováveis:

- `components/schedule/builder/schedule-builder.tsx`: visualização, filtros, cabeçalho móvel, estado de salvamento.
- `components/schedule/builder/schedule-builder-header.tsx`: cabeçalho compacto no celular.
- `components/schedule/builder/assignment-picker.tsx`: carga no período e sinalização de duplicidade no mesmo culto.
- `components/schedule/builder/schedule-event-editor.tsx`: ação "Copiar equipe de…".
- `components/schedule/builder/copy-team-sheet.tsx` (novo): prévia e confirmação da cópia.
- `lib/schedule/builder-model.ts`: funções puras de contagem de carga e de duplicidade, testáveis sem navegador.
- `tests/montar-escala.test.cjs` (novo): verificação estática e das funções puras.
- `package.json`: script `test:montar-escala`.

Sem mudança em `app/api/**` nem em `scripts/*.sql`. A cópia reutiliza `POST/PATCH /api/schedule/assignment` uma vez por vaga.

## Fatos verificados antes deste plano

- **Conflito entre cultos já é bloqueado no servidor.** `scripts/043_wf32_atomic_rules_and_notifications.sql` (`wf32_check_event`) impede que a mesma pessoa esteja em cultos com janelas sobrepostas, salvo override de administrador com motivo. O seletor deve continuar mostrando esse conflito pelo fluxo atual (diálogo de conflito), sem duplicar a regra.
- **Mesma pessoa em duas funções do mesmo culto não é bloqueada no servidor.** A função compara apenas assignments de eventos diferentes. Conforme a decisão 3 da SPEC, o seletor sinaliza, não bloqueia.

## Decisões de implementação (escolhas minhas, reversíveis)

| Tema | Decisão | Fundamento |
|---|---|---|
| Carga no seletor | Contagem de cultos do período atual em que a pessoa está escalada, a partir de `currentData.assignments` já carregado. Não faz chamada extra. | SPEC §5.1, decisão 4 |
| Duplicidade no mesmo culto | Marca "Já escalado neste culto (função X)" no resultado; sem bloqueio. | SPEC §5.1, decisão 3 |
| Ordenação do seletor | Menos cultos no período primeiro, mantendo a busca por nome. A ordenação não remove ninguém da lista. | SPEC §5.1 |
| Cópia de equipe | Lista cultos do período com equipe; prévia mostra vagas que serão preenchidas, vagas mantidas e vagas que seriam substituídas. Padrão copia só vagas em aberto. "Substituir tudo" fica como ação secundária com confirmação. | SPEC §5.2, decisão 2 |
| Execução da cópia | Sequencial, uma vaga por vez, usando o fluxo de salvamento existente (estado por função e "Tentar novamente"). Se uma vaga falhar, as anteriores permanecem salvas e a falha é mostrada. | SPEC §5.2 |
| Conflito na cópia | Conflito entre cultos aparece pelo diálogo já existente. A cópia para numa vaga com conflito e aguarda decisão. | SPEC §5.2 |
| Visualização | Agenda com editor é o padrão. Alternância Agenda/Grade visível no desktop. No celular, grade aparece só com o filtro de tipo em Quintas ou Domingos; caso contrário, o botão fica oculto com texto explicativo. | SPEC §5.3, decisão 1 |
| Grade no celular | Rolagem horizontal com primeira coluna fixa; alvos de toque mínimos de 44 px. | SPEC §5.3, WF-16 |
| Cabeçalho móvel | Período e status em uma linha; troca de período em sheet; filtros em um controle recolhível com resumo visível ("Filtros: Com pendências · Quintas"). | SPEC §5.4, decisão 5 |
| Filtros no desktop | Sempre visíveis em uma linha. | SPEC §5.4, decisão 5 |
| Textos de salvamento | "Alterações salvas automaticamente" quando não há pendência; "Há alterações não salvas" quando há falha ou salvamento em andamento. | SPEC §5.5 |
| Rótulos de filtro | Padronizar "Todos", "Com pendências", "Cancelados" e "Quintas e domingos", "Quintas", "Domingos" em um único padrão. | SPEC §5.5 |

## Ordem de implementação

Cada etapa é verificável isoladamente e deixa a tela funcional.

1. **Funções puras e testes** (`lib/schedule/builder-model.ts`): contagem de carga no período; detecção de duplicidade no mesmo culto; cálculo da prévia da cópia (preencher, manter, substituir). Testes com `node:test`.
2. **Seletor de integrantes** (`assignment-picker.tsx`): carga, marcação de duplicidade e ordenação. Sem bloqueio.
3. **Cópia de equipe** (`copy-team-sheet.tsx` e `schedule-event-editor.tsx`): prévia, confirmação, execução sequencial e tratamento de falha.
4. **Visualização** (`schedule-builder.tsx`): grade visível no desktop; regra de celular por filtro de tipo.
5. **Cabeçalho móvel e filtros** (`schedule-builder.tsx`, `schedule-builder-header.tsx`): linha compacta, sheet de período e filtros recolhíveis com resumo.
6. **Textos de estado e rótulos**: revisar mensagens do rodapé e dos filtros.
7. **Testes estáticos e script `test:montar-escala`**.
8. **Verificação**: testes existentes, build e validação renderizada.

## Testes

- `pnpm test:montar-escala`: funções puras (carga, duplicidade, prévia da cópia) e verificação estática (ex.: "Copiar equipe" usa `/api/schedule/assignment`; grade no celular depende do filtro de tipo; sem bloqueio no seletor).
- `pnpm test:schedule-builder` (6 testes): deve continuar passando.
- `pnpm test:wf15` (15 testes): padrões de erro e recuperação sem regressão.
- `pnpm test:wf36` (9 testes): sem regressão no dashboard, que usa o filtro `?minister=`.

## Verificação

1. Os testes acima passam.
2. `pnpm build` passa.
3. `pnpm lint` falha por ausência de ESLint no projeto (pré-existente; fora de escopo).
4. Validação renderizada em desktop e 360 CSS px, por teclado, com dados sintéticos. Registrar navegador, viewport, evidências e limitações em `sdd/plan/validation-montar-escala-admin.md` ao concluir. Testes manuais não executados ficam marcados como pendentes.

## Perguntas em aberto (não bloqueiam o início)

- Se o servidor passar a bloquear duplicidade no mesmo culto no futuro, o seletor já terá a sinalização pronta e a regra precisará ser revista.
- Destino de "Ver escala" a partir do dashboard continua sem filtro por ministro, se a WF-36 ainda não tiver sido aceita.
- Nomes exatos dos rótulos de filtro dependem de revisão da responsável.
