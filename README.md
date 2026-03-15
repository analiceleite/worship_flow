# Worship Flow

Aplicação web para gerenciamento de músicas e repertório de ministério de louvor, com autenticação por perfil (admin/ministro), organização por culto/evento e suporte a PWA.

## Funcionalidades

- Cadastro, edição e exclusão de músicas.
- Organização de repertório por data e tipo de programação:
	- Culto recorrente (quinta/domingo)
	- Evento especial (com nome do evento)
- Controle de acesso por papel:
	- `admin`: visão e gerenciamento completo
	- `minister`: acesso restrito aos próprios dados
- Login com Supabase Auth.
- Interface responsiva (desktop/mobile) com tema claro/escuro.
- PWA instalável (manifest + service worker).

## Stack

- Next.js (App Router)
- React + TypeScript
- Tailwind CSS + componentes UI locais
- Supabase (Auth + Postgres + RLS)

## Requisitos

- Node.js 20+
- npm ou pnpm
- Projeto Supabase configurado

## Instalação

### 1) Instalar dependências

Com pnpm (recomendado):

```bash
pnpm install
```

Ou com npm:

```bash
npm install
```

### 2) Configurar variáveis de ambiente

Crie o arquivo `.env.local` na raiz com:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
APP_BASE_URL=http://localhost:3000
CRON_SECRET=...
RESEND_API_KEY=...
RESEND_FROM_EMAIL=...
SCHEDULE_EMAIL_TEST_RECIPIENT=...
```

> `SUPABASE_SERVICE_ROLE_KEY` é usada em rotas administrativas server-side.
> `SCHEDULE_EMAIL_TEST_RECIPIENT` é opcional e redireciona todos os e-mails de escala para um único endereço durante testes.

### 3) Aplicar scripts SQL no Supabase

Execute os scripts em ordem no SQL Editor do Supabase:

1. `scripts/001_create_tables.sql`
2. `scripts/003_auth_and_ownership.sql`
3. `scripts/004_update_repertoire_policies.sql`
4. `scripts/005_allow_admin_songs.sql`
5. `scripts/006_add_event_name_to_repertoire.sql`
6. `scripts/007_worship_schedule_upload.sql`

## Executar o projeto

Desenvolvimento:

```bash
pnpm dev
```

Build de produção:

```bash
pnpm build
pnpm start
```

## PWA

O projeto já está preparado como PWA.

Para testar instalação:

1. Rode em `localhost` (`pnpm dev`) ou em ambiente HTTPS.
2. Abra DevTools > Application > Manifest.
3. Verifique ícones e critérios de installability.

Arquivos principais de PWA:

- `app/manifest.ts`
- `public/sw.js`
- `components/pwa-register.tsx`

## Estrutura principal

- `app/` rotas da aplicação
- `components/` componentes reutilizáveis
- `lib/` tipos e utilitários (inclui clientes Supabase)
- `scripts/` migrações SQL e utilitários
- `public/` arquivos estáticos (ícones/logo/PWA)

## Perfis e permissões

- As regras de acesso são controladas por RLS no Supabase.
- Admin pode gerenciar músicas e ministros.
- Ministro gerencia seus próprios dados conforme políticas ativas.

## Observações importantes

- Se houver erro de lockfile em CI com pnpm (`frozen-lockfile`), atualize `pnpm-lock.yaml` localmente e commit.
- Após mudanças de PWA/Service Worker, limpe cache do navegador e desinstale/reinstale o app para validar novos ícones.

## Próximos passos sugeridos

- Adicionar testes automatizados para fluxos críticos (auth, repertório, permissões).
- Evoluir o módulo de eventos especiais com catálogo de eventos recorrentes/sazonais.
- Configurar pipeline de deploy automático (GitHub Actions + Vercel).
