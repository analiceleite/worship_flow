# SPEC: Multitenancy Simples Por Igreja

## Contexto

O Worship Flow hoje funciona como uma aplicacao single-tenant: todos os ministros, musicas, repertorios, escalas, eventos e notificacoes pertencem implicitamente a uma unica igreja.

O objetivo desta mudanca e permitir que varias igrejas usem a mesma instancia do sistema, mantendo isolamento de dados entre elas. O caso de uso principal e permitir ambientes separados para:

- Testes internos.
- Demonstracoes.
- Igrejas reais usando o produto como SaaS.

Decisao de produto: um usuario pertence a apenas uma igreja.

Isso permite um modelo multitenant simples, sem troca de igreja, sem usuario com multiplas memberships e sem roles diferentes por igreja para o mesmo login.

## Problema

O modelo atual nao possui uma dimensao de tenant. Isso causa os seguintes bloqueios para SaaS/testes/demo:

- Dados de todas as igrejas ficariam misturados no mesmo banco.
- Um admin seria admin global, nao admin da propria igreja.
- Queries de musicas, ministros, repertorios e escalas retornam dados globais.
- RLS atual permite leitura ampla para usuarios autenticados em varias tabelas.
- APIs com `createAdminClient()` ignoram RLS e precisam aplicar escopo manualmente.
- Publicacao de escala assume que so existe uma escala publicada globalmente.
- Notificacoes e deduplicacao sao globais.
- Arquivos de cifras ficam em storage global sem isolamento por igreja.

## Objetivo

Adicionar multitenancy simples por igreja, garantindo que cada usuario autenticado acesse e altere apenas dados da sua igreja.

Modelo alvo:

```txt
1 auth.users.id
  -> 1 ministers.user_id
  -> 1 ministers.church_id
  -> 1 churches.id
```

O resultado esperado e:

```txt
Usuario loga
  -> app resolve o ministro atual
  -> app resolve church_id do ministro
  -> todas as leituras/escritas sao escopadas por church_id
  -> admins gerenciam apenas dados da propria igreja
```

## Nao Objetivos

- Nao permitir que o mesmo usuario participe de varias igrejas.
- Nao implementar tenant switcher.
- Nao implementar subdominio por igreja na primeira entrega.
- Nao criar billing/assinaturas nesta SPEC.
- Nao criar painel de super admin completo nesta SPEC.
- Nao separar bancos por igreja.
- Nao manter compatibilidade com dados sem `church_id` depois da migracao final.

## Decisoes Tecnicas

### Decisoes Da Review

- Novas igrejas serao criadas por uma tela interna administrativa.
- Existira um papel global de plataforma chamado `super_admin`.
- `super_admin` deve ser modelado em tabela separada, nao em `ministers.role`.
- `super_admin` pode gerenciar igrejas e impersonar uma igreja para suporte/demonstracao.
- O remetente de emails sera global por agora.
- Igrejas demo/teste nunca devem enviar emails reais.
- `schedule_roles` permanece global por agora.

### Nome Da Entidade

Usar `churches` e `church_id`.

Motivos:

- O dominio do produto e explicitamente voltado para igrejas/ministerios.
- O nome fica claro para equipe e para futuras telas administrativas.
- Evita abstracao prematura com `tenant` quando a entidade real e igreja.

### Modelo De Usuario

Manter `ministers` como perfil de dominio do usuario.

Regras:

- `ministers.user_id` deve ser unico.
- `ministers.church_id` deve ser obrigatorio.
- `ministers.role` continua existindo, mas passa a valer somente dentro da igreja do ministro.
- `admin` deixa de significar admin global.
- `super_admin` nao deve ser valor de `ministers.role`; ele pertence ao nivel da plataforma.

### Modelo De Plataforma

Criar uma tabela separada para administradores globais da plataforma.

Tabela sugerida:

```sql
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
```

Regras:

- `platform_admins` identifica usuarios com permissao global de plataforma.
- `platform_admins` nao substitui `ministers`.
- Um `super_admin` pode tambem ter um registro em `ministers` para usar uma igreja propria/teste.
- Permissoes de igreja continuam sendo governadas por `ministers.role` dentro de `church_id`.
- Acesso cross-tenant so deve ocorrer em fluxos explicitamente marcados como plataforma ou impersonacao.

