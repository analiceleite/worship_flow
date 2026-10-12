# Worship Flow

Worship Flow e uma aplicacao web multitenant para gestao de ministerios de louvor. Ela organiza musicas, repertorios, escalas bimestrais, usuarios, notificacoes por email, cifras, integracao com YouTube e Google Calendar.

A aplicacao opera como uma plataforma SaaS simples: uma unica instalacao atende varias igrejas, com isolamento por `church_id` no banco e suporte operacional para administracao interna, impersonacao e ambiente demo.

## Estado Atual

- Aplicacao multitenant por igreja.
- Modelo atual: `1 auth user = 1 minister = 1 church`.
- Um usuario tambem pode ser admin da plataforma via `platform_admins`.
- Dados principais sao isolados por `church_id`.
- Platform admin acessa `/platform/churches` para gerenciar igrejas.
- Platform admin pode impersonar uma igreja para suporte ou demonstracao.
- Header exibe a igreja ativa junto ao nome do app.
- Igreja demo disponivel para apresentacao publica.

## Funcionalidades

### Plataforma E Multitenancy

- Cadastro de igrejas/tenants.
- Isolamento por igreja em usuarios, musicas, repertorios, escalas, eventos especiais, notificacoes e integracoes.
- Contexto efetivo de igreja para paginas client-side e server-side.
- Impersonacao de igreja por admin da plataforma.
- Auditoria de impersonacao em `platform_impersonation_audit`.
- Modos por igreja: `production`, `demo` e `test`.
- Modos de email por igreja: `real`, `disabled` e `test_recipient`.

### Gestao De Musicas

- Cadastro, edicao e exclusao de musicas.
- Tom principal e tons disponiveis.
- Links de cifra e YouTube.
- Conteudo de cifra em texto/PDF.
- Importacao/backfill de cifras.
- Busca de videos no YouTube com cache.
- Validacao/auditoria de tons.

### Repertorio

- Organizacao de musicas por data.
- Ordenacao do repertorio.
- Eventos especiais nomeados.
- Player de repertorio.
- Visualizacao isolada por igreja.

### Escala Bimestral

- Criacao de bimestres/periodos.
- Escalas para quinta e domingo.
- Ministros, trainees, aprendizes e tecnico de som.
- Ensaios por culto/servico.
- Publicacao de escala.
- Dashboard/admin de escala.

### Usuarios E Permissoes

- `admin`: gerencia usuarios, musicas, repertorio e escala da propria igreja.
- `minister`: gerencia musicas proprias e visualiza repertorio/escala.
- `midia`: acesso limitado a repertorio/escala.
- RLS no Supabase para reforcar isolamento e permissao.

### Notificacoes E Calendario

- Notificacoes por email via Resend.
- Lembretes por antecedencia configuravel.
- Notificacao de escala publicada.
- Fila de emails assíncrona.
- Interceptacao de emails para teste.
- Integracao com Google Calendar por ministro.

### Interface

- Next.js App Router.
- UI responsiva desktop/mobile.
- Tema claro/escuro.
- Componentes Radix UI + Tailwind.
- PWA instalavel.

## Stack

- Next.js 16
- React 19
- TypeScript 5.7
- Tailwind CSS 4
- Supabase Auth + Postgres + RLS
- Resend
- Google APIs
- pnpm 9.15

## Requisitos

- Node.js 20+
- pnpm 9.15+
- Projeto Supabase
- Conta Resend para emails reais
- Credenciais Google OAuth para integracao de calendario, se usada

## Variaveis De Ambiente

Crie `.env.development.local` e `.env.production.local` conforme o ambiente.

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

APP_BASE_URL=http://localhost:3000

CRON_SECRET=um-secret-aleatorio

RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@seudominio.com
SCHEDULE_EMAIL_TEST_RECIPIENT=seu-email-de-teste@dominio.com

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

