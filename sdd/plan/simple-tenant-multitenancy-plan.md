# PLAN: Multitenancy Simples Por Igreja

Spec relacionada: `sdd/spec/simple-tenant-multitenancy-spec.md`

## Objetivo Do Plano

Implementar multitenancy simples no Worship Flow, onde cada usuario pertence a uma unica igreja e todos os dados operacionais sao isolados por `church_id`.

O plano deve permitir:

- Igrejas reais usando a mesma instancia como SaaS.
- Igrejas demo e teste interno no mesmo ambiente.
- Admins gerenciando apenas a propria igreja.
- `super_admin` global gerenciando igrejas e impersonando uma igreja para suporte/demonstracao.

## Principios De Implementacao

- Resolver `church_id` sempre pelo usuario autenticado ou por fluxo explicito de impersonacao.
- Nunca confiar em `church_id` vindo do frontend para operacoes sensiveis.
- Toda query em tabela tenant-scoped deve ter filtro por `church_id` ou estar protegida por RLS equivalente.
- Toda query com `createAdminClient()` em tabela tenant-scoped deve aplicar `church_id` manualmente.
- Implementar em fases pequenas, mantendo o app funcionando entre fases.
- Primeiro adicionar estrutura e compatibilidade, depois endurecer constraints e policies.

## Fase 0: Preparacao E Inventario

### 0.1 Confirmar schema atual

- Revisar migrations em `scripts/`.
- Listar tabelas tenant-scoped existentes.
- Confirmar nomes reais das colunas de publicacao, notificacao, ensaio e integracoes.
- Confirmar se existem migrations nao documentadas para `schedule_notifications`, Google Calendar ou storage.

Resultado esperado:

- Lista final das tabelas que receberao `church_id`.
- Lista final das tabelas que permanecerao globais.

### 0.2 Mapear pontos de acesso a dados

- Buscar todas as ocorrencias de `createAdminClient()`.
- Buscar todas as ocorrencias de `.from('ministers')`.
- Buscar todas as ocorrencias de `.from('songs')`.
- Buscar todas as ocorrencias de `.from('repertoire')`.
- Buscar todas as ocorrencias de `.from('special_events')`.
- Buscar todas as ocorrencias de `.from('schedule_quarters')`.
- Buscar todas as ocorrencias de `.from('schedule_assignments')`.
- Buscar todas as ocorrencias de `.from('schedule_rehearsals')`.

Resultado esperado:

- Checklist concreto de arquivos que precisarao ser alterados nas fases seguintes.

### 0.3 Verificacao da Fase 0

- Nenhuma mudanca funcional obrigatoria.
- Confirmar que o inventario cobre paginas, APIs, libs, scripts e migrations.

Resultado esperado:

- Escopo de alteracao fechado antes de modificar o banco.

## Fase 1: Schema Base E Backfill

### 1.1 Criar tabela `churches`

- Criar migration para `public.churches`.
- Incluir campos `name`, `slug`, `status`, `environment`, `email_mode`, `plan`, `created_at`, `updated_at`.
- Adicionar checks para `status`, `environment` e `email_mode`.
- Criar uma igreja default para os dados existentes.

Resultado esperado:

- Tabela `churches` existe.
- Ha uma igreja default para backfill.

### 1.2 Criar tabelas de plataforma

- Criar migration para `public.platform_admins`.
- Criar migration para `public.platform_impersonation_audit`.
- Adicionar indices necessarios para auditoria por `platform_user_id`, `church_id` e `created_at`.

Resultado esperado:

- Super admins podem ser modelados sem misturar papel global em `ministers.role`.
- Existe estrutura para auditar impersonacao.

### 1.3 Adicionar `church_id` nullable nas tabelas tenant-scoped

- Adicionar `church_id` nullable em `ministers`.
- Adicionar `church_id` nullable em `songs`.
- Adicionar `church_id` nullable em `repertoire`.
- Adicionar `church_id` nullable em `special_events`.
- Adicionar `church_id` nullable em `schedule_quarters`.
- Adicionar `church_id` nullable em `schedule_assignments`.
- Adicionar `church_id` nullable em `schedule_rehearsals`, se a tabela existir.
- Adicionar `church_id` nullable em `schedule_email_notifications`.
- Adicionar `church_id` nullable em tabelas de Google Calendar, se existirem no ambiente.
- Avaliar e adicionar `church_id` em outras tabelas tenant-scoped encontradas na Fase 0.

Resultado esperado:

- Schema aceita `church_id` sem quebrar dados existentes.

### 1.4 Backfill dos dados existentes