### Impersonacao

`super_admin` podera impersonar uma igreja para suporte e demonstracao.

Regras iniciais:

- Impersonacao deve exigir usuario presente em `platform_admins`.
- O contexto impersonado deve ser explicito e auditavel.
- Durante impersonacao, queries devem usar o `church_id` impersonado.
- A UI deve indicar claramente que o usuario esta em modo impersonacao.
- Acoes destrutivas durante impersonacao devem ser evitadas na primeira versao ou exigir confirmacao explicita.
- Toda acao impersonada relevante deve registrar `platform_user_id`, `impersonated_church_id`, acao e data.

Tabela de auditoria sugerida:

```sql
create table public.platform_impersonation_audit (
  id uuid primary key default gen_random_uuid(),
  platform_user_id uuid not null references auth.users(id),
  church_id uuid not null references public.churches(id),
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

Na primeira entrega, a impersonacao pode ser limitada a leitura e operacoes de suporte/demonstracao. Se escrita for permitida, ela deve passar pelas mesmas regras de tenant e registrar auditoria.

### Resolucao De Igreja Atual

O app nao deve receber `church_id` confiavel do frontend para operacoes sensiveis.

Toda API deve resolver a igreja a partir do usuario autenticado:

```txt
auth.users.id
  -> ministers.user_id
  -> ministers.church_id
```

Excecao: fluxos de plataforma com impersonacao podem usar o `church_id` impersonado, desde que o usuario esteja validado em `platform_admins` e a acao seja auditada.

Criar helper recomendado:

```txt
getCurrentMinisterContext()
```

Retorno sugerido:

```ts
type CurrentMinisterContext = {
  userId: string
  ministerId: string
  churchId: string
  role: 'admin' | 'minister' | 'midia'
  isAdmin: boolean
}
```

## Modelo De Dados

### Nova Tabela `churches`

Campos sugeridos:

```sql
create table public.churches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'inactive')),
  environment text not null default 'production' check (environment in ('production', 'demo', 'test')),
  email_mode text not null default 'real' check (email_mode in ('real', 'disabled', 'test_recipient')),
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Observacoes:

- `slug` pode ser usado futuramente em URL, demonstracoes ou suporte.
- `status` permite desativar uma igreja sem remover dados.
- `environment` diferencia igrejas reais, demo e teste interno.
- `email_mode` controla se a igreja pode enviar emails reais.
- `plan` prepara o caminho para SaaS, sem implementar billing agora.

Regra de email:

- Igrejas com `environment in ('demo', 'test')` devem usar `email_mode = 'disabled'` ou `email_mode = 'test_recipient'`.
- Igrejas demo/teste nunca devem enviar emails reais.
- O remetente permanece global por ambiente nesta primeira versao.

### Tabelas Que Devem Receber `church_id`

Obrigatorias:

- `ministers`
- `songs`
- `repertoire`
- `special_events`
- `schedule_quarters`
- `schedule_assignments`
- `schedule_rehearsals`
- `schedule_email_notifications`

Integracoes:

- `google_calendar_tokens`
- `google_calendar_event_map`

Avaliar conforme schema atual:

- `schedule_notifications`
- outras tabelas auxiliares criadas em migracoes posteriores

### Tabelas Que Podem Continuar Globais

- `schedule_roles`, se os papeis forem iguais para todas as igrejas.
- `youtube_search_cache`, pois cache por query pode ser compartilhado sem expor dados privados.

Se no futuro cada igreja puder customizar funcoes da escala, `schedule_roles` deve ganhar `church_id` ou ser dividido em roles globais e roles customizados.

## Constraints E Indices

### `ministers`

Regras alvo:

```sql
church_id uuid not null references public.churches(id) on delete restrict
user_id uuid unique references auth.users(id) on delete cascade
```

Email:

- Se o Supabase Auth continuar exigindo email unico global, manter `email` como unico e aceitar que o mesmo email nao entra em duas igrejas.
- Como a decisao e usuario em uma unica igreja, isso e aceitavel.

Indices recomendados:

```sql
create index ministers_church_id_idx on public.ministers(church_id);
create index ministers_church_active_idx on public.ministers(church_id, active);
```

### `songs`