CIFRACLUB_IMPORTER_URL=http://localhost:3010
CIFRACLUB_IMPORTER_TOKEN=seu-token-interno
```

Notas:

- `SUPABASE_SERVICE_ROLE_KEY` nunca deve ir para o cliente/browser.
- `CRON_SECRET` precisa bater com o secret configurado no GitHub Actions.
- `SCHEDULE_EMAIL_TEST_RECIPIENT` intercepta emails quando a igreja estiver em modo `test_recipient`.
- Para igrejas demo/teste, nao use `email_mode = real`.

## Instalar E Rodar

```bash
pnpm install
pnpm dev
```

O app abre em:

```txt
http://localhost:3000
```

Build de producao:

```bash
pnpm build
pnpm start
```

Ou:

```bash
pnpm prod
```

Validacao TypeScript:

```bash
pnpm exec tsc --noEmit
```

Lint:

```bash
pnpm lint
```

Observacao: o script `pnpm lint` chama `eslint .`, mas o pacote `eslint` precisa estar instalado/declarado para funcionar no ambiente atual.

## Banco De Dados

Execute os SQLs em ordem no SQL Editor do Supabase.

```txt
scripts/001_create_tables.sql
scripts/016_consolidate_access_policies.sql
scripts/017_add_is_trainee_to_schedule_assignments.sql
scripts/018_add_apprentice_schedule_role.sql
scripts/019_add_cifra_content_to_songs.sql
scripts/020_create_password_resets.sql
scripts/021_add_schedule_rehearsals.sql
scripts/022_song_cifra_pdf_storage.sql
scripts/023_youtube_search_cache.sql
scripts/024_add_calendar_feed.sql
scripts/025_add_email_reminder_offsets.sql
scripts/026_add_google_calendar_integration.sql
scripts/027_remove_ics_calendar_subscription.sql
scripts/028_add_sound_technician_schedule_role.sql
scripts/029_add_available_tones_to_songs.sql
scripts/030_simple_multitenancy_base.sql
scripts/031_simple_multitenancy_rls.sql
scripts/032_simple_multitenancy_hardening.sql
```

As migrations `030`, `031` e `032` adicionam a base multitenant, RLS tenant-aware, constraints finais, indices e hardening de `church_id`.

## Primeiro Acesso Da Plataforma

O primeiro operador precisa existir no Supabase Auth, ter um registro em `ministers` e ser promovido para `platform_admins`.

Exemplo:

```sql
insert into public.platform_admins (user_id)
select user_id
from public.ministers
where email = 'seu-email@dominio.com'
on conflict (user_id) do nothing;
```

Depois disso, acesse:

```txt
/platform/churches
```

## Setup De Nova Igreja

O fluxo operacional completo esta documentado em:

```txt
sdd/plan/new-church-setup-readme.md
```

Resumo:

1. Entrar como platform admin.
2. Acessar `/platform/churches`.
3. Criar a igreja com `environment = production` e `email_mode = real`.
4. Impersonar a igreja.
5. Validar que o ambiente esta vazio.
6. Criar o primeiro admin da igreja em `/users`.
7. Encerrar a impersonacao.
8. Pedir para o admin configurar ministros, musicas, repertorios e escalas.

Checklist minimo antes de entregar:

- Header mostra o nome correto da igreja.
- `/users` mostra apenas usuarios da nova igreja.
- `/songs` mostra apenas musicas da nova igreja.
- `/repertoire` nao mostra dados de outra igreja.
- `/schedule` nao mostra dados de outra igreja.
- Emails estao no modo correto.
- Impersonacao encerra corretamente.

## Ambiente Demo

A igreja demo padrao pode ser populada com:

```bash
node scripts/seed-demo-worship-flow.mjs
```

Credenciais atuais da demo:

```txt
Email: demo@worshipflow.app
Senha: Demo@12345
```

Use a demo para apresentacao publica. Antes de expor amplamente, considere trocar a senha e revisar os dados fake.

## Emails E Automacao

O workflow de emails fica em:

```txt
.github/workflows/schedule-email-reminders.yml
```

Secrets necessarios no GitHub Actions:

| Secret | Valor |
| --- | --- |
| `APP_BASE_URL` | URL publica da aplicacao |
| `CRON_SECRET` | Mesmo valor do ambiente de producao |

Fluxo:

1. Escala publicada enfileira notificacoes.
2. Cron enfileira lembretes periodicos.
3. Fila processa emails via Resend.
4. Modo de email da igreja controla envio real, teste ou bloqueio.

## Scripts Uteis

Backfill de cifras:

```bash
pnpm backfill:cifras
pnpm backfill:cifras:dry
```

Auditoria de tons:

```bash
pnpm audit:tones
pnpm audit:tones:fix
pnpm audit:tones:rewrite
```

Seed da demo:

```bash
node scripts/seed-demo-worship-flow.mjs
```

Geracao de escala original em XLSX:

```bash
node scripts/generate-original-schedule-xlsx.mjs
```

## CifraClub Importer

Links do CifraClub podem ser importados usando o microservico Playwright em `services/cifraclub-importer`.

Rodar localmente:

```bash
docker build -t worship-flow-cifraclub-importer services/cifraclub-importer
docker run --rm -p 3010:3010 -e CIFRACLUB_IMPORTER_TOKEN=seu-token-interno worship-flow-cifraclub-importer
```

Detalhes:

```txt
services/cifraclub-importer/README.md
```

## Estrutura Principal

```txt
app/
  api/
    context/                 # contexto efetivo de usuario/igreja
    platform/                # endpoints internos da plataforma
    schedule/                # escala, bimestres, assignments
    songs/                   # musicas
    notifications/           # emails e cron
  platform/churches/         # gestao interna de igrejas
  songs/                     # gestao de musicas
  repertoire/                # repertorio
  schedule/                  # escala
  users/                     # usuarios/ministros da igreja