- Preencher todos os `church_id` nulos com a igreja default.
- Para tabelas derivadas, usar a igreja default ou derivar de relações existentes quando possivel.
- Validar contagens antes/depois.

Resultado esperado:

- Todos os dados existentes pertencem a uma igreja default.

### 1.5 Adicionar indices iniciais

- Criar indices por `church_id` nas tabelas principais.
- Criar indices compostos usados em filtros frequentes, por exemplo `church_id + active`, `church_id + event_date`, `church_id + quarter_id`.
- Criar unique parcial para uma escala publicada por igreja, se os dados ja permitirem.

Resultado esperado:

- Queries escopadas por igreja nao ficam sem indices basicos.

### 1.6 Verificacao da Fase 1

- Rodar SQL de validacao para confirmar zero `church_id` nulo nas tabelas preenchidas.
- Rodar app localmente e confirmar fluxo atual ainda funcionando com igreja default.
- Rodar `pnpm lint`.

Resultado esperado:

- Banco preparado para multitenancy sem endurecimento final ainda.

## Fase 2: Contexto De Usuario E Plataforma

### 2.1 Atualizar tipos TypeScript

- Adicionar `church_id` em `Minister`, `Song` e demais tipos relevantes em `lib/types.ts`.
- Adicionar tipo para `Church`.
- Adicionar tipo para contexto autenticado com igreja.

Resultado esperado:

- Tipos representam o novo modelo de dados.

### 2.2 Criar helper de contexto de igreja

- Criar helper server-side `getCurrentMinisterContext()` ou equivalente.
- Resolver usuario autenticado via Supabase Auth.
- Buscar ministro por `user_id`.
- Retornar `userId`, `ministerId`, `churchId`, `role`, `isAdmin`.
- Criar opcao para exigir admin da igreja.

Resultado esperado:

- APIs deixam de duplicar logica de autenticacao e resolucao de igreja.

### 2.3 Criar helper de plataforma

- Criar helper `authenticatePlatformAdmin()`.
- Validar usuario autenticado.
- Verificar existencia em `platform_admins`.
- Retornar contexto de plataforma.

Resultado esperado:

- Rotas internas de plataforma nao dependem de `ministers.role`.

### 2.4 Implementar contexto de impersonacao

- Definir mecanismo de guardar igreja impersonada, preferencialmente cookie httpOnly ou sessao server-side.
- Criar helper para iniciar impersonacao.
- Criar helper para encerrar impersonacao.
- Criar helper para resolver contexto efetivo quando `platform_admin` estiver impersonando.
- Registrar auditoria ao iniciar, encerrar e executar acoes relevantes.

Resultado esperado:

- `super_admin` consegue operar dentro de uma igreja de forma explicita e auditavel.

### 2.5 Verificacao da Fase 2

- Testar usuario comum resolvendo propria igreja.
- Testar admin de igreja resolvendo propria igreja.
- Testar usuario em `platform_admins` acessando helper de plataforma.
- Testar usuario fora de `platform_admins` sendo bloqueado.
- Rodar `pnpm lint`.

Resultado esperado:

- Contexto de igreja e plataforma pronto para uso nas APIs.

## Fase 3: RLS Tenant-Aware

### 3.1 Criar helpers SQL

- Criar ou atualizar `get_current_minister_id()`.
- Criar `get_current_church_id()`.
- Criar `is_church_admin(church_id uuid)`.
- Avaliar helper separado para platform admin apenas se estritamente necessario.

Resultado esperado:

- Policies podem consultar igreja e role do usuario autenticado.

### 3.2 Reescrever policies de leitura

- Atualizar policy de `ministers` para leitura apenas da propria igreja.
- Atualizar policy de `songs` para leitura apenas da propria igreja.
- Atualizar policy de `repertoire` para leitura apenas da propria igreja.
- Atualizar policy de `special_events` para leitura apenas da propria igreja.
- Adicionar/atualizar RLS em tabelas `schedule_*` tenant-scoped.

Resultado esperado:

- Usuario autenticado nao le dados de outra igreja via Supabase client.

### 3.3 Reescrever policies de escrita

- Garantir inserts com `church_id = get_current_church_id()`.
- Garantir updates/deletes apenas dentro da propria igreja.
- Manter regras atuais de owner/admin quando aplicavel.
- Admin de igreja pode gerenciar dados da propria igreja.
- Ministro comum nao ganha permissao administrativa nova.

Resultado esperado:

- Escritas client-side e server-side respeitam isolamento por igreja.

### 3.4 Storage policies para cifras

