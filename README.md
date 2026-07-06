# Worship Flow

Aplicação web completa para gerenciamento de músicas, repertório e escala bimestral de ministérios de louvor. Com autenticação integrada (Supabase Auth), controle de acesso por perfil (admin/ministro/mídia), integração com cifras (CifraClub, Cifralize), busca de vídeos no YouTube, notificações por email e suporte PWA.

## ✨ Funcionalidades

### 🎵 Gestão de Músicas
- Cadastro, edição e exclusão de músicas com tom personalizado
- Integração com links de **cifra** (URL + conteúdo PDF/texto)
- Busca integrada no **YouTube** com cache
- Validação automática de **tom e capo**
- Backup automático de cifras via backfill

### 📅 Escala Bimestral (Schedule)
- Organização de escala por **bimestres** (períodos de 2 meses)
- Tipos de eventos:
  - **Quinta** (ensaios/preparação)
  - **Domingo** (cultos)
- Atribuição de ministros por evento e data
- Suporte a **trainees** (aprendizes) e **apprentices** (aprendizes de papel específico)
- Visualização por minister e por admin

### 📋 Repertório
- Organização de músicas por data e evento
- Reordenação visual (drag-and-drop)
- Atribuição de ministro responsável por cada música
- Suporte a eventos especiais nomeados

### 📧 Notificações por Email
- Workflow automático a cada 15 minutos (GitHub Actions)
- Lembretes com antecedência configurável por ministro (padrão: 7 dias e 1 dia antes do culto;
  opcionalmente também 12h/1h/30min antes)
- Notificação de publicação da escala
- Fila de processamento de emails assíncrona
- Interceptação de emails para testes

### 👥 Controle de Acesso (RLS)
- **Admin**: gerenciamento completo (músicas, ministros, escala)
- **Minister**: gerencia próprias músicas, visualiza sua escala
- **Mídia**: acesso limitado (visualização de repertório)
- Políticas de segurança em nível de banco de dados (Supabase RLS)

### 🎨 Interface
- Responsiva (desktop/mobile)
- Tema claro/escuro
- Componentes UI com Radix + Tailwind
- Ícones com Lucide React
- Notificações com Sonner
- PWA instalável

## Tech Stack

- **Next.js 16** (App Router)
- **React 19** + TypeScript 5.7
- **Tailwind CSS 4** + Radix UI
- **Supabase** (Auth + Postgres + RLS)
- **pnpm 9.15** (package manager)
- **Integrations**: Resend (emails), YouTube API, CifraClub/Cifralize (cifras)

## 📋 Requisitos

- **Node.js** 20+ (recomendado 20.x ou 22.x)
- **pnpm** 9.15+ (recomendado) ou npm
- **Projeto Supabase** com banco de dados Postgres configurado

## 🚀 Instalação e Setup

### 1️⃣ Clonar e Instalar Dependências

```bash
git clone <repository-url>
cd worship_flow
pnpm install
```

### 2️⃣ Configurar Variáveis de Ambiente

Copie os arquivos de exemplo e preencha suas credenciais:

```bash
cp .env.development.local.example .env.development.local
cp .env.production.local.example .env.production.local
```

**Variáveis obrigatórias em ambos os arquivos**:

```env
# Supabase (obtém na dashboard do projeto)
NEXT_PUBLIC_SUPABASE_URL=https://seu-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# App
APP_BASE_URL=http://localhost:3000  # dev
APP_BASE_URL=https://seu-dominio.vercel.app  # prod

# Email (Resend)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@seudominio.com

# Automação
CRON_SECRET=seu-secret-aleatorio-aqui

# Testes (opcional)
SCHEDULE_EMAIL_TEST_RECIPIENT=seu-email@exemplo.com
```

