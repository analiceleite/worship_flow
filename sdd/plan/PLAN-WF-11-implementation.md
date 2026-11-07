# Plano de implementação — WF-11

**SPEC:** [SPEC-WF-11-consulta-escala-midia.md](../spec/SPEC-WF-11-consulta-escala-midia.md)

**PBI:** [WF-11 — Permitir que mídia consulte seus compromissos na escala](https://github.com/analiceleite/worship_flow/issues/7)

**Branch:** `fix/wf-11-consulta-escala-midia`

**Estado:** Implementado e validado automaticamente em ambiente local; revisão humana e implantação pendentes

**Data:** 2026-11-06

## 1. Decisões e limites

- **D-01:** mídia pode consultar toda a escala publicada da própria igreja, incluindo equipe e atribuições, além da visão pessoal. Sem rascunhos ou dados administrativos adicionais.
- **D-02:** abrir a página da escala na visão pessoal, com acesso à geral. Sem atribuições, manter mensagem clara na visão pessoal, sem troca automática de aba.
- Manter repertório como destino após login e preservar os fluxos dos demais perfis.
- Mídia permanece sem poderes de gestão da escala e dos ensaios. Permissões já existentes em outros módulos não mudam.
- Reutilizar `/schedule` e os contratos existentes sempre que possível. Não criar detalhe de evento, confirmação de presença, novas notificações ou um novo modelo de publicação.

Este plano não autoriza migração remota, deploy, envio real de e-mails, commit ou abertura de PR. O progresso abaixo registra trabalho local; os resultados e limites estão em [WF-11-validation.md](WF-11-validation.md).

## 2. Inspeção inicial e implicações

| Local | Constatação e ação planejada |
|---|---|
| `middleware.ts` | A lista permitida para mídia exclui `/schedule`; liberar somente a consulta, mantendo o bloqueio administrativo e o destino inicial vigente. |
| `components/header.tsx` | O filtro de navegação de mídia permite somente repertório; incluir escala usando a lista compartilhada pelos menus desktop/móvel. |
| `app/schedule/page.tsx` | Já usa `Tabs defaultValue="mine"`. Reutilizar esse padrão; identificar a aba como “Meus compromissos” para mídia, sem exigir renomear a dos demais perfis. |
| `app/schedule/page.tsx` | `weekPairs` deriva semanas de todas as datas, não apenas das atribuições pessoais; seu tamanho não indica se há compromissos da pessoa. Separar essas condições. |
| `app/schedule/page.tsx` | A aba pessoal pode dizer “Nenhuma escala publicada” com período publicado; erros principais e auxiliares precisam de estados distintos e recuperação. |
| `app/api/schedule/current/route.ts` | Já autentica, filtra igreja e publicação. Não seleciona os quatro campos de horário do período; ampliar somente essa projeção para exibir horários persistidos. |
| `app/api/schedule/rehearsal/route.ts` | GET filtra igreja/período, mas não verifica publicação. PATCH rejeita mídia. Restringir leitura de rascunhos por mídia sem retirar leitura/edição vigente de administrador/ministro. |
| `lib/schedule/event-time.ts` | Existem seletores de horário por tipo de culto; `computeEventArrivalDateTime` aplica override de ensaio sem receber sua data. Não reutilizar esse override para apresentação de ensaio em dia distinto. |
| `app/api/schedule/quarters/route.ts` e `quarters/[id]/assignments/route.ts` | Há leituras autenticadas alternativas; conferir filtragem de publicação para mídia, não apenas o endpoint usado pela tela. |
| `scripts/031_simple_multitenancy_rls.sql` | Políticas de leitura de períodos/atribuições são organizadas por igreja; conferir migrações posteriores e grants efetivos para impedir consulta direta de rascunhos por mídia. |
| `tests/navigation.test.cjs` e testes de repertório | Há padrões com `node:test`, TypeScript transpilado, integração local e `playwright-core`; reutilizá-los sem introduzir framework de testes. |

As constatações são estáticas; não significam que autorizações ou comportamento em produção foram testados.

## 3. Desenho técnico

### 3.1. Rotas e navegação

- Autorizar para mídia o caminho exato `ROUTES.SCHEDULE`, compatível com normalização de barra final do Next.js. Não usar liberação ampla por prefixo `/schedule`.
- Manter a proteção de `ROUTES.SCHEDULE_ADMIN` independente e anterior à permissão de consulta. Testar limites de caminho, incluindo `/schedules` e descendentes não autorizados.
- Incluir o item existente de escala no filtro do cabeçalho para mídia. Não duplicar componentes de menu nem adicionar nova entrada administrativa.
- Preservar seleção visual da rota ativa, colapso da sidebar e navegação móvel existentes.
- O link dos avisos já aponta para `/schedule`; validar esse destino sem alterar template, fila ou política de envio.

### 3.2. Contratos de leitura e horários

- Manter `GET /api/schedule/current` com `{ schedule, viewer }`, inclusive `schedule: null` na ausência de publicação.
- Adicionar ao objeto `schedule.quarter` os campos persistidos `thursday_arrival_time`, `thursday_service_time`, `sunday_arrival_time` e `sunday_service_time`. Alinhar a tipagem do consumidor com a nulabilidade real do banco.
- Exibir chegada e início do culto com rótulos distintos, conforme o tipo da ocorrência e a configuração do período retornado. Não buscar configuração de outro período nem criar defaults de apresentação para dados ausentes.
- Manter informações de ensaio por chave `event_date + event_type`, exibindo sua própria data, horário e local. Não usar horário de ensaio como substituto automático da chegada ao culto.
- Preservar `GET /api/schedule/rehearsal?quarter_id=...` e a variante por ocorrência. Para mídia, validar no servidor que o período pertence à igreja efetiva e está publicado antes de retornar os ensaios.
- Retornar erro genérico de recurso indisponível para período inexistente, de outra igreja ou não publicado no contexto de mídia, sem revelar a existência de rascunhos. Manter o formato das respostas de sucesso.
- Preservar autenticação por `getCurrentMinisterContext()` e derivar igreja/papel no servidor. Como há uso de cliente administrativo, autorização explícita é obrigatória.
- Evitar cache compartilhado de respostas autenticadas; conferir cabeçalhos das rotas e manter `cache: 'no-store'` nas consultas do cliente.

### 3.3. Visão pessoal e estados

- Manter a aba pessoal como padrão; não adicionar persistência de aba que faça mídia iniciar na visão geral.
- Calcular separadamente: atribuições pessoais no período, atribuições pessoais no recorte temporal exibido e existência de datas no período.
- Para mídia, priorizar na visão pessoal as ocorrências atribuídas à pessoa. Manter a visão geral disponível mesmo quando não houver atribuições; não alterar silenciosamente o recorte temporal dos demais perfis.
- Usar chave de agrupamento que inclua ano ISO e semana, se o agrupamento semanal for mantido; testar período que atravesse dezembro/janeiro para não misturar datas.
- Substituir textos inadequados ao perfil, como “Você não toca nessa escala”, por linguagem neutra quando aparecerem para mídia.
- Não confundir “escala completa” de D-01 com remover os filtros temporais existentes da visão geral móvel. Tornar o recorte visível; não introduzir consulta histórica nova neste card.
- Modelar explicitamente carregamento, sucesso vazio e erro principal. Na falha inicial, não renderizar simultaneamente “Nenhuma escala publicada”; oferecer “Tentar novamente”.
- Modelar ensaios com carregamento/erro próprios, mantendo a escala visível e permitindo nova tentativa sem apresentar falha como dado não cadastrado.
- Ao mudar período/contexto ou iniciar nova consulta, cancelar ou ignorar respostas antigas e limpar dados auxiliares incompatíveis. Uma resposta atrasada não pode anexar ensaios de outro período.
- Reutilizar `Alert`, `Button`, `Tabs` e componentes atuais. Anunciar erros e espera de forma acessível, preservando foco e navegação por teclado.

### 3.4. Autorização, rotas alternativas e banco

- Inventariar todas as leituras de períodos, atribuições e ensaios acessíveis ao perfil, inclusive endpoints alternativos, RPCs e consultas diretas ao Supabase.
- Aplicar à mídia a restrição de publicação nessas leituras; preservar a capacidade administrativa/ministro vigente de preparar escalas.
- Conferir políticas permissivas sobrepostas: acrescentar uma política restritiva em intenção, mas permissiva em SQL, não remove acesso concedido por outra política. Revisar o conjunto efetivo antes de alterar RLS.
- Se RLS/grants atuais permitirem leitura direta de rascunhos por mídia, criar migração mínima na próxima numeração livre, preservando isolamento por igreja e permissões dos demais perfis. Não assumir antecipadamente que não haverá migração.
- Conferir bloqueio de mídia nas escritas de atribuição, períodos, publicação, importação e ensaios, tanto em APIs quanto no banco. Não confiar em `readOnly` ou ausência de botões.
- Não modificar privilégios de plataforma/impersonação fora da compatibilidade necessária com o contexto já validado.
- Se o inventário revelar uma correção de segurança transversal maior, registrar o achado com detalhes restritos e refinar o trabalho necessário; não declarar o aceite de não exposição de rascunhos atendido enquanto o caminho permanecer acessível.

## 4. Etapas de execução

### Fase 0 — Confirmar superfície e fixtures

- [x] Inventariar leitores/escritores, políticas e grants vigentes de escala/ensaios.
- [x] Conferir esquema dos horários, nulabilidade e integração de migrações no ambiente local.
- [x] Preparar duas igrejas fictícias, perfis distintos, publicação, rascunho, mídia escalada/não escalada e ensaio em outra data.
- [x] Definir necessidade de migração mínima e registrar arquivos afetados antes da implementação.

Migração criada: `scripts/037_schedule_media_read_access.sql`, com políticas restritivas de leitura/publicação e bloqueio de escrita por mídia. O migrador local detectou checksum divergente da migração preexistente 036; a 037 foi aplicada isoladamente somente no banco de testes, sem alterar esse histórico.

### Fase 1 — Acesso e proteção de dados

- [x] Liberar a rota de consulta e incluir escala nos menus de mídia, preservando bloqueios administrativos.
- [x] Ampliar projeção/tipos de horários da consulta atual sem alterar o contrato base.
- [x] Proteger leituras auxiliares/alternativas e diretas contra rascunhos e outras igrejas.
- [x] Validar bloqueios de escrita e corrigir apenas divergências necessárias ao aceite.

### Fase 2 — Consulta e recuperação

- [x] Reutilizar a aba pessoal como entrada, mantendo alternância explícita para geral.
- [x] Apresentar compromissos de mídia, data, função, horários persistidos e preparação com contexto correto.
- [x] Distinguir ausência de publicação, ausência de atribuição e ausência de compromissos futuros.
- [x] Implementar erros principal/auxiliar, recuperação e proteção contra respostas atrasadas.
- [x] Preservar comportamento e permissões dos demais perfis, com ajustes compartilhados limitados a correções necessárias.

### Fase 3 — Testes e evidências

- [x] Implementar testes unitários/de contrato e integração local de autorização.
- [x] Validar navegador automatizado desktop e móvel, menu, link do aviso, estados e somente leitura.
- [x] Executar regressões, TypeScript e build; tentar lint e registrar o bloqueio por ESLint ausente.
- [x] Registrar evidências por critério em `sdd/plan/WF-11-validation.md`.
- [x] Atualizar progresso deste plano e referências na SPEC, sem marcar revisão humana ou deploy como concluídos automaticamente.
- [ ] Revisar manualmente leitor de tela, foco/zoom e comportamento em dispositivo real antes do aceite final de acessibilidade.

## 5. Matriz de validação

| Cobertura | Testes planejados | SPEC |
|---|---|---|
| Navegação | Mídia vê escala nos dois menus; rota exata autorizada; `/schedule/admin` e descendentes bloqueados; login inicial preservado. | CA-01, CA-10 |
| Link | Destino usado no aviso funciona autenticado; sem sessão exige login; sem promessa de retorno automático após login. | CA-02 |
| Conteúdo | Sonoplasta, múltiplas funções, homônimos, horários por tipo/período e ensaio em data diferente; dados ausentes não são inventados. | CA-03 |
| Abas | Mídia inicia na pessoal, alterna para geral e continua na pessoal quando não escalada; regressão dos demais perfis. | CA-04 |
| Estados | Sem publicação, só rascunho, sem atribuição, somente atribuições passadas, período sem datas e virada de ano. | CA-05, CA-06 |
| Recuperação | Falha principal, falha só nos ensaios, retry, respostas fora de ordem e troca de período/contexto. | CA-07 |
| Escrita | Mídia recebe negativa por API e por acesso direto ao banco; conferir ausência de efeitos persistidos. Admin/ministro mantêm poderes vigentes. | CA-08, CA-10 |
| Isolamento/publicação | Igreja B, IDs manipulados, rascunho da própria igreja e leituras alternativas; principal, auxiliares e RLS/grants reais. | CA-05, CA-09 |
| Interface | 360px e desktop, teclado, foco, nomes acessíveis e anúncio de erro/espera; visão geral móvel com recorte explicado. | CA-11 |

**Arquivos de testes sugeridos:** ampliar `tests/navigation.test.cjs` e criar `tests/schedule-media.test.cjs`, `tests/schedule-media.local.test.cjs` e `tests/schedule-media.browser.test.cjs`, conforme a separação já usada pelo repositório. Nomes finais podem variar, preservando a rastreabilidade.

- Usar `node:test` nos testes unitários/de contrato; testes de fonte ou mocks não substituem integração real de autorização/RLS.
- Usar Auth/Postgres locais para fixtures e acessos negativos. Se o executor de `pnpm local:test` tiver lista fixa, integrá-lo aos novos testes sem apontar para ambiente remoto.
- Usar `playwright-core` conforme o padrão existente, com configuração local explícita. Não disparar e-mails reais.
- Comandos previstos: `node --test tests/navigation.test.cjs tests/schedule-media.test.cjs`, `pnpm local:test`, executor de navegador adotado, `pnpm exec tsc --noEmit`, `pnpm build` e `pnpm lint`.
- Integração exige infraestrutura local disponível. Não afirmar cobertura executada quando houver dependências ausentes; documentar o bloqueio e o critério ainda pendente.

## 6. Implantação, recuperação e conclusão

1. Validar a aplicação e eventual migração em ambiente local com dados fictícios. Revisar políticas/grants antes de qualquer execução remota autorizada.
2. Se houver migração, atualizar o fluxo local e definir ordem de implantação compatível; aplicar restrições de segurança antes de liberar a consulta. Não deixar intervalo conhecido de exposição de rascunhos.
3. Após autorização separada de deploy, executar smoke check com mídia: menu, atribuição, horários, visão geral, erro recuperável e negativa de acesso administrativo; conferir regressão de ministro/admin.
4. Em falha, retirar a liberação de navegação/rota ou voltar ao artefato compatível, sem relaxar RLS, reabrir escritas ou apagar dados. Eventual reversão de esquema exige revisão específica.
5. Não alterar versão, catálogo de novidades ou publicar release apenas pela criação/execução deste plano; coordenar a comunicação em etapa de entrega autorizada.

**Condição de conclusão:** CA-01 a CA-11 com evidências, nenhum caminho conhecido permitindo gestão de escala por mídia ou leitura de rascunhos/outra igreja, regressões verificadas e limitações manuais explicitadas. Revisão humana e implantação permanecem etapas independentes.
