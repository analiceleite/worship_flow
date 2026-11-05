# Plano de implementação — WF-34

**SPEC:** `SDD/SPEC-WF-34-release-notes.md`  
**Branch:** `feature/wf-34-release-notes`  
**Estado:** Decisões de produto fechadas; inspeção técnica e implementação pendentes.

## Decisões já aprovadas

- Versionamento SemVer, começando em `1.0.0`.
- Novidades globais para todas as igrejas no MVP; sem segmentação por igreja.
- Abrir a central marca como lidas as novidades visíveis naquele momento.
- Leitura persistida por usuário e sincronizada entre dispositivos.
- Novidades publicadas depois voltam a ser não lidas; abrir somente menu/indicador não marca como lido.

## Princípios

- Não anunciar funcionalidade antes da implantação e verificação.
- Não interromper tarefas com modal para novidades comuns.
- Minimizar complexidade operacional; começar com conteúdo versionado no repositório e sem painel de administração.
- Preservar autenticação, autorização e isolamento por igreja já existentes.
- Validar a implementação final contra a SPEC e atualizar esta lista à medida que decisões forem fechadas.

## Fase 0 — Refinar decisões bloqueadoras

Antes de definir modelo de dados e interface, fechar na SPEC:

- [x] D-02: SemVer injetado no build, associado ao deploy; smoke check confirma disponibilidade.
- [x] D-03: versão discreta na área “Sobre”/perfil.
- [x] D-04: todos os usuários autenticados, sem segmentação por perfil.
- [x] D-07: catálogo JSON versionado com ID estável e campos obrigatórios definidos na SPEC.
- [x] D-08: MVP com central + indicador discreto para melhorias relevantes; sem correções menores, banners ou orientações contextuais.
- [x] D-09: nota incluída no mesmo deploy da funcionalidade e validada pelo checklist/smoke check.
- [x] D-10: histórico sem limite inicial; reavaliar paginação/arquivo conforme volume.
- [x] Regra de leitura concorrente definida em D-06: snapshot das novidades visíveis ao abrir a central.

**Saída:** SPEC atualizada e decisões fechadas suficientes para implementar sem suposições sobre release, persistência ou público.

## Fase 1 — Inspecionar padrões existentes

- [x] Examinar autenticação/contexto de igreja, esquema SQL e políticas RLS atuais.
- [x] Revisar layout/navegação compartilhados, componentes de menu, perfil e estados de carregamento/erro.
- [x] Revisar pipeline de build/deploy e convenções atuais de release/versionamento.
- [x] Determinar se a leitura cabe em persistência existente ou requer tabela/migração.
- [x] Registrar impactos e riscos de compatibilidade antes de editar.

**Saída:** decisão técnica documentada, incluindo se haverá migração e os testes necessários.

### Resultado da inspeção técnica (2026-11-05)

- Autenticação usa Supabase; `getCurrentMinisterContext()` fornece identidade/contexto e as políticas multi-tenant em `scripts/031_simple_multitenancy_rls.sql` isolam dados de igreja via `get_current_church_id()`.
- `components/header.tsx` concentra navegação autenticada desktop/mobile; `app/profile/page.tsx` já é uma página autenticada adequada para mostrar a versão. Não há layout raiz autenticado separado identificado na estrutura atual.
- Não foram encontrados workflows de release/deploy em `.github/workflows/`. O `package.json` declara versão `0.1.0`, que não deve ser usada como fonte confiável da versão implantada sem alinhamento com a versão SemVer do produto.
- O catálogo JSON será conteúdo global estático, sem RLS nem dados de igreja. A leitura sincronizada precisa persistência remota por `auth.uid()`; não há armazenamento existente apropriado identificado. Será necessária tabela/migração com política estrita de leitura/escrita do próprio usuário, sem `church_id` (identidade da conta é global e o registro não contém conteúdo de tenant).
- A ausência de pipeline automatizado encontrado significa que a estratégia de build deve funcionar também em deploy manual: fonte explícita de versão injetável no build, fallback seguro quando ausente e documentação do passo de deploy/tag. Não tratar variável de build sozinha como prova de implantação.
- A baseline foi `1.0.0` (incluindo WF-31); após o deploy verificado de WF-34, a versão atual é `1.1.0`. Manter `package.json` e `NEXT_PUBLIC_APP_VERSION` alinhados nos próximos releases.
- Risco a validar no desenho da leitura: abrir a central deve gravar apenas o conjunto de IDs/versões que a API retornou naquele carregamento; itens adicionados depois permanecem não lidos. Falha de gravação não deve bloquear a navegação.