components/
  header.tsx                 # navegacao, igreja ativa e impersonacao
  song-form.tsx
  minister-form.tsx
  schedule/
  ui/

lib/
  auth-context.ts            # contexto multitenant e impersonacao
  supabase/                  # clients server/client/admin
  notifications/
  google-calendar.ts
  types.ts

scripts/
  001_*.sql ... 032_*.sql    # schema e migrations
  seed-demo-worship-flow.mjs
  backfill-cifras.mjs
  audit-song-tones.mjs
```

## Seguranca

- Nunca exponha `SUPABASE_SERVICE_ROLE_KEY`.
- Rotacione chaves se forem compartilhadas indevidamente.
- Use `platform_admins` apenas para operadores internos confiaveis.
- Use impersonacao somente para suporte, setup e demonstracao.
- Valide isolamento antes de entregar uma nova igreja.
- Nao use email real em tenants demo/teste.

## Troubleshooting

### Dados De Outra Igreja Aparecendo

Pare o setup e investigue imediatamente.

Verifique:

- Se a pagina/API usa `getCurrentMinisterContext()` ou `/api/context`.
- Se a query filtra pelo `churchId` efetivo.
- Se a tabela possui `church_id` preenchido e `not null`.
- Se a policy RLS correspondente considera `church_id`.

### Permission Denied No Supabase

Verifique:

- Usuario existe em `auth.users`.
- Registro correspondente existe em `public.ministers`.
- `ministers.user_id` aponta para o UUID correto.
- `ministers.church_id` esta preenchido.
- Role esta correta: `admin`, `minister` ou `midia`.

### Emails Nao Enviam

Verifique:

- `RESEND_API_KEY` e `RESEND_FROM_EMAIL`.
- `CRON_SECRET` no ambiente e no GitHub Actions.
- `churches.email_mode` da igreja.
- `churches.environment` da igreja.
- Logs do workflow `schedule-email-reminders`.

### Service Worker/PWA Desatualizado

No navegador:

1. DevTools > Application > Service Workers > Unregister.
2. Limpar Cache Storage.
3. Fechar e abrir o app novamente.
4. Se instalado como PWA, reinstalar.

## Documentos Internos

- `sdd/spec/simple-tenant-multitenancy-spec.md`
- `sdd/plan/simple-tenant-multitenancy-plan.md`
- `sdd/plan/new-church-setup-readme.md`
