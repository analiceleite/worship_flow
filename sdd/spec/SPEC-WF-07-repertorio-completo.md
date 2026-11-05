# SPEC — WF-07: Ordenação e compartilhamento do repertório completo

**Status:** Implementado e validado automaticamente em ambiente local; revisão e implantação pendentes

**PBI:** [WF-07 — Corrigir ordenação e compartilhamento do repertório completo](https://github.com/analiceleite/worship_flow/issues/3)

**Prioridade:** P1 — Alta

**Área:** Repertório · Correção

**Data:** 2026-11-05

**Implementação:** [PLAN](../plan/PLAN-WF-07-implementation.md) · [Evidências e pendências](../plan/WF-07-validation.md). Os critérios abaixo permanecem como checklist de aceite da entrega, sem substituir a revisão humana por aprovação automática.

## 1. Contexto e problema

A tela de repertório apresenta dez itens por página. Atualmente, operações que deveriam considerar todo o evento usam apenas os itens da página carregada: cálculo da posição de inclusão, reordenação, identificação de músicas já adicionadas e exportação para WhatsApp. A seleção de outro evento não reinicia a paginação.

Isso pode produzir posições repetidas, exportação incompleta, oferta de músicas já presentes e uma página vazia que aparenta não ter repertório. A gravação da ordem ocorre em requisições independentes, permitindo persistência parcial em caso de falha.

**Pessoas impactadas:** líderes, vocalistas e equipe que consulta ou recebe o repertório.

As evidências abaixo resultam de inspeção estática do código, não de reprodução em produção ou de feedback confirmado de usuários.

## 2. Evidências na implementação atual

| Local | Comportamento observado |
|---|---|
| `app/repertoire/page.tsx:236,353-378` | `PAGE_SIZE = 10`; consulta por igreja, data e nome do evento, ordenada somente por `order_index` e limitada com `range`. |
| `app/repertoire/page.tsx:384-408` | Troca de semana altera somente a âncora; inclusão calcula `maxOrder` sobre a página carregada. |
| `app/repertoire/page.tsx:506-524` | Exportação percorre somente `repertoire`, que contém a página atual. |
| `app/repertoire/page.tsx:527-558` | Reordenação renumera a página a partir de 1 e salva cada registro separadamente com `Promise.all`. |
| `app/repertoire/page.tsx:597-599` | Filtro de músicas disponíveis verifica duplicidade apenas na página atual, por `song_id`. |
| `app/repertoire/page.tsx:951-963` | Setas ficam limitadas à página; numeração visual considera o deslocamento da paginação. |
| `scripts/032_simple_multitenancy_hardening.sql:96-97` | Índice único inclui `id`; não impede que registros distintos tenham o mesmo `order_index` no evento. |

As linhas são referências da revisão inicial e podem mudar durante a implementação. A definição de RLS deve ser conferida também em `scripts/031_simple_multitenancy_rls.sql` e nas migrações posteriores aplicáveis.

## 3. Objetivos

- Tratar o repertório do evento como uma sequência completa, independentemente da página exibida.
- Manter ordem determinística, sem perda ou repetição de itens por efeito da paginação.
- Exportar todas as músicas do evento na ordem persistida.
- Manter a navegação em uma página válida após mudanças de contexto ou quantidade de itens.
- Evitar gravações parciais e comunicar falhas e conflitos de edição.
- Preservar permissões existentes e isolamento entre igrejas.

## 4. Escopo e limites

**Incluído:** consulta e apresentação da sequência, inclusão ao final, movimentação, detecção de duplicadas, ajuste de paginação após exclusão e exportação para WhatsApp. Inclui tratamento de concorrência e eventual migração necessária para integridade desses fluxos.

**Fora de escopo:** redesenho geral da tela, mudança de papéis/permissões, deduplicação do catálogo de músicas, alterações no conteúdo de cifras, melhorias gerais do player e redefinição do ciclo de vida de eventos.

Renomear/excluir eventos e estabelecer sua identidade definitiva pertencem ao [WF-06](https://github.com/analiceleite/worship_flow/issues/2). Este PBI pode iniciar sem aguardar esse modelo, mas não deve introduzir um modelo concorrente de identidade.

## 5. Regras funcionais

As decisões D-01 a D-04 foram aprovadas em 2026-11-05. Os mecanismos de implementação serão definidos no plano técnico.

### 5.1. Conjunto e ordem

- O escopo atual de uma sequência é a igreja efetiva + data + nome do evento, até eventual evolução coordenada com WF-06. Eventos diferentes no mesmo dia não compartilham sequência.
- A paginação é apenas uma apresentação; nenhuma regra de negócio pode assumir que a página contém o conjunto completo.
- A leitura deve usar `order_index ASC, id ASC` como ordenação determinística. O desempate por ID permite leitura previsível de dados legados, mas não substitui a correção de posições repetidas.
- Após normalização inicial e cada mutação bem-sucedida, persistir posições únicas e contíguas de 1 a N dentro do evento, sem alterar a sequência dos demais itens além do necessário.
- A inclusão adiciona a música ao final real do evento, não ao final da página atual.
- Dados legados com posições repetidas ou lacunas exigem estratégia explícita de normalização; não excluir músicas ou itens silenciosamente.

### 5.2. Movimentação e paginação

- Manter, inicialmente, dez itens por página.
- As setas devem operar sobre a sequência global: mover a posição 10 para baixo deve trocá-la com a 11, inclusive entre páginas. Desabilitar apenas nos extremos do evento ou durante uma gravação em curso.
- Após movimento entre páginas, acompanhar o item movido na página de destino. Arrastar e soltar fica restrito aos itens visíveis, aplicando a mudança à sequência global.
- Reiniciar na página 1 ao selecionar outro evento/data, mudar de semana ou trocar a igreja efetiva. A troca de semana não precisa redefinir automaticamente o evento selecionado neste PBI.
- Após exclusão ou atualização externa, limitar a página à última página válida; repertório vazio usa página 1.
- Exibir contagem total do evento, distinguindo-a da quantidade visível quando necessário.
- Respostas atrasadas de outro evento, igreja ou página não podem sobrescrever o contexto atual.

### 5.3. Duplicidade

- Impedir a repetição do mesmo `song_id` no mesmo evento, independentemente do ministro e da página. Registros distintos do catálogo com título igual não são considerados a mesma música neste PBI.
- O formulário deve considerar os IDs de todo o evento ao apresentar opções.
- A validação deve existir também na persistência, inclusive para duas inclusões simultâneas. Uma delas pode ser recusada com mensagem clara, sem duplicar o item.
- Se houver duplicatas legadas, inventariar e definir tratamento antes de aplicar restrição; não removê-las automaticamente nem ocultá-las apenas na exportação.

### 5.4. Exportação para WhatsApp

- Consultar/usar uma visão completa e consistente do evento, sem depender da página aberta nem de um limite implícito de retorno do Supabase.
- Incluir cada item persistido exatamente uma vez e numerar de 1 a N na mesma ordem da tela. Para dados válidos, cada música aparece uma única vez conforme a regra de duplicidade aprovada.
- Preservar o formato atual: nome do evento, data, título, artista, tom e capotraste quando disponíveis, mantendo os textos substitutos existentes para dados ausentes.
- Não abrir compartilhamento com conteúdo parcial em caso de falha; informar o erro e permitir tentar novamente.
- Tratar estados vazio, carregando e exportando; evitar disparos repetidos enquanto a exportação estiver em curso.
- Validar abertura no navegador móvel e desktop após eventual consulta assíncrona, considerando bloqueio de pop-up. Não prometer envio ou entrega pelo WhatsApp.

### 5.5. Persistência, falhas e concorrência

- Inclusão, exclusão com renumeração e movimentação devem preservar a integridade da sequência de forma transacional no servidor/banco. Várias atualizações independentes no cliente não atendem a esse requisito.
- Detectar edição baseada em estado desatualizado e recusá-la sem sobrescrever silenciosamente a edição anterior nem combinar alterações automaticamente. Atualizar a lista e informar: “O repertório foi alterado por outra pessoa. Confira a lista atualizada e tente novamente.”
- A escolha de versão/token, bloqueio por evento e mecanismo transacional fica para o desenho técnico. Todas as mutações da sequência devem participar do mesmo protocolo, inclusive inclusão e exclusão.
- Em falha confirmada, nenhuma alteração parcial pode permanecer. Em resultado incerto por interrupção de rede, recarregar o estado autoritativo antes de repetir, evitando inclusão duplicada.
- Se houver atualização otimista, não apresentá-la como salva antes da confirmação; reconciliar o estado após erro/conflito.
- Validar autenticação, igreja efetiva, permissão e pertencimento dos itens/música/ministro no servidor/banco; não confiar apenas nos controles da interface nem em IDs enviados pelo cliente.

## 6. Decisões aprovadas

| ID | Decisão | Regra aprovada | Estado |
|---|---|---|---|
| D-01 | O que caracteriza música duplicada? | Mesmo `song_id` no evento, independentemente do ministro; não comparar por título. | Aprovada |
| D-02 | Movimentação entre páginas | Setas globais; acompanhar o item na página de destino; arraste restrito à página. | Aprovada |
| D-03 | Edições concorrentes | Rejeitar operação desatualizada, atualizar a visão e solicitar nova tentativa; sem sobrescrita silenciosa ou combinação automática. | Aprovada |
| D-04 | Normalização e posições | Posições contíguas de 1 a N; desempate legado por `id`; revisar duplicatas antes de restrições, sem exclusão automática. | Aprovada |

Não há decisões de produto bloqueadoras restantes. O tratamento concreto de eventuais duplicatas legadas depende do inventário e de revisão antes da migração.

## 7. Critérios de aceite e validação

Usar dados fictícios e um evento com pelo menos 25 músicas, distribuídas em três páginas.

- [ ] **CA-01 — Inclusão global:** adicionar na primeira e na segunda página inclui ao final real; todas as posições permanecem únicas e corretas após recarregar.
- [ ] **CA-02 — Movimento global:** mover itens dentro da página e nas fronteiras 10/11 e 20/21 preserva os 25 itens, a ordem dos não envolvidos e a numeração global; a tela acompanha o item na página de destino; primeiro/último respeitam os limites.
- [ ] **CA-03 — Exportação completa:** exportar a partir de qualquer uma das três páginas produz as mesmas 25 músicas, uma vez cada, na ordem persistida, com cabeçalho e metadados corretos.
- [ ] **CA-04 — Mudança de contexto:** estando na página 3, trocar para evento com menos de dez músicas, evento vazio, outra semana ou outra igreja não deixa página inexistente nem mistura dados. Incluir respostas de rede fora de ordem.
- [ ] **CA-05 — Exclusão:** excluir o único item da última página retorna a uma página válida, sem falso estado vazio e com sequência íntegra.
- [ ] **CA-06 — Duplicidade global:** música presente em outra página não é oferecida; tentativa direta ou simultânea segue D-01 e não cria duplicata.
- [ ] **CA-07 — Atomicidade:** simular falha de persistência não deixa reordenação parcialmente salva; a interface informa erro e reconcilia a sequência.
- [ ] **CA-08 — Concorrência:** dois clientes reordenando, ou reordenando enquanto outro inclui/exclui, seguem D-03 sem perder itens, repetir posições ou sobrescrever silenciosamente.
- [ ] **CA-09 — Falha de exportação:** erro ao obter o conjunto completo não compartilha apenas a página nem dados de outro evento; permite nova tentativa.
- [ ] **CA-10 — Permissões e isolamento:** leitura/exportação preservam as permissões vigentes; mutações sem autorização e itens de outra igreja/evento são recusados também no servidor/banco.
- [ ] **CA-11 — Dados legados:** posições empatadas têm leitura estável; saneamento aprovado preserva os itens e trata duplicatas antes de novas restrições.
- [ ] **CA-12 — Mobile e acessibilidade:** ordenação por botões funciona sem arraste; controles têm nomes acessíveis, estados de espera e erros perceptíveis; compartilhamento abre em mobile e desktop.

Cobrir regras de sequência/exportação com testes unitários e atomicidade, concorrência e autorização com testes de integração. Validar a jornada paginada e compartilhamento no navegador; anexar evidências ao PR sem dados reais.

## 8. Diretrizes para o plano técnico

- Separar dados paginados de apresentação dos dados necessários às operações globais. Escolher carregamento completo ou consultas específicas sem assumir que remover `range` elimina limites de retorno.
- Definir um ponto autoritativo transacional para mutações, compatível com RLS e contexto de igreja/impersonação existentes.
- Avaliar migração de integridade e saneamento com pré-verificação dos dados; o índice atual com `id` não garante unicidade de posição.
- Verificar consumidores da ordem, incluindo `app/repertoire/player/page.tsx`, para evitar sequências divergentes; limitar ajustes à compatibilidade necessária.
- Registrar no plano as rotas/RPCs, formato do controle de concorrência, estratégia de migração e testes. Nenhuma alteração funcional faz parte da criação desta SPEC.

## 9. Registro de decisões

- **2026-11-05 — Criação:** SPEC inicial criada com base no PBI e na inspeção do repositório, com D-01 a D-04 inicialmente pendentes; nenhuma ocorrência em produção foi presumida.
- **2026-11-05 — D-01 aprovada:** Impedir repetição do mesmo `song_id` no evento, independentemente do ministro. Preserva a intenção do filtro existente sem ampliar o escopo para deduplicação do catálogo por título.
- **2026-11-05 — D-02 aprovada:** Usar setas sobre a sequência completa e acompanhar o item na página de destino. Manter arraste restrito à página visível, sem limitar a organização global.
- **2026-11-05 — D-03 aprovada:** Recusar mutação baseada em estado desatualizado, atualizar a lista e solicitar nova tentativa. Aplicar a inclusão, exclusão e movimentação; não combinar alterações automaticamente nem sobrescrever silenciosamente a edição anterior.
- **2026-11-05 — D-04 aprovada:** Manter posições únicas e contínuas de 1 a N. Normalizar posições legadas por `order_index ASC, id ASC`, preservando todos os itens; eventuais músicas duplicadas exigem revisão antes de aplicar restrição, sem remoção automática.
- **2026-11-05 — Implementação local:** Implementado controle transacional por revisão, leitura completa com paginação local, exportação global e integração dos demais escritores identificados. Testes e limites da validação registrados no relatório; nenhuma migração remota ou implantação foi realizada.