Regras:

- `songs.church_id` obrigatorio.
- `songs.minister_id` deve apontar para ministro da mesma igreja.

Indices:

```sql
create index songs_church_id_idx on public.songs(church_id);
create index songs_church_title_idx on public.songs(church_id, title);
```

### `schedule_quarters`

Regras:

- Periodos podem se sobrepor entre igrejas diferentes.
- A publicacao deve ser unica por igreja, nao global.

Indice recomendado para publicado:

```sql
create unique index schedule_quarters_one_published_per_church_idx
on public.schedule_quarters(church_id)
where is_published = true;
```

### `schedule_email_notifications`

Deduplicacao deve incluir igreja.

Opcoes aceitas:

- Incluir `church_id` na string de `dedupe_key`.
- Preferivel: criar unique composto.

```sql
create unique index schedule_email_notifications_church_dedupe_idx
on public.schedule_email_notifications(church_id, dedupe_key);
```

### FKs De Mesmo Tenant

Sempre que uma tabela tiver `church_id` e FK para outra entidade tambem tenant-scoped, o app e/ou banco deve garantir que ambas pertencem a mesma igreja.

Exemplos:

- `songs.church_id` deve ser igual a `ministers.church_id` do `minister_id`.
- `repertoire.church_id` deve ser igual a `songs.church_id` do `song_id`.
- `schedule_assignments.church_id` deve ser igual a `schedule_quarters.church_id` do `quarter_id`.
- `schedule_assignments.church_id` deve ser igual a `ministers.church_id` do `minister_id`, quando `minister_id` nao for nulo.

Implementacao minima aceita:

- Validar nas APIs antes de inserir/atualizar.
- RLS e filtros por `church_id` reduzem risco.

Implementacao mais forte:

- Usar constraints compostas ou triggers para impedir divergencia no banco.

## RLS

### Helpers SQL Recomendados

Substituir helpers globais por helpers com igreja.

Exemplos conceituais:

```sql
get_current_minister_id()
get_current_church_id()
is_church_admin(church_id uuid)
```

`get_current_church_id()` deve retornar a igreja do usuario autenticado via `ministers.user_id = auth.uid()`.

### Regra Geral

Toda tabela com `church_id` deve ter policy equivalente a:

```txt
usuario autenticado pode ler/escrever somente linhas onde row.church_id = get_current_church_id()
```

Escrita administrativa deve exigir:

```txt
row.church_id = get_current_church_id()
and is_church_admin(row.church_id)
```

### Politicas Por Entidade

`ministers`:

- Usuarios autenticados podem listar ministros da propria igreja.
- Usuario pode ler seu proprio perfil.
- Admin pode criar/editar/desativar ministros da propria igreja.
- Admin nao pode editar ministros de outra igreja.

`songs`:

- Usuarios autenticados podem ler musicas da propria igreja.
- Ministro pode criar musicas na propria igreja.
- Ministro pode editar/deletar suas proprias musicas, conforme regra atual.
- Admin pode gerenciar musicas da propria igreja.

`repertoire` e `special_events`:

- Usuarios autenticados podem ler dados da propria igreja.
- Escrita deve seguir a regra atual, mas sempre dentro da igreja.

`schedule_*`:

- Usuarios autenticados podem ler escalas da propria igreja.
- Admin pode criar/editar/publicar escalas da propria igreja.
- Publicacao/despublicacao nunca pode afetar outra igreja.

`schedule_email_notifications`:

- Normalmente manipulada por service role/cron.
- Mesmo assim deve ter `church_id` para dedupe, auditoria e isolamento.

## APIs E Backend

### Tela Interna De Igrejas

Criar uma area interna protegida para `super_admin` gerenciar igrejas.

Escopo inicial:

- Criar igreja.
- Editar nome, slug, status, environment, email_mode e plan.
- Desativar igreja.
- Listar igrejas.
- Iniciar impersonacao de uma igreja.

Fora do escopo inicial:

- Cadastro publico self-service.
- Billing automatizado.
- Convites automaticos complexos.

Rotas/telas de plataforma devem validar `platform_admins`, nao `ministers.role`.

### Helper Obrigatorio Para APIs

Criar um helper central para autenticar e resolver contexto:

```txt
authenticateWithChurchContext()
```