- Atualizar paths novos para `{church_id}/{song_id}/cifra.pdf`.
- Rever policies do bucket `cifras`.
- Se as policies ficarem complexas, mover upload/delete/assinatura para API server-side.

Resultado esperado:

- Arquivos de cifras nao sao acessiveis por usuarios de outra igreja.

### 3.5 Verificacao da Fase 3

- Criar dois usuarios em igrejas diferentes.
- Confirmar que query direta client-side nao retorna dados cruzados.
- Confirmar que insert com `church_id` de outra igreja falha.
- Confirmar que storage nao permite acesso cruzado.
- Rodar `pnpm lint`.

Resultado esperado:

- Isolamento basico garantido pelo banco para acesso autenticado comum.

## Fase 4: APIs Criticas De Escala E Admin

### 4.1 Atualizar rotas de schedule quarters

- Atualizar `app/api/schedule/quarters/route.ts`.
- Listar quarters por `church_id`.
- Criar quarter com `church_id` do contexto.
- Buscar quarter anterior apenas da mesma igreja.
- Verificar duplicidade de periodo apenas dentro da mesma igreja.
- Replicar assignments apenas da mesma igreja.
- Exigir admin da igreja em criacao/alteracao quando aplicavel.

Resultado esperado:

- Cada igreja tem sua propria linha temporal de escalas.

### 4.2 Atualizar publicacao de escala

- Atualizar `app/api/schedule/quarters/[id]/publish/route.ts`.
- Buscar quarter por `id + church_id`.
- Despublicar apenas outros quarters da mesma igreja.
- Publicar apenas quarter da igreja atual.
- Exigir admin da igreja.

Resultado esperado:

- Publicar escala da Igreja A nao altera Igreja B.

### 4.3 Atualizar assignments e rehearsals

- Atualizar `app/api/schedule/assignment/route.ts`.
- Atualizar `app/api/schedule/quarters/[id]/assignments/route.ts`.
- Atualizar `app/api/schedule/rehearsal/route.ts`.
- Validar `quarter_id` dentro da igreja atual antes de ler/escrever.
- Validar `minister_id` dentro da igreja atual quando informado.
- Exigir admin da igreja para alteracoes administrativas.

Resultado esperado:

- Assignments e ensaios nao aceitam IDs de outra igreja.

### 4.4 Atualizar escala atual

- Atualizar `app/api/schedule/current/route.ts`.
- Buscar ultimo quarter publicado por `church_id`.
- Buscar roles globais e assignments da igreja atual.

Resultado esperado:

- Cada igreja ve sua propria escala publicada.

### 4.5 Atualizar APIs de ministros

- Atualizar `app/api/ministers/create/route.ts`.
- Atualizar `app/api/ministers/[id]/route.ts`.
- Atualizar `app/api/ministers/search/route.ts`.
- Criar ministro sempre com `church_id` do admin atual ou do fluxo de plataforma autorizado.
- Deletar/desativar ministro apenas por `id + church_id`.
- Evitar deletar `auth.user` se regra futura permitir outro uso; no modelo atual, pode manter comportamento com cuidado.

Resultado esperado:

- Admin de igreja gerencia apenas ministros da propria igreja.

### 4.6 Verificacao da Fase 4

- Testar criacao de quarter como admin.
- Testar bloqueio de criacao de quarter como ministro comum.
- Testar publicacao independente em duas igrejas.
- Testar tentativa de alterar assignment de outra igreja por chamada direta.
- Testar busca de ministros isolada por igreja.
- Rodar `pnpm lint`.

Resultado esperado:

- APIs administrativas mais criticas ficam tenant-aware e role-aware.

## Fase 5: Musicas, Repertorio E Paginas Client-Side

### 5.1 Atualizar pagina e formulario de musicas

- Atualizar `app/songs/page.tsx` para listar musicas da propria igreja.
- Atualizar lista de ministros ativos para propria igreja.
- Garantir insert de musica com `church_id` correto.
- Garantir update/delete por `id + church_id` quando via API/service role.
- Ajustar upload/atualizacao de PDF para path com `church_id`.

Resultado esperado:

- Musicas e cifras ficam isoladas por igreja.

### 5.2 Atualizar repertorio

- Atualizar `app/repertoire/page.tsx`.
- Buscar `special_events`, `songs`, `ministers` e `repertoire` por igreja.
- Inserir repertorio com `church_id`.
- Deletar repertorio por `id + church_id`.
- Deletar por `event_name + event_date + church_id`, nunca apenas data/evento.
- Inserir eventos especiais com `church_id`.

Resultado esperado:

- Igrejas podem ter repertorios na mesma data/evento sem colisao.

### 5.3 Atualizar player de repertorio