**Obtendo as credenciais Supabase**:
1. Acesse [supabase.com/dashboard](https://app.supabase.com)
2. Selecione seu projeto
3. Vá em **Settings** → **API**
4. Copie `Project URL` e `anon public key`
5. Vá em **Settings** → **Service Role Secret** para obter a service role key

### 3️⃣ Aplicar Migrações SQL no Supabase

Execute os scripts em ordem no **SQL Editor** do Supabase:

1. `scripts/001_create_tables.sql` — Cria todas as tabelas base
2. `scripts/016_consolidate_access_policies.sql` — RLS policies consolidadas
3. `scripts/017_add_is_trainee_to_schedule_assignments.sql` — Suporte a trainees
4. `scripts/018_add_apprentice_schedule_role.sql` — Suporte a apprentices
5. `scripts/019_add_cifra_content_to_songs.sql` — Armazena conteúdo de cifras
6. `scripts/020_create_password_resets.sql` — Tabela de reset de senha
7. `scripts/021_add_schedule_rehearsals.sql` — Informações de ensaios
8. `scripts/022_song_cifra_pdf_storage.sql` — Armazena PDFs de cifras
9. `scripts/023_youtube_search_cache.sql` — Cache de buscas YouTube

**Como aplicar**:
1. Abra [Supabase Dashboard](https://app.supabase.com) → seu projeto
2. Vá em **SQL Editor** → **New query**
3. Copie todo o conteúdo de um script
4. Cole na query e clique em **Run**
5. Repita para cada script na ordem acima

### 4️⃣ Criar Usuário Admin (Primeira Vez)

1. Vá em **Authentication** → **Users** no Supabase
2. Clique em **Add user** → **Create new user**
3. Preencha email e senha temporária
4. ✅ Marque **Auto Confirm User**
5. Clique em **Create user**
6. **Copie o UUID** do novo usuário

7. Vá em **SQL Editor** e execute:
```sql
INSERT INTO public.ministers (
  name, email, role, user_id, is_active, instrument
) VALUES (
  'Administrador',
  'seu-email@dominio.com',
  'admin',
  'COLE_O_UUID_AQUI',
  true,
  'Voz'
);
```

Agora você pode fazer login com o email e senha definidos.

## 🏃 Executar o Projeto

### Desenvolvimento

```bash
pnpm dev
```

Abre em `http://localhost:3000` com recarregamento automático.

> **Nota Windows**: O script habilita `WATCHPACK_POLLING` e `CHOKIDAR_USEPOLLING` para melhor compatibilidade com file watching.

### Produção Local

```bash
pnpm build    # Build para produção
pnpm start    # Inicia servidor
```

Ou em um comando:

```bash
pnpm prod  # Build + start combinados
```

### Linting

```bash
pnpm lint  # Verifica ESLint em todo o projeto
```

## 📧 Automação de Notificações por Email

O repositório inclui um workflow automático em [.github/workflows/schedule-email-reminders.yml](.github/workflows/schedule-email-reminders.yml) para notificações agendadas.

### Fluxo

1. ✅ **Publicação de Escala** — Quando admin publica uma escala, notificação é enviada
2. 📬 **Enfileiração** (a cada 15 minutos):
   - Re-enfileira notificações pendentes da escala bimestral publicada
   - Enfileira lembretes por email nas antecedências configuradas por cada ministro no perfil
     (padrão: **7 dias** e **1 dia** antes; opcionalmente também 12h/1h/30min antes)
3. 📤 **Processamento** — Emails são enviados via Resend

> O gatilho `schedule` do GitHub Actions é best-effort: execuções muito frequentes (5-15 min)
> podem atrasar alguns minutos em períodos de alta carga. Lembretes de antecedência curta
> (ex.: 30 min antes) podem, na prática, chegar um pouco depois do previsto.

### Configurar no GitHub

Para habilitar automação, adicione estes **secrets** no repositório (Settings → Secrets and variables → Actions):

| Secret | Valor |
|--------|-------|
| `APP_BASE_URL` | `https://seu-dominio.vercel.app` |
| `CRON_SECRET` | Mesmo valor do `.env.production.local` |

### Testes Locais

Para testar emails sem enviá-los realmente:

1. Configure em `.env.development.local`:
   ```env
   SCHEDULE_EMAIL_TEST_RECIPIENT=seu-email-teste@dominio.com
   ```
2. Todos os emails serão interceptados e enviados para esse endereço

### Rodar Manualmente

- Workflow executa automaticamente **a cada 15 minutos**
- Pode ser disparado manualmente em **Actions** → **schedule-email-reminders**

## 🛠️ Utilitários e Scripts de Dados

### Backfill de Cifras

Busca automaticamente cifras de CifraClub e Cifralize para músicas sem conteúdo de cifra:

```bash
pnpm backfill:cifras        # Busca e armazena cifras
pnpm backfill:cifras:dry    # Prévia sem modificar dados
```

### Auditoria e Correção de Tons

Valida e corrige inconsistências de tons nas músicas:

```bash
pnpm audit:tones            # Lista problemas de tom
pnpm audit:tones:fix        # Corrige tons individuais
pnpm audit:tones:rewrite    # Reescreve conteúdo de cifra baseado no tom
```

### Backfill de Capo

Script legado para atualizar capo (trastes):

```bash
node scripts/backfill-capo.mjs
```

### Gerar Escala Original (Excel)

Exporta escala para formato XLSX:

```bash
node scripts/generate-original-schedule-xlsx.mjs
```

## 📱 PWA (Progressive Web App)

O projeto suporta instalação como app nativo em dispositivos.

### Testar Instalação

1. Rode em `localhost` (`pnpm dev`) com HTTPS (ou use `localhost` que funciona)
2. Abra DevTools → **Application** → **Manifest**
3. Verifique ícones e critério **Installability**

### Arquivos PWA

- `app/manifest.ts` — Configuração do manifest
- `public/sw.js` — Service Worker
- `components/pwa-register.tsx` — Registro do SW
- `public/logo.jpg` — Ícone da aplicação

> **Nota**: Após alterar PWA/Service Worker, limpe o cache do navegador e reinstale o app para refletir mudanças.

## 📁 Estrutura do Projeto

```
worship_flow/
├── app/                           # Next.js App Router
│   ├── (auth)/                   # Routes de autenticação
│   │   ├── login/
│   │   ├── forgot-password/
│   │   ├── reset/
│   │   └── set-password/
│   ├── api/                      # API Routes
│   │   ├── schedule/            # Schedule management (quarters, assignments, emails)
│   │   ├── songs/               # Song CRUD
│   │   ├── ministers/           # Minister management
│   │   ├── cifra/               # Cipher import from Cifralize
│   │   ├── youtube/             # YouTube search
│   │   └── notifications/       # Email queue & scheduling
│   ├── schedule/                # Schedule pages
│   │   ├── page.tsx            # Minister view
│   │   └── admin/              # Admin schedule builder
│   ├── songs/                  # Song management page
│   ├── repertoire/             # Repertoire viewing
│   ├── users/                  # Minister management (admin)
│   ├── manifest.ts             # PWA manifest
│   └── layout.tsx              # Root layout
│
├── components/                  # React components
│   ├── ui/                     # Radix UI + Tailwind wrappers
│   ├── schedule/               # Schedule-specific components
│   ├── song-form.tsx           # Song create/edit form
│   ├── minister-form.tsx       # Minister create/edit form
│   ├── cifra-viewer.tsx        # Cipher content viewer
│   ├── header.tsx              # Navigation header
│   └── pwa-register.tsx        # PWA registration
│
├── lib/                         # Utilities & configs
│   ├── supabase/               # Supabase clients
│   │   ├── server.ts          # Server-side client (SSR)
│   │   ├── client.ts          # Browser client (CSR)
│   │   └── admin.ts           # Admin bypass client
│   ├── types.ts               # TypeScript interfaces
│   ├── routes.ts              # Route constants
│   ├── permissions.ts         # Permission helpers
│   ├── cifra-*.ts             # Cipher scraping/storage
│   ├── youtube-search-cache.ts # YouTube caching
│   ├── notifications/         # Email scheduling
│   └── utils.ts               # General utilities
│
├── scripts/                    # Database & data scripts
│   ├── 001_create_tables.sql          # Initial schema
│   ├── 016-023_*.sql                  # Migrations
│   ├── backfill-cifras.mjs            # Fetch missing ciphers
│   ├── audit-song-tones.mjs           # Tone validation
│   └── generate-original-schedule.mjs # Export to Excel
│
├── public/                     # Static files
│   ├── sw.js                  # Service Worker
│   ├── logo.jpg               # App icon
│   └── manifest.webmanifest   # PWA manifest
│
└── .github/workflows/          # CI/CD
    └── schedule-email-reminders.yml  # Runs every 15 minutes
```

## 👥 Perfis e Permissões

Acesso controlado por **Row-Level Security (RLS)** no Supabase + validação de roles em API routes.

| Role | Descrição | Permissões |
|------|-----------|-----------|
| **admin** | Administrador | ✅ Gerenciar ministros, todas as músicas, escala, repertório |
| **minister** | Ministro | ✅ Criar/editar próprias músicas, visualizar sua escala |
| **midia** | Mídia/Gravação | ✅ Visualizar repertório e escala (read-only) |

### Exemplos de Acesso

- **Admin**: Vê todos os ministros, todas as músicas, monta a escala bimestral
- **Ministro**: Vê apenas suas músicas, visualiza sua escala
- **Mídia**: Vê repertório e quem toca (não pode editar)

Políticas RLS aplicadas em:
- `public.ministers` — Only admin can list all
- `public.songs` — Only owner or admin can edit
- `public.repertoire` — Minister sees only their scheduled songs
- `public.schedule_assignments` — Only admin manages

## 🔧 Troubleshooting

### Erro: "Permission denied" ao consultar dados

**Causa**: RLS policy bloqueando acesso ou usuário não mapeado na tabela `ministers`

**Solução**:
1. Verifique em Supabase → **SQL Editor** se o usuário existe em `public.ministers`
2. Confirme que `user_id` em `ministers` corresponde ao UUID do usuário em `auth.users`
3. Verifique o `role` está correto (admin/minister/midia)

### Erro: "pnpm-lock.yaml out of sync" em CI

**Solução**:
```bash
pnpm install --frozen-lockfile=false
git add pnpm-lock.yaml
git commit -m "chore: update lockfile"
git push
```

### Emails não são enviados

**Verificar**:
1. `RESEND_API_KEY` é válido em `.env.production.local`?
2. Workflow em GitHub Actions tem permissão para rodar?
3. Se testando, configure `SCHEDULE_EMAIL_TEST_RECIPIENT`
4. Cheque logs em GitHub Actions → **schedule-email-reminders**

### YouTube search não retorna resultados

**Verificar**:
1. API quota esgotada? (limit de 100 requests/dia por IP)
2. Video URL é válida e pública?
3. Confirme em cache: `public.youtube_search_cache`

### Cifras não carregam (PDF/conteúdo vazio)

**Soluções**:
1. Rode `pnpm backfill:cifras` manualmente
2. Verifique se Cifralize/CifraClub está acessível
3. Song pode não ter correspondência no site (tone diferente)

### Service Worker não atualiza

**Solução**:
1. DevTools → Application → Service Workers → **Unregister**
2. Limpe cache: DevTools → Application → Cache Storage → Delete
3. Feche aba e abra novamente
4. Se instalado como PWA, desinstale e reinstale

## 📚 Próximas Melhorias

- [ ] Testes automatizados (Vitest/Jest) para fluxos críticos
- [ ] UI de drag-and-drop para reordenar repertório
- [ ] Integração com WhatsApp/Telegram para notificações
- [ ] Catálogo de eventos sazonais/recorrentes
- [ ] Dashboard com analytics de ministério
- [ ] Export de escala em múltiplos formatos (PDF, iCal)
- [ ] Configuração de roles/permissões por UI (atualmente SQL)

## 📞 Suporte

Para dúvidas ou bugs, abra uma issue no repositório.
