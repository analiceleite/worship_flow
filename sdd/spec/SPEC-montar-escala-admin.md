# SPEC — Melhorar a tela Montar escala para a pessoa administradora

**Status:** decisões de experiência aprovadas em 2026-11-11; implementação não iniciada; nenhuma regra de escala foi alterada

**PBI:** a criar (número WF ainda não atribuído)

**Branch sugerida:** `feat/montar-escala-admin` (a partir de `main`, após a WF-36 ser aceita ou em paralelo, se os arquivos não se sobrepuserem)

**Prioridade:** P2 — Média

**Área:** UX · Operação de escala · Mobile

**Data:** 2026-11-11

## 1. Contexto e problema

A tela **Montar escala** (`/schedule/admin/builder`) permite criar períodos, abrir cada culto, escolher integrantes por função, definir responsável e ensaio, cancelar ou reativar cultos e publicar o período. Editar um único culto é simples: a lista e o editor ficam lado a lado no desktop, o salvamento é automático por função e o progresso aparece como "X de Y funções preenchidas".

Montar o bimestre inteiro, porém, exige muitas etapas repetidas. A análise do código identificou:

- o trabalho é feito culto a culto, sem ação de copiar ou repetir uma equipe já montada;
- o seletor de integrantes não mostra a carga da pessoa no período nem se ela já está escalada no mesmo culto;
- a visão de grade, que mostra todas as funções de todos os cultos, existe só em telas grandes e não é o modo padrão;
- no celular, o cabeçalho (navegação, título, cartão do período, linha de status, filtros e seletor de tipo) ocupa a tela antes da primeira lista de cultos;
- há dois controles de filtro com estilos diferentes, e o rodapé usa "Salvamento automático" ao lado de "Alterações salvas", o que confunde.

Esta SPEC não se baseia em observação de uso real. Os fatos abaixo vêm da leitura do código; a prioridade das melhorias é uma recomendação a ser confirmada pela responsável.

## 2. Evidências técnicas

Referências de ponto de partida; reconfirmar antes de alterar.

| Local | Observação | Natureza |
|---|---|---|
| `components/schedule/builder/schedule-builder.tsx` | Orquestra período, lista, editor, grade, filtros (`filter`, `type`, `view`, `minister`), publicação e importação. Layout: lista e editor em `lg:grid-cols-[…]`; grade com `hidden lg:block`; alternância Agenda/Grade só em `lg`. | Fato observado no código |
| `components/schedule/builder/schedule-builder.tsx` | Cabeçalho do celular: cabeçalho da página, cartão do período, linha de salvamento, filtros e seletor de tipo antes da lista. | Fato observado no código |
| `components/schedule/builder/schedule-builder-header.tsx` | Seletor de período dentro de cartão; ações secundárias (novo período, importar planilha, configurações, todos os períodos, dashboard) no menu "⋮". | Fato observado no código |
| `components/schedule/builder/schedule-event-list.tsx` | Mostra data, status de preenchimento, funções em aberto (até 2, depois "e mais N") e responsável. | Fato observado no código |
| `components/schedule/builder/schedule-event-editor.tsx` | Editor com funções agrupadas (Ministração, Vozes, Instrumentos, Equipe técnica), responsável, ensaio, cancelamento e navegação Anterior/Próximo. Não há ação de copiar equipe. | Fato observado no código |
| `components/schedule/builder/assignment-picker.tsx` | Busca por nome (`/api/ministers/search`, até 25 resultados), marca "Escalado nesta função" e checkbox de aprendiz. Não exibe carga no período nem indica se a pessoa já está em outra função do mesmo culto. | Fato observado no código |
| `components/schedule/builder/assignment-picker.tsx` | A busca filtra só por função de mídia; não há informação de disponibilidade na tela. | Fato observado no código |
| Regra de duplicidade no servidor | Não verificada nesta SPEC. Confirmar se a API impede a mesma pessoa em duas funções no mesmo culto. | Fato técnico a investigar |
| `app/schedule/admin/dashboard/page.tsx` | Já calcula carga por ministro no período; esse dado pode ser reaproveitado ou extraído para uso compartilhado. | Fato observado no código |
| Renderização em navegador | Não foi feita. Layout, rolagem e alvos de toque no celular são hipóteses até validação. | Validação pendente |

## 3. Objetivos

- Reduzir o número de toques para montar uma equipe típica em um período.
- Ajudar a pessoa administradora a escolher integrantes com base em carga e conflitos já visíveis.
- Tornar a visão geral do período utilizável também no celular.
- Diminuir ruído no cabeçalho móvel sem remover ações.
- Manter as regras de publicação, cancelamento e notificação intactas.

## 4. Escopo e limites

**Incluído (propostas a aprovar):**

1. Seletor de integrantes com contexto: carga no período e marcação de quem já está no culto.
2. Copiar equipe de outro culto para o culto atual, por ação explícita e com revisão antes de salvar.
3. Visão geral dos cultos acessível no celular e no tablet, com rolagem horizontal controlada, e padrão de visualização definido por tamanho de tela.
4. Cabeçalho compacto no celular: período e ações em uma linha; filtros em um controle recolhível.
5. Padronizar os rótulos de filtro e o texto de estado do salvamento.

**Fora de escopo:**

- Disponibilidade de integrantes (não há dado na tela; exige decisão de produto e modelagem).
- Sugestão automática de escala ou preenchimento automático sem ação do admin.
- Mudança nas regras de publicação, cancelamento, notificações ou calendário.
- Mudança em permissões ou no modelo de dados, salvo se a verificação de duplicidade exigir (a ser decidido à parte).
- Importação de planilha (já existe; só reposicionar se necessário).
- Pesquisa com usuários ou alegação de uso real.

