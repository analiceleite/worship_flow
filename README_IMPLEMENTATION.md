# Worship Flow - Sistema de Gerenciamento de Repertório

Sistema completo de gerenciamento de músicas e repertórios para ministérios de louvor, com autenticação e controle de acesso baseado em roles (Admin/Ministro).

## 🚀 Implementação Concluída

### ✅ O que foi desenvolvido:

1. **Sistema de Autenticação Completo**
   - Login com email e senha
   - Primeira ativação de conta (ministro define senha)
   - Logout
   - Middleware para proteção de rotas

2. **Sistema de Roles**
   - **Admin**: Gerencia ministros, visualiza todas as músicas, monta repertórios
   - **Ministro**: Gerencia apenas suas próprias músicas, visualiza repertórios

3. **Gestão de Ministros (Admin-only)**
   - Criar novos ministros com email e instrumento
   - Sistema cria conta automaticamente no Supabase Auth
   - Ministro recebe credenciais e define senha no primeiro acesso
   - Editar informações (nome e email)
   - Excluir ministros

4. **Gestão de Músicas**
   - Ministros adicionam suas próprias músicas
   - Tom personalizado por ministro
   - Links para YouTube e cifra
   - Editar/excluir apenas músicas próprias
   - Admin visualiza todas as músicas com identificação do dono

5. **Gestão de Repertório (Admin-only)**
   - Criar repertórios por data
   - Selecionar músicas dos ministros
   - Atribuir ministro responsável por cada música
   - Ordenação de músicas no culto
   - Ministros visualizam apenas seus agendamentos

6. **Interface Atualizada**
   - Header com perfil do usuário e logout
   - Navegação adaptada por role (Admin vê "Ministros", ministro não)
   - Badges identificando ministro dono de cada música
   - Formulários adaptados por permissão

7. **Banco de Dados Reestruturado**
   - Tabela `ministers` com campos auth (user_id, role, is_active)
   - Tabela `songs` com `minister_id` obrigatório
   - Tabela `repertoire` com event_date e order_index
   - RLS Policies para segurança

---

## 📋 Próximos Passos - Como Executar

### Passo 1: Executar Migration no Supabase