- Atualizar `app/repertoire/player/page.tsx`.
- Buscar repertorio por `event_date + event_name + church_id`.
- Garantir que songs/ministers relacionados pertencem a mesma igreja.

Resultado esperado:

- Player nao mostra dados de outra igreja.

### 5.4 Atualizar usuarios e demais paginas

- Atualizar `app/users/page.tsx` para listar apenas ministros da propria igreja.
- Atualizar qualquer pagina de schedule que use dados diretos sem escopo.
- Preferir APIs quando a regra de autorizacao for complexa.

Resultado esperado:

- UI principal passa a refletir apenas a igreja atual.

### 5.5 Verificacao da Fase 5

- Criar musicas com titulos iguais em igrejas diferentes.
- Criar repertorio na mesma data/evento em igrejas diferentes.
- Confirmar isolamento visual e via API direta.
- Rodar `pnpm lint`.

Resultado esperado:

- Fluxos operacionais do usuario comum funcionam em duas igrejas isoladas.

## Fase 6: Plataforma Interna E Impersonacao

### 6.1 Criar area interna de plataforma

- Criar rota/tela interna para listar igrejas.
- Criar formulario de igreja com `name`, `slug`, `status`, `environment`, `email_mode`, `plan`.
- Proteger tela e APIs com `authenticatePlatformAdmin()`.

Resultado esperado:

- Apenas `super_admin` gerencia igrejas.

### 6.2 Criar APIs de plataforma

- Criar endpoint para listar igrejas.
- Criar endpoint para criar igreja.
- Criar endpoint para editar igreja.
- Criar endpoint para desativar igreja.
- Validar regra: `environment in ('demo', 'test')` nao pode ter `email_mode = 'real'`.

Resultado esperado:

- Igrejas reais, demo e teste podem ser gerenciadas pela UI interna.

### 6.3 Implementar impersonacao na UI

- Adicionar acao de iniciar impersonacao em uma igreja.
- Adicionar banner/indicador global de impersonacao.
- Adicionar acao de encerrar impersonacao.
- Garantir que contexto efetivo usa `church_id` impersonado.
- Registrar auditoria.

Resultado esperado:

- `super_admin` consegue entrar no contexto de uma igreja e sair com clareza visual.

### 6.4 Verificacao da Fase 6

- Usuario sem `platform_admins` nao acessa area interna.
- Usuario com `platform_admins` cria igreja demo.
- App bloqueia demo/teste com email real.
- `super_admin` inicia e encerra impersonacao.
- Banner de impersonacao aparece em todas as telas relevantes.
- Rodar `pnpm lint`.

Resultado esperado:

- Plataforma interna pronta para criar tenants e dar suporte.

## Fase 7: Notificacoes E Integracoes

### 7.1 Atualizar enfileiramento de notificacoes

- Atualizar endpoints em `app/api/notifications/schedule/*`.
- Buscar quarters publicados por igreja.
- Enfileirar notificacoes com `church_id`.
- Incluir `church_id` na deduplicacao.

Resultado esperado:

- Notificacoes equivalentes de igrejas diferentes nao colidem.

### 7.2 Atualizar processamento da fila

- Respeitar `churches.email_mode`.
- Bloquear envio real para `environment = 'demo'` ou `environment = 'test'`.
- Redirecionar para `SCHEDULE_EMAIL_TEST_RECIPIENT` quando `email_mode = 'test_recipient'`.
- Marcar como ignorado quando `email_mode = 'disabled'`.
- Manter remetente global por ambiente.

Resultado esperado:

- Demo/teste nunca enviam emails reais.

### 7.3 Atualizar Google Calendar, se ativo

- Adicionar `church_id` em tokens/maps conforme schema.
- Buscar assignments, rehearsals e quarters por igreja.
- Garantir que jobs globais iteram igrejas ou aplicam `church_id` por item.

Resultado esperado:

- Integracao de calendario nao cruza dados entre igrejas.

### 7.4 Verificacao da Fase 7

- Testar envio real em igreja production.
- Testar bloqueio/redirecionamento em igreja demo.
- Testar dedupe igual em duas igrejas diferentes.
- Rodar `pnpm lint`.

Resultado esperado:

- Notificacoes e integracoes ficam tenant-aware.

## Fase 8: Hardening Final Do Banco

### 8.1 Tornar `church_id` obrigatorio

- Validar que nao existem nulos.
- Alterar colunas tenant-scoped para `not null`.
- Adicionar FKs para `churches(id)`.

Resultado esperado:

- Nao e mais possivel criar dados operacionais sem igreja.