Responsabilidades:

1. Ler usuario autenticado.
2. Buscar `minister` por `user_id`.
3. Retornar `church_id`, `minister_id`, `role`.
4. Opcionalmente exigir role especifica.

Exemplo de uso esperado:

```ts
const context = await authenticateWithChurchContext({ requireAdmin: true })

await supabase
  .from('schedule_quarters')
  .select('*')
  .eq('church_id', context.churchId)
```

Para rotas de plataforma, criar helper separado:

```txt
authenticatePlatformAdmin()
```

Responsabilidades:

1. Ler usuario autenticado.
2. Verificar existencia em `platform_admins`.
3. Permitir acesso a rotas internas de plataforma.
4. Nunca conceder acesso operacional cross-tenant sem fluxo explicito de impersonacao.

### Regra Para `createAdminClient()`

`createAdminClient()` pode continuar existindo, mas toda query com service role deve filtrar explicitamente por `church_id`, exceto tabelas globais aprovadas.

Regra:

```txt
service role + tabela tenant-scoped + sem church_id = bug de seguranca
```

Excecoes permitidas:

- Rotas internas de plataforma autenticadas por `authenticatePlatformAdmin()`.
- Jobs globais que iteram igrejas explicitamente e aplicam `church_id` por item.
- Tabelas globais aprovadas, como `schedule_roles` e `youtube_search_cache`.

### Rotas Criticas

Prioridade alta:

- `app/api/schedule/quarters/route.ts`
- `app/api/schedule/quarters/[id]/route.ts`
- `app/api/schedule/quarters/[id]/publish/route.ts`
- `app/api/schedule/quarters/[id]/assignments/route.ts`
- `app/api/schedule/quarters/[id]/import/*`
- `app/api/schedule/assignment/route.ts`
- `app/api/schedule/current/route.ts`
- `app/api/schedule/rehearsal/route.ts`
- `app/api/ministers/*`
- `app/api/notifications/schedule/*`

Prioridade media:

- APIs de cifra/importacao que gravam em `songs`.
- APIs de Google Calendar.
- Buscas auxiliares de ministros.

## Frontend

O frontend nao precisa permitir selecao de igreja nesta primeira versao.

Mudancas esperadas:

- Paginas que consultam Supabase diretamente devem receber filtros por `church_id` via RLS ou migrar para API.
- Listas de ministros devem mostrar apenas ministros da igreja atual.
- Listas de musicas devem mostrar apenas musicas da igreja atual.
- Repertorios e eventos devem ser carregados por igreja.
- Escalas devem ser carregadas por igreja.

Paginas importantes:

- `app/users/page.tsx`
- `app/songs/page.tsx`
- `app/repertoire/page.tsx`
- `app/repertoire/player/page.tsx`
- `app/schedule/*`

## Storage De Cifras

O bucket pode continuar sendo `cifras`, mas os paths devem incluir `church_id`.

Formato recomendado:

```txt
{church_id}/{song_id}/cifra.pdf
```

Regras:

- Upload apenas para prefixo da igreja do usuario.
- Leitura apenas para prefixo da igreja do usuario.
- Delete/update apenas para prefixo da igreja do usuario, respeitando permissoes atuais.

Se as policies de Supabase Storage ficarem complexas, usar APIs server-side para assinar URLs e manipular arquivos com validacao de igreja.

## Notificacoes

O sistema de notificacoes deve ser tenant-aware.

Regras:

- Buscar quarters publicados por igreja.
- Enfileirar notificacoes com `church_id`.
- Deduplicar por igreja.
- Processar fila globalmente, mas cada item deve carregar `church_id`.
- Usar remetente global configurado por ambiente.
- Bloquear envio real para igrejas com `environment in ('demo', 'test')`.
- Respeitar `churches.email_mode` antes de enviar.
- Logs e erros devem incluir `church_id` para diagnostico.

O cron pode continuar unico para toda a aplicacao.

Comportamento por `email_mode`:

- `real`: envia para os destinatarios reais da igreja.
- `disabled`: nao envia email, mas pode registrar que o envio foi ignorado.
- `test_recipient`: redireciona todos os emails da igreja para `SCHEDULE_EMAIL_TEST_RECIPIENT`.