**Decisão técnica:** catálogo global em JSON no repositório + tabela remota dedicada de leituras por usuário, com RLS baseada em `auth.uid()` e sem chave de igreja. Criar migração SQL numerada após a última existente (033), API autenticada e testes de isolamento entre usuários; a aplicação continua usando contexto Supabase/RLS, sem service role para operações de leitura.

## Fase 2 — Versionamento rastreável

- [x] Implementar fonte de versão definida em D-02 via `NEXT_PUBLIC_APP_VERSION`, validada como SemVer; deploy continua exigindo smoke check.
- [x] Expor versão em “Sobre” na página de perfil.
- [x] Documentar convenção/processo operacional em `sdd/plan/WF-34-release-process.md`.
- [x] Ausência/invalidade de versão mostra estado informativo sem bloquear navegação.

**Saída:** versão da aplicação identificável e coerente com a estratégia de deploy aprovada.

## Fase 3 — Catálogo e central de novidades

- [x] Criar tipo de novidade com ID estável, título, data, resumo, destino opcional, estado de publicação e opção de não disparar indicador.
- [x] Armazenar catálogo em `content/release-notes.json`, sem painel administrativo.
- [x] Criar central com estados vazio, carregando e erro, ordenada por data/ID.
- [x] Restringir destinos a caminhos internos e usar elementos semânticos responsivos.
- [x] Filtrar itens futuros e não publicados no servidor.

**Saída:** usuários elegíveis consultam o histórico publicado sem ver conteúdo prematuro.

## Fase 4 — Indicador e leitura sincronizada

- [x] Implementar indicador discreto no menu desktop/mobile.
- [x] Abrir a central registra o snapshot retornado pela API como lido.
- [x] Apenas abrir menu/indicador não marca leitura.
- [x] Persistir por usuário via tabela Supabase e sincronizar por consultas autenticadas.
- [x] Notas adicionadas após o snapshot não são incluídas na gravação e voltam a aparecer como não lidas.
- [ ] Testar acesso concorrente, falhas de rede e sessão expirada; definir fallback sem bloquear navegação.
- [ ] Testar isolamento por usuário e igreja, inclusive consultas diretas às APIs/tabelas.

**Saída:** indicador e leitura seguem a decisão D-06 sem perda de estado ou vazamento entre tenants.

## Fase 5 — Publicação e operação

- [ ] Definir checklist: deploy concluído, smoke checks aprovados, novidade publicada e link verificado.
- [x] Criar orientação curta de publicação em `sdd/plan/WF-34-release-process.md`.
- [x] Associar cada nota a versão/release e orientar smoke check.
- [ ] Manter e-mail/push e painel administrativo fora do MVP, salvo decisão explícita decorrente de validação.

**Saída:** processo reproduzível para publicar notas sem depender de WhatsApp para anúncios comuns.

## Fase 6 — Validação e entrega

- [ ] Testes unitários para ordenação, publicação, leitura e identificação de novidades novas.
- [ ] Testes de API/RLS e isolamento entre usuários/igrejas, se houver persistência remota.
- [ ] Testes de interface: vazio, erro, não lidas, abertura da central, responsividade e acessibilidade.
- [ ] Validar versão apresentada no artefato implantado e no ambiente de deploy.
- [ ] Fazer revisão de conteúdo e confirmar que só mudanças já implantadas são anunciadas.
- [ ] Registrar evidências na tarefa/PR e atualizar SPEC com decisões finais.

**Saída:** critérios de aceite do WF-34 atendidos e release pronta para revisão.

## Riscos e pontos de atenção

- Conteúdo versionado no repositório ainda exige deploy para publicar; confirmar se isso é aceitável para o processo da equipe.
- Persistência de leitura por usuário pode exigir migração e políticas RLS; manter escopo global das novidades separado do estado individual de leitura.
- Uma tag/build não garante sozinha que a versão foi implantada; a exibição deve refletir a origem de versão escolhida e o processo precisa confirmar o deploy.
- “Abrir a central” deve marcar apenas o conjunto exibido naquele momento, para que publicações posteriores apareçam como novas.
- Usar segmentação por perfil só após validação; não confundir visibilidade de conteúdo com autorização para acessar funcionalidades.

## Checklist de progresso

- [x] SPEC inicial criada.
- [x] D-01 — SemVer a partir de `1.0.0`.
- [x] D-05 — novidades globais no MVP, sem segmentação por igreja.
- [x] D-06 — abrir a central marca como lidas as novidades visíveis; estado por usuário sincronizado.
- [x] Decisões restantes fechadas na SPEC.
- [ ] Refinamento técnico baseado nos padrões atuais do repositório.
- [ ] Implementação, testes e revisão.
