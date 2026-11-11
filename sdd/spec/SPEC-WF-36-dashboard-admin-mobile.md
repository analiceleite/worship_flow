# SPEC — WF-36: Melhorar dashboard administrativo de alocação, com foco em celular

**Status:** SPEC inicial; análise funcional e decisões de experiência pendentes de acordo com a responsável

**PBI:** [WF-36 — Melhorar dashboard administrativo de alocação, com foco em celular](https://github.com/analiceleite/worship_flow/issues/44)

**Branch:** `feat/wf-36-dashboard-admin-mobile`

**Prioridade:** P2 — Média

**Área:** UX e acessibilidade · Melhoria

**Data:** 2026-11-11

## 1. Contexto e problema

O dashboard administrativo de alocação reúne indicadores de cobertura, vagas abertas, sobrecarga, aprendizes, distribuição por função e ministro e eventos com lacunas. A inspeção estática inicial sugere oportunidade de melhorar a priorização das informações e a passagem de alertas para ações operacionais, sobretudo em telas móveis.

Esta SPEC não parte de pesquisa com usuários nem afirma frequência ou impacto em produção. A análise será baseada na implementação disponível, em recomendações técnicas e de experiência, e nas decisões acordadas com a responsável pelo produto. Recomendações e hipóteses devem ser identificadas como tais, não como evidência de uso real.

**Pessoas impactadas (escopo esperado):** administradores que consultam e usam os indicadores de alocação, inclusive em dispositivos móveis. Frequência e impacto não foram medidos.

## 2. Evidências técnicas iniciais

As referências são pontos de partida para inspeção; devem ser reconfirmadas antes de qualquer alteração.

| Local | Observação inicial | Natureza |
|---|---|---|
| `app/schedule/admin/dashboard/page.tsx` | Exibe KPIs, cobertura por função, carga por ministro, alertas de sobrecarga, eventos com lacunas, filtros e distribuição por ministro. | Fato observado no código |
| `app/schedule/admin/dashboard/page.tsx` | Os alertas de sobrecarga e de eventos com lacunas são apresentados como conteúdo informativo; não há ação de navegação visível nesses itens no trecho atual. | Fato observado no código; confirmar fluxo e contexto de uso |
| `app/schedule/admin/dashboard/page.tsx` | A tela possui alguns layouts adaptáveis, por exemplo grade de KPIs em duas colunas e gráficos empilhados antes do breakpoint `lg`. Isso, isoladamente, não comprova usabilidade em celular. | Fato observado no código |
| `app/schedule/admin/dashboard/page.tsx` e `app/api/schedule/admin/analytics/route.ts` | Há aparente divergência entre o limite descrito como +30%, o marcador do gráfico em média × 1,6 e a classificação da API acima de média × 1,3. | Fato técnico a investigar; regra de produto ainda deve ser confirmada |
| Interface renderizada em navegador/dispositivo | Legibilidade, contraste efetivo, rolagem, dimensões de alvos e comportamento em larguras móveis ainda precisam de validação visual. | Validação pendente |

Nenhum dos itens acima demonstra ocorrência em produção, dificuldade relatada por usuários ou frequência observada.

## 3. Objetivos

- Avaliar se a tela ajuda a pessoa administradora a entender a situação da escala e priorizar o próximo passo.
- Melhorar a organização visual, a legibilidade e a utilização em celular, preservando informações essenciais.
- Verificar se alertas e indicadores permitem alcançar o contexto onde uma correção operacional pode ser feita; propor mudanças de fluxo para aprovação antes de implementá-las.
- Confirmar e comunicar corretamente as regras dos indicadores, especialmente sobrecarga.
- Separar fatos observáveis no código, inferências, recomendações e decisões aprovadas pela responsável.
- Não depender de disponibilidade de usuários reais para análise ou aceite desta entrega.

## 4. Escopo e limites

**Incluído:** análise funcional e visual do dashboard administrativo de alocação; hierarquia e agrupamento de informação; leitura de KPIs, alertas, filtros e listas; avaliação de navegação para resolução de lacunas; responsividade e toque em telas móveis; estados de carregamento, erro e ausência de dados; acessibilidade básica por teclado, foco e semântica; verificação da consistência das explicações e dos cálculos de sobrecarga.

**Incluído na revisão de 2026-11-11:** filtro por ministro no builder de escala (`components/schedule/builder/schedule-builder.tsx`), somente leitura de URL; sem alteração de dados ou regras.

**Fora de escopo:** pesquisa ou testes com usuários reais; alegar evidência de uso baseada em recomendação; mudanças em outras telas sem necessidade demonstrada; alteração de regras de negócio, permissões ou ações operacionais sem acordo explícito; redesign geral da aplicação; release ou deploy.

Mudanças que alterem decisões de produto, critérios de escala ou comportamento operacional exigem acordo explícito com a responsável antes da implementação. A análise e sugestões nesta SPEC não constituem essa aprovação.

## 5. Decisões acordadas

Aprovadas pela responsável em 2026-11-11:

1. **Sobrecarga:** o limite é **30% acima da média** de alocações por ministro. Textos, classificação da API, legenda e marcador visual devem usar essa mesma regra. Subutilização permanece como definida pela API (30% abaixo da média) até nova decisão.
2. **Hierarquia:** eventos com vagas abertas e alertas de sobrecarga aparecem **no topo**, antes dos indicadores gerais.
3. **Encaminhamento:** eventos com pendências devem oferecer acesso à **escala correspondente**. Detalhe a ser especificado no plano: abrir o evento já no contexto da pendência.
4. **Celular:** os badges “Sobrecarregado” e “Subutilizado” permanecem visíveis em todos os tamanhos de tela.
5. **Listas:** itens além dos exibidos inicialmente são acessados por **“Ver mais”**.

Revisão de frontend aprovada pela responsável em 2026-11-11 (todas as sugestões):

6. **Resumo:** uma linha no topo com vagas em aberto, cultos afetados, sobrecarregados e cobertura, com link para a primeira pendência.
7. **Lacunas por tempo:** eventos com lacuna **a partir de hoje** aparecem na lista principal; cultos passados com lacuna ficam em bloco recolhido “Lacunas em cultos passados”, sem sumir da tela.
8. **Equipe:** “Carga por Ministro” e “Distribuição por Ministro” são fundidas em uma única lista, com barra, contagem, status e link para as escalas do ministro.
9. **Seções secundárias:** “Cobertura por Função” inicia recolhida em telas móveis; “Resumo por Evento” e “Equipe” iniciam abertas.
10. **Clareza:** a barra visual de sobrecarga com escala arbitrária é removida (permanece o percentual); termos padronizados (“alocações” para ministros, “vagas” para posições); média explicada como “por ministro”; faixas de cobertura (meta 80%, alerta abaixo de 60%) explicitadas.
11. **Indicador:** o KPI “Aprendizes” dá lugar a “Subutilizados” (regra da API, 30% abaixo da média); aprendizes passam a constar no cabeçalho da lista de equipe.
12. **Ação de sobrecarga:** o builder de escala aceita filtro por ministro (`?minister=<id>`), usado pelos alertas de sobrecarga e pelos ministros da lista.

Reorganização de layout aprovada pela responsável em 2026-11-11:

13. **Estrutura em três faixas no desktop:** (a) resumo e KPIs; (b) “Ações” (sobrecarga e cultos futuros com vagas em aberto) ao lado de “Equipe e carga”, com alturas iguais; (c) tabela de cultos ao lado de “Cobertura por Função”. No celular, as mesmas informações aparecem empilhadas, com a lista de cultos no lugar da tabela.
14. **Pronto para publicar:** não há regra de bloqueio nem indicador de prontidão. Vagas em aberto são esperadas, pois o ministério ainda não tem pessoas suficientes para todas as posições.
15. **Ministros sem escala:** aparecem como dado informativo na seção de equipe (lista de nomes), sem tratamento de alerta nem ação obrigatória.

**Ponto a confirmar:** a decisão 2 (§5) pede que alertas de sobrecarga e lacunas fiquem **antes dos indicadores gerais**; a decisão 13 coloca resumo e KPIs na primeira faixa, com as ações abaixo. A implementação segue a decisão 13. O resumo do topo já traz sobrecarga e vagas em aberto. Se a decisão 2 valer literalmente, a faixa de ações deve subir acima dos KPIs.

Decisões de implementação decorrentes (escolhas minhas, reversíveis):
- Vagas em aberto deixam de usar cor de alerta; ficam em tom neutro, pois são esperadas.
- O KPI “Vagas em aberto” considera apenas cultos futuros, igual ao resumo e à seção de ações, evitando dois números diferentes para a mesma pergunta.
- Sobrecarga mantém o tom de alerta, por ser um desvio de distribuição.

Perguntas que continuam em aberto:

- Qual deve ser a experiência quando não há bimestre, não há alocações, ocorre falha parcial ou o carregamento está em andamento?
- Quais limitações de validação em dispositivos e tecnologias assistivas precisam ser registradas no aceite?
- Qual é o destino exato do encaminhamento à escala: a tela de escala com o evento selecionado ou outro contexto?

## 6. Requisitos de experiência

### 6.1. Hierarquia e compreensão

- A página deve identificar claramente o contexto analisado e o período selecionado.
- Valores, unidades, períodos e critérios dos indicadores devem ser compreensíveis sem depender apenas de cor ou de conhecimento implícito.
- Alertas devem comunicar o problema e sua gravidade de forma textual; não apresentar estados distintos apenas com cor.
- Eventos com vagas abertas e alertas de sobrecarga aparecem no topo, antes dos indicadores gerais (decisão 2).

### 6.2. Uso em celular

- A interface deve permanecer utilizável em viewport de 360 CSS px, sem rolagem horizontal indevida nem perda de informação ou ação essencial.
- Filtros, seleção de período, atualização e demais controles devem continuar alcançáveis por toque e ter área interativa confortável.
- Conteúdo extenso deve quebrar ou ser apresentado de forma que nomes, datas, indicadores e ações permaneçam identificáveis; funções faltantes de um evento não podem ser cortadas por `truncate` sem acesso ao texto completo.
- Os badges “Sobrecarregado” e “Subutilizado” são visíveis em todos os tamanhos de tela (decisão 4).
- Listas com corte visual oferecem “Ver mais” (decisão 5).
- Validar densidade, ordem vertical, rolagem e interação em navegador; classes responsivas no código não substituem validação renderizada.

### 6.3. Estados e acessibilidade

- Distinguir carregamento, erro, ausência real de dados e resultado vazio de filtro.
- Erros devem explicar o que ocorreu e oferecer recuperação quando aplicável, sem se confundir com ausência de dados.
- Controles devem ter nome, semântica, estado e foco perceptível; filtros devem ser operáveis por teclado.
- Contraste, foco e estados relevantes devem ser revisados na interface renderizada. Limitações não verificadas devem permanecer explicitamente pendentes.

### 6.4. Integridade dos indicadores

- Critério, texto explicativo, classificação da API e representação visual de sobrecarga devem corresponder à regra acordada.
- Se média, limiar e carga individual forem mostrados em conjunto, cada elemento deve ter rótulo/legenda não ambíguos.
- A regra de sobrecarga é 30% acima da média (decisão 1). Texto, classificação da API, legenda e marcador visual devem refletir essa regra; hoje o marcador usa média × 1,6 e a legenda diz +30%, o que precisa ser corrigido.

## 7. Critérios de aceite

- [ ] A análise descreve as principais informações, decisões, ações e limitações atuais, com referências ao código.
- [ ] Fatos técnicos, hipóteses e recomendações estão diferenciados; nenhuma conclusão é apresentada como pesquisa com usuários.
- [ ] Recomendações e mudanças de experiência estão priorizadas e acordadas com a responsável antes de implementar alterações de fluxo.
- [ ] A tela foi revisada em viewport de 360 CSS px e em desktop; conteúdo e controles essenciais permanecem utilizáveis sem rolagem horizontal indevida.
- [ ] Indicadores, alertas, filtros e estados são compreensíveis e operáveis por toque e teclado, sem depender apenas de cor.
- [ ] Carregamento, erro, ausência de dados e ausência de resultados filtrados são diferenciáveis e oferecem orientação apropriada.
- [ ] A regra de sobrecarga (30% acima da média) é aplicada de forma consistente em textos, classificação da API, legenda e marcador visual.
- [ ] Badges “Sobrecarregado” e “Subutilizado” aparecem em todos os tamanhos de tela.
- [ ] Eventos com vagas abertas e alertas de sobrecarga aparecem no topo, e cada pendência oferece acesso à escala correspondente.
- [ ] Listas cortadas oferecem “Ver mais”.
- [ ] Verificações automatizadas pertinentes passam; testes manuais não executados e limitações de ambiente/dispositivo são registrados sem serem declarados como concluídos.
- [ ] Nenhuma regra de negócio, permissão ou ação operacional foi introduzida sem aprovação explícita.

## 8. Validação

Usar dados sintéticos ou não sensíveis. Revisar a renderização em desktop e viewport móvel de 360 CSS px; percorrer filtros e controles por teclado; conferir foco, contraste, estados de carregamento/erro/vazio e a correspondência entre a API e os indicadores exibidos. Registrar navegador, viewport, evidências e limitações. Inspeção estática não equivale a teste renderizado, e recomendação não equivale a feedback de usuários.

Executar os comandos de verificação disponíveis e pertinentes ao código alterado, confirmando seus nomes no `package.json`. Não marcar validação manual, leitor de tela ou dispositivo como concluídos sem execução efetiva.

## 9. Relações e dependências

- [WF-23 — Corrigir indicadores de carga e tornar limites do dashboard explícitos](https://github.com/analiceleite/worship_flow/issues/19): relacionada; coordenar a consistência e o significado dos limites de distribuição, sem presumir dependência obrigatória.
- [WF-16 — Corrigir barreiras de acessibilidade e operação por toque](https://github.com/analiceleite/worship_flow/issues/12): relacionada; reutilizar princípios de acessibilidade e toque sem ampliar esta entrega para outras telas.
- Nenhuma dependência técnica obrigatória foi identificada inicialmente.

## 10. Registro de decisões

- **2026-11-11 — Criação:** SPEC inicial aberta para a WF-36 a partir da issue e da inspeção estática do dashboard e da API de analytics. Não houve pesquisa com usuários, alteração de regra de produto, implementação funcional, release ou deploy.
- **2026-11-11 — Revisão com a responsável:** aprovadas as decisões da seção 5 (sobrecarga em 30% acima da média, eventos pendentes no topo, encaminhamento à escala, badges visíveis em todos os tamanhos e “Ver mais”). Permanecem em aberto a experiência em estados sem dados/falha parcial, o destino exato do encaminhamento e as limitações de validação em dispositivos.
- **2026-11-11 — Implementação:** aplicadas as decisões da seção 5 em `app/schedule/admin/dashboard/page.tsx` (plano em `sdd/plan/PLAN-WF-36-implementation.md`). Marcador de sobrecarga corrigido de ×1,6 para ×1,3; alertas movidos para o topo; links "Abrir escala" para `/schedule/admin/builder?quarter=…&event=…`; badges visíveis em todos os tamanhos; "Ver mais" nas listas cortadas; erro sem dados com "Tentar novamente"; `truncate` removido. Verificação: `pnpm test:wf36` (7/7) e `pnpm build` ok. Não executados: validação renderizada em 360 px, teclado e leitor de tela; ESLint não está instalado no projeto (`pnpm lint` falha). Permanecem em aberto os itens acima.