Regra obrigatoria:

- Igrejas demo/teste devem usar `disabled` ou `test_recipient`.
- O app nao deve permitir salvar igreja demo/teste com `email_mode = 'real'`.

## Migracao De Dados

### Estrategia Recomendada

Fazer migracao incremental e segura.

Fase 1: criar estrutura.

```txt
1. Criar tabela churches.
2. Criar tabelas platform_admins e platform_impersonation_audit.
3. Criar igreja default, por exemplo Worship Flow Default.
4. Adicionar church_id nullable nas tabelas principais.
5. Backfill de todos os registros existentes com a igreja default.
```

Fase 2: adaptar app.

```txt
1. Criar helpers de contexto.
2. Atualizar APIs e queries criticas.
3. Atualizar RLS para considerar church_id.
4. Ajustar storage e notificacoes.
```

Fase 3: endurecer banco.

```txt
1. Tornar church_id NOT NULL nas tabelas principais.
2. Criar indices e uniques compostos.
3. Remover policies antigas permissivas.
4. Validar que nao existem registros sem church_id.
```

### Igreja Demo/Teste

Depois da estrutura pronta, criar igrejas separadas:

```txt
Demo Worship Flow
Teste Interno
```

Essas igrejas devem usar dados independentes, sem flags especiais no codigo.

## Plano De Implementacao

### Etapa 1: Schema Base

- Criar migration `churches`.
- Criar migration `platform_admins`.
- Criar migration `platform_impersonation_audit`.
- Adicionar `church_id` nullable nas tabelas principais.
- Criar igreja default.
- Fazer backfill.
- Adicionar indices basicos.

### Etapa 2: Contexto De Usuario

- Criar helper server-side para resolver ministro + igreja.
- Criar helper server-side para validar `platform_admins`.
- Atualizar middleware se necessario para carregar role dentro da igreja.
- Garantir `ministers.user_id` unico.

### Etapa 2.1: Plataforma Interna

- Criar tela interna para listar/criar/editar/desativar igrejas.
- Proteger tela e APIs com `authenticatePlatformAdmin()`.
- Implementar inicio/fim de impersonacao.
- Exibir indicador visual quando estiver impersonando uma igreja.
- Registrar auditoria das acoes de impersonacao.

### Etapa 3: RLS

- Criar `get_current_church_id()`.
- Trocar policies globais por policies escopadas.
- Validar leitura direta client-side via Supabase.

### Etapa 4: APIs De Admin E Escala

- Atualizar rotas de schedule.
- Garantir que publicacao/despublicacao afeta apenas a igreja atual.
- Garantir que criacao de quarter replica dados apenas da mesma igreja.
- Exigir admin nas rotas administrativas que hoje so autenticam.

### Etapa 5: Musicas, Repertorio E Ministros

- Atualizar listagens e escritas.
- Garantir inserts com `church_id` resolvido no servidor ou pelo contexto seguro.
- Garantir deletes sempre por `id` + `church_id`.

### Etapa 6: Notificacoes E Integracoes

- Atualizar enfileiramento de emails.
- Atualizar dedupe.
- Atualizar Google Calendar, se estiver ativo no ambiente.

### Etapa 7: Storage

- Alterar path dos arquivos novos.
- Migrar paths antigos, se necessario.
- Ajustar policies ou APIs server-side.

### Etapa 8: Hardening Final

- Tornar `church_id` obrigatorio.
- Adicionar constraints/indices finais.
- Criar testes manuais com duas igrejas.
- Revisar todas as queries com busca textual por `.from(` e service role.

## Criterios De Aceite

### Isolamento

- Usuario da Igreja A nao ve ministros da Igreja B.
- Usuario da Igreja A nao ve musicas da Igreja B.
- Usuario da Igreja A nao ve repertorios/eventos da Igreja B.
- Usuario da Igreja A nao ve escalas da Igreja B.
- Usuario da Igreja A nao acessa PDFs/cifras da Igreja B.

### Administracao

- Admin da Igreja A cria/edita/desativa apenas ministros da Igreja A.
- Admin da Igreja A nao consegue alterar dados da Igreja B por chamada direta de API.
- Ministro comum nao consegue chamar APIs administrativas de escala.

### Escala