1. Abra [Supabase Dashboard](https://app.supabase.com) → seu projeto
2. Vá em **Database** → **SQL Editor** → **New query**
3. Copie e cole o conteúdo de `scripts/003_auth_and_ownership.sql`
4. Clique em **Run** (RUN agora)
5. Aguarde conclusão (deve retornar sucesso)

### Passo 2: Criar Usuário Admin

1. No Supabase, vá em **Authentication** → **Users**
2. Clique em **Add user** → **Create new user**
3. Preencha:
   - Email: `admin@seudominio.com`
   - Password: `senha_temporaria_123`
   - **✅ Marque**: Auto Confirm User
4. Clique em **Create user**
5. **COPIE o User ID (UUID)** que aparece na lista

6. Volte para **Database** → **SQL Editor**
7. Cole este comando (SUBSTITUA `cole-o-uuid-aqui` pelo UUID copiado):

```sql
INSERT INTO ministers (name, email, role, user_id, is_active, instrument)
VALUES (
  'Administrador',
  'admin@seudominio.com',
  'admin',
  'cole-o-uuid-aqui',
  true,
  'Outro'
);
```

8. Clique em **Run**

### Passo 3: Configurar Variáveis de Ambiente

Verifique se o arquivo `.env.local` existe na raiz do projeto com:

```env
NEXT_PUBLIC_SUPABASE_URL=sua-url-do-supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
```

### Passo 4: Instalar Dependências e Rodar

```bash
pnpm install
pnpm dev
```

### Passo 5: Fazer Login

1. Abra http://localhost:3000
2. Será redirecionado para `/auth/login`
3. Entre com as credenciais do admin criadas no Passo 2
4. Você será redirecionado para a página de ministros (admin)

---

## 🎯 Fluxo de Uso

### Como Admin:

1. **Criar Ministros**
   - Vá em "Ministros"
   - Clique em "Novo Ministro"
   - Preencha nome, email e instrumento
   - Sistema cria conta automaticamente

2. **Enviar Credenciais ao Ministro**
   - O ministro deve acessar http://localhost:3000/auth/login
   - Email: o email cadastrado
   - Senha: a senha temporária que o admin deve enviar manualmente ao ministro
   - **IMPORTANTE**: O sistema NÃO envia email automático ainda (próxima implementação)

3. **Montar Repertório**
   - Vá em "Repertório"
   - Selecione data do culto
   - Adicione músicas dos ministros
   - Atribua responsável
   - Defina ordem

### Como Ministro:

1. **Primeiro Acesso**
   - Acesse `/auth/login` com email e senha fornecidos pelo admin
   - Será redirecionado para `/auth/set-password`
   - Defina sua nova senha
   - Conta será ativada

2. **Gerenciar Músicas**
   - Vá em "Músicas"
   - Adicione suas músicas com tom pessoal
   - Adicione links de YouTube e cifra
   - Edite/exclua apenas suas músicas

3. **Ver Repertórios**
   - Vá em "Repertório"
   - Visualize cultos onde você está escalado
   - Veja suas músicas atribuídas

---

## 🔐 Segurança Implementada

### Row Level Security (RLS)

Todas as tabelas têm políticas de segurança:

- **Ministers**: Admin vê todos, ministro vê apenas próprio registro
- **Songs**: Todos veem todas, mas só dono edita/exclui
- **Repertoire**: Todos veem, só admin gerencia

### Proteção de Rotas (Middleware)

- Usuários não autenticados → redirecionados para `/auth/login`
- Contas inativas → redirecionadas para `/auth/set-password`
- Rotas admin → bloqueadas para ministros comuns

---

## 📝 Funcionalidades Pendentes (Recomendações)

### Prioridade Alta:
1. **Envio de Email Automático**
   - Integrar Supabase Auth com provedor de email
   - Enviar convite automático ao criar ministro
   - Link de reset de senha

2. **Dashboard do Ministro**
   - Página inicial mostrando próximos cultos
   - Lista de músicas mais usadas
   - Estatísticas pessoais

### Prioridade Média:
3. **Busca de Músicas no YouTube**
   - Integrar YouTube Data API
   - Buscar vídeos direto no formulário
   - Preview antes de adicionar

4. **Exportação de Repertório**
   - Gerar PDF do repertório
   - Imprimir lista de músicas
   - Compartilhar via WhatsApp

5. **Histórico de Cultos**
   - Visualizar repertórios passados
   - Reutilizar repertórios antigos
   - Estatísticas de músicas mais tocadas

### Prioridade Baixa:
6. **Transposição Automática de Tom**
   - Calcular transposição entre tons
   - Sugestão de capotraste

7. **Integração com Cifra Club**
   - Buscar cifras automaticamente
   - Não tem API oficial (avaliar scraping ou alternativa)

---

## 🐛 Troubleshooting

### Erro: "Could not find the table"
- Executou a migration? Veja Passo 1

### Erro: "row-level security policy"
- RLS policies foram criadas? Rode a migration completa

### Não consigo fazer login
- Confirmou o usuário no Supabase Auth?
- Marcou "Auto Confirm User"?
- Criou registro na tabela ministers?

### Ministro não consegue ver suas músicas
- Conferiu se `minister_id` está sendo salvo corretamente?
- Verificou se o user_id do ministro está correto?

### Admin não aparece opção "Ministros"
- Conferiu se o role está como 'admin' na tabela ministers?
- Fez logout e login novamente?

---

## 📚 Estrutura do Projeto

```
worship_flow/
├── app/
│   ├── auth/
│   │   ├── login/page.tsx          # Página de login
│   │   └── set-password/page.tsx   # Ativação de conta
│   ├── ministros/page.tsx          # Gestão de ministros (admin)
│   ├── musica/[id]/page.tsx        # Detalhes da música
│   ├── repertorio/page.tsx         # Gestão de repertório
│   └── page.tsx                    # Listagem de músicas
├── components/
│   ├── header.tsx                  # Header com auth
│   ├── minister-form.tsx           # Form de ministro (admin)
│   ├── song-form.tsx               # Form de música
│   └── song-card.tsx               # Card de música
├── lib/
│   ├── types.ts                    # Interfaces TypeScript
│   └── supabase/
│       ├── client.ts               # Cliente Supabase browser
│       └── server.ts               # Cliente Supabase server
├── scripts/
│   ├── 001_create_tables.sql       # Schema inicial
│   ├── 003_auth_and_ownership.sql  # Migration auth + RLS
│   └── README_MIGRATION.md         # Guia de migration
└── middleware.ts                   # Proteção de rotas
```