### 8.2 Ajustar constraints e uniques

- Garantir `ministers.user_id unique`.
- Revisar `ministers.email unique` conforme decisao de usuario unico global.
- Criar unique parcial de escala publicada por igreja.
- Criar unique composto para dedupe de notificacoes por igreja.
- Ajustar outros indices globais que deveriam ser por igreja.

Resultado esperado:

- Constraints refletem modelo multitenant simples.

### 8.3 Reforcar consistencia de mesmo tenant

- Adicionar validacoes de mesmo tenant nas APIs restantes.
- Avaliar constraints compostas ou triggers para FKs criticas.
- Garantir que `minister_id`, `song_id`, `quarter_id` e `church_id` nao podem divergir em tabelas relacionais.

Resultado esperado:

- Risco de associar dados entre igrejas fica minimizado.

### 8.4 Remover policies antigas permissivas

- Revisar todas as policies com `USING (true)`.
- Remover policies antigas que exponham dados globais.
- Confirmar RLS habilitada nas tabelas tenant-scoped.

Resultado esperado:

- RLS final esta alinhada ao isolamento por igreja.

### 8.5 Verificacao da Fase 8

- Rodar queries de validacao de nulos.
- Testar inserts invalidos sem `church_id`.
- Testar tentativa de relacionar entidade de outra igreja.
- Rodar `pnpm lint`.
- Rodar `pnpm build`, se ambiente estiver configurado.

Resultado esperado:

- Banco endurecido para operacao multitenant.

## Fase 9: Testes Manuais Finais

### 9.1 Preparar massa de teste

Criar:

- Igreja A.
- Igreja B.
- Demo Worship Flow.
- Teste Interno.
- 1 admin por igreja.
- 1 ministro comum por igreja.
- 2 musicas por igreja.
- 1 escala publicada por igreja.
- 1 repertorio na mesma data/evento em Igreja A e Igreja B.

Resultado esperado:

- Ambiente cobre os principais cenarios de isolamento.

### 9.2 Validar isolamento operacional

- Login como admin A nao mostra dados B.
- Login como ministro A nao mostra dados B.
- API direta tentando acessar ID da igreja B retorna erro ou vazio.
- Publicar escala A nao altera escala B.
- Repertorio com mesma data/evento em A e B nao colide.
- Notificacao de A nao inclui ministro B.

Resultado esperado:

- Nenhum vazamento ou colisao cross-tenant nos fluxos principais.

### 9.3 Validar plataforma

- Usuario sem `platform_admins` nao acessa area interna.
- Usuario com `platform_admins` cria, edita e desativa igreja.
- Usuario com `platform_admins` impersona Igreja A.
- Banner de impersonacao aparece.
- Encerrar impersonacao retorna ao contexto normal.
- Auditoria registra inicio/fim de impersonacao.

Resultado esperado:

- Suporte/plataforma funciona sem virar permissao global acidental para usuarios comuns.

### 9.4 Validar emails demo/teste

- Demo Worship Flow nao envia email real.
- Teste Interno nao envia email real.
- `email_mode = 'test_recipient'` redireciona para destinatario de teste.
- `email_mode = 'disabled'` ignora envio de forma rastreavel.

Resultado esperado:

- Tenants de demo/teste sao seguros para uso interno.

## Sequencia Recomendada De Commits

1. `feat: add churches schema and backfill tenant ids`
2. `feat: add platform admins and impersonation audit`
3. `feat: add church auth context helpers`
4. `feat: scope rls policies by church`
5. `feat: scope schedule APIs by church`
6. `feat: scope songs and repertoire by church`
7. `feat: add platform church management`
8. `feat: add platform impersonation`
9. `feat: scope notifications by church`
10. `feat: harden tenant constraints`
11. `docs: document simple multitenancy setup`

## Checklist Final

- `churches` criada.
- `platform_admins` criada.
- `platform_impersonation_audit` criada.
- Todas as tabelas tenant-scoped possuem `church_id not null`.
- Dados legados associados a igreja default.
- `ministers.user_id` unico.
- RLS filtra por `church_id`.
- Policies antigas permissivas removidas.
- APIs com `createAdminClient()` revisadas.
- Schedule quarters sao por igreja.
- Publicacao de escala e por igreja.
- Songs sao por igreja.
- Repertoire e special events sao por igreja.
- Notifications sao por igreja.
- Demo/teste nao enviam emails reais.
- Storage de cifras isolado por igreja.
- Area interna de igrejas protegida por `platform_admins`.
- Impersonacao tem indicador visual e auditoria.
- `pnpm lint` executado.
- `pnpm build` executado quando possivel.