- Cada igreja pode ter sua propria escala publicada.
- Publicar escala na Igreja A nao despublica escala da Igreja B.
- Duplicacao/importacao de escala usa apenas dados da mesma igreja.

### Notificacoes

- Emails sao enfileirados com `church_id`.
- Deduplicacao nao bloqueia notificacao equivalente de outra igreja.
- Lembretes usam a escala publicada da igreja correta.
- Igrejas demo/teste nao enviam emails reais.
- Remetente de email e global por ambiente.

### Plataforma

- Apenas usuarios em `platform_admins` acessam a area interna de igrejas.
- `super_admin` consegue criar, editar e desativar igrejas.
- `super_admin` consegue iniciar impersonacao de uma igreja.
- A UI mostra claramente quando uma igreja esta sendo impersonada.
- Acoes relevantes durante impersonacao sao auditadas.

### Dados Legados

- Todos os dados existentes ficam associados a uma igreja default.
- Nao existem registros tenant-scoped com `church_id` nulo ao final.

## Testes Manuais Obrigatorios

Criar duas igrejas:

```txt
Igreja A
Igreja B
Demo Worship Flow
Teste Interno
```

Criar pelo menos:

- 1 admin em cada igreja.
- 1 ministro comum em cada igreja.
- 2 musicas em cada igreja.
- 1 escala publicada em cada igreja.
- 1 repertorio na mesma data em cada igreja.

Validar:

- Login como admin A nao mostra dados B.
- Login como ministro A nao mostra dados B.
- API direta tentando acessar ID da igreja B retorna erro ou vazio.
- Publicar escala A nao altera escala B.
- Repertorio com mesma data/evento em A e B nao colide.
- Notificacao de A nao inclui ministro B.
- Demo Worship Flow e Teste Interno nao enviam emails reais.
- Usuario sem `platform_admins` nao acessa area interna de igrejas.
- Usuario com `platform_admins` consegue impersonar Igreja A e depois encerrar impersonacao.

## Riscos

- Esquecer filtro `church_id` em rota com `createAdminClient()`.
- RLS permissiva antiga permanecer ativa.
- Inserts client-side nao preencherem `church_id`.
- Constraints globais impedirem dados equivalentes em igrejas diferentes.
- Storage continuar permitindo acesso por qualquer usuario autenticado.
- Cron de notificacao processar quarter global em vez de quarter por igreja.

## Checklist De Revisao De Codigo

Antes de considerar a feature pronta, revisar:

- Toda ocorrencia de `createAdminClient()`.
- Toda ocorrencia de `.from('ministers')`.
- Toda ocorrencia de `.from('songs')`.
- Toda ocorrencia de `.from('repertoire')`.
- Toda ocorrencia de `.from('special_events')`.
- Toda ocorrencia de `.from('schedule_quarters')`.
- Toda ocorrencia de `.from('schedule_assignments')`.
- Toda ocorrencia de `.from('schedule_rehearsals')`.
- Toda ocorrencia de `is_published` em escalas.
- Toda policy SQL com `USING (true)`.
- Toda policy de storage do bucket `cifras`.

## Decisoes Fechadas Na Review

- A criacao de novas igrejas sera feita por tela interna administrativa.
- Havera `super_admin` global para suporte/plataforma.
- `super_admin` sera modelado em `platform_admins`, separado de `ministers.role`.
- `super_admin` podera gerenciar igrejas e impersonar uma igreja.
- O remetente das notificacoes sera global por ambiente.
- Igrejas demo/teste nunca devem enviar emails reais.
- `schedule_roles` permanecera global na primeira versao.

## Questoes Futuras

- Quando abrir cadastro publico self-service para novas igrejas?
- Quando implementar billing/assinaturas por igreja?
- Quando permitir configuracao de remetente por igreja?
- Quando permitir customizacao de `schedule_roles` por igreja?
- Impersonacao deve permitir escrita ampla ou apenas leitura/suporte assistido?

## Recomendacao Final

Implementar tenant simples agora.

Esse modelo atende ao objetivo de SaaS inicial, demo e testes internos com menor complexidade. A implementacao deve priorizar isolamento forte por `church_id`, especialmente em RLS, APIs com service role, publicacao de escalas, repertorios por data/evento, notificacoes e storage.