Qualquer mudança que altere regra operacional exige aprovação explícita da responsável antes da implementação.

## 5. Requisitos

### 5.1. Seletor de integrantes (prioridade alta)

- Cada resultado mostra a quantidade de cultos em que a pessoa já está escalada no período, usando os dados já carregados na tela.
- Se a pessoa já estiver em outra função do mesmo culto, o resultado indica isso antes da seleção. A escolha não é bloqueada, pois tocar e cantar no mesmo culto é comum.
- O texto de ajuda não deve ser apenas cor; usar texto e ícone.
- Ordenação padrão: quem tem menos cultos no período primeiro, mantendo a busca por nome.

### 5.2. Copiar equipe (prioridade alta)

- No editor de um culto, ação "Copiar equipe de…" lista os cultos do período que já têm equipe.
- Antes de salvar, mostra a prévia das funções que serão preenchidas e as que serão mantidas ou substituídas.
- Não sobrescreve funções já preenchidas sem confirmação explícita.
- Cada alteração segue o mesmo fluxo de salvamento, com estado e tentativa de novo envio por função, sem transação única que altere várias funções sem aviso.
- Se a cópia gerar conflito de duplicidade ou de carga, o conflito é mostrado antes da confirmação.

### 5.3. Visão geral dos cultos (prioridade média)

- A grade de funções por culto deve estar disponível no celular, por rolagem horizontal com primeira coluna fixa, ou em formato alternativo equivalente.
- O padrão de visualização deve ser decidido pela responsável (agenda no celular e grade no desktop, ou o inverso).
- Os alvos de toque de cada célula devem atender ao mínimo do projeto (WF-16).

### 5.4. Cabeçalho e navegação móvel (prioridade média)

- No celular, o período e o status ficam em uma linha compacta; a troca de período abre em sheet ou menu.
- Filtros de situação e tipo são agrupados em um só controle recolhível, mantendo o estado visível (ex.: "Filtros: Com pendências · Quintas").
- O conteúdo do primeiro culto deve aparecer sem rolagem excessiva em 360 CSS px.

### 5.5. Textos e estados (prioridade baixa)

- Trocar "Salvamento automático" por texto que diga o estado real (ex.: "Alterações salvas automaticamente" ou "Há alterações não salvas").
- Padronizar os nomes de filtros e de tipo de culto.
- Manter os estados de carregamento, erro e ausência de dados já existentes (WF-15), sem regressão.

### 5.6. Acessibilidade

- Filtros, troca de visualização e ações de cópia operáveis por teclado, com foco visível.
- Resultados do seletor anunciados com contagem.
- Contraste e rolagem horizontal da grade validados em navegador.

## 6. Decisões aprovadas (2026-11-11)

1. **Visualização:** agenda com editor como padrão. No computador, a grade fica visível como alternância. No celular, a grade aparece só com o filtro de tipo em Quintas ou Domingos (5.3).
2. **Copiar equipe:** por padrão, copia só as vagas em aberto. "Substituir tudo" é ação secundária, com confirmação (5.2).
3. **Duplicidade:** sinalizar no seletor, sem bloquear. Tocar e cantar no mesmo culto é comum (5.1).
4. **Carga:** considera apenas o período atual (5.1).
5. **Filtros:** no computador, ficam sempre visíveis. No celular, são recolhíveis, com resumo dos filtros ativos sempre visível (5.4).

## 7. Critérios de aceite

- [ ] Seletor mostra carga no período e marca conflito de função no mesmo culto (5.1).
- [ ] Copiar equipe exige prévia e confirmação, e não sobrescreve funções preenchidas sem confirmação (5.2).
- [ ] Visão geral dos cultos é utilizável em 360 CSS px sem perder informação essencial (5.3).
- [ ] Cabeçalho móvel mostra o primeiro culto sem rolagem excessiva (5.4).
- [ ] Textos de salvamento refletem o estado real (5.5).
- [ ] Nenhum fluxo de publicação, cancelamento ou notificação foi alterado.
- [ ] `pnpm test:schedule-builder` e `pnpm test:wf15` passam; testes novos para as mudanças são adicionados.
- [ ] `pnpm build` passa.
- [ ] Validação renderizada em desktop e 360 CSS px, por teclado, registrada com limitações; testes manuais não executados ficam pendentes.

## 8. Validação

Usar dados sintéticos ou não sensíveis. Revisar a renderização em desktop e em 360 CSS px; percorrer filtros, seletor, cópia de equipe e troca de visualização por teclado; conferir foco, contraste e estados. Registrar navegador, viewport, evidências e limitações. Inspeção estática não substitui teste renderizado.

## 9. Relações e dependências

- **WF-36 (dashboard de alocação):** relacionada. Já adicionou o filtro `?minister=` ao builder; esta SPEC não deve reverter esse comportamento.
- **WF-15 (estados e feedback):** dependente nos padrões de erro e recuperação já implementados.
- **WF-16 (acessibilidade e toque):** dependente nos alvos mínimos de toque e nos princípios de foco.
- **WF-32 (regras de publicação):** relacionada; não alterar regras de publicação aqui.

## 10. Registro de decisões

- **2026-11-11 — Criação:** SPEC criada a partir da análise da tela Montar escala (leitura de `schedule-builder.tsx`, `schedule-builder-header.tsx`, `schedule-event-list.tsx`, `schedule-event-editor.tsx` e `assignment-picker.tsx`). Nenhuma alteração de código.
- **2026-11-11 — Decisões:** aprovadas as cinco decisões da seção 6, seguindo as recomendações apresentadas. Duplicidade sinalizada e não bloqueada, pois tocar e cantar no mesmo culto é comum.
