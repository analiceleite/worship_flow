# Como Executar as Migrations no Supabase

## Passo 1: Executar 001_create_tables.sql (se ainda não executou)

1. Abra seu projeto no [Supabase Dashboard](https://app.supabase.com)
2. Vá em **Database** → **SQL Editor**
3. Clique em **New query**
4. Copie todo o conteúdo de `scripts/001_create_tables.sql`
5. Cole no editor e clique em **Run**
6. Verifique em **Database** → **Tables** se as tabelas foram criadas:
   - ministers
   - songs
   - repertoire

## Passo 2: Executar 003_auth_and_ownership.sql

1. No SQL Editor, clique em **New query**
2. Copie todo o conteúdo de `scripts/003_auth_and_ownership.sql`
3. Cole no editor e clique em **Run**
4. Aguarde a execução (pode levar alguns segundos)
5. Verifique se não há erros no console

## Passo 3: Criar o primeiro usuário Admin

### 3.1 Criar conta no Supabase Auth

1. Vá em **Authentication** → **Users**
2. Clique em **Add user** → **Create new user**
3. Preencha:
   - **Email**: seu email (ex: admin@exemplo.com)
   - **Password**: senha temporária
   - **Auto Confirm User**: ✅ Marque esta opção
4. Clique em **Create user**
5. **COPIE o User ID** (UUID) que aparece na lista

### 3.2 Associar usuário à tabela ministers

1. Volte para **Database** → **SQL Editor**
2. Cole este comando (SUBSTITUA o user_id pelo UUID copiado):

```sql
INSERT INTO ministers (name, email, role, user_id, is_active, instrument)
VALUES (
  'Admin',                          -- Seu nome
  'admin@exemplo.com',              -- Mesmo email do auth
  'admin',                          -- Role de admin
  'cole-o-uuid-aqui',               -- UUID do passo 3.1
  true,                             -- Conta ativa
  'Outro'                           -- Instrumento (pode mudar depois)
);
```

3. Clique em **Run**

## Passo 4: Verificar se funcionou

Execute esta query para confirmar:

```sql
SELECT 
  m.name,
  m.email,
  m.role,
  m.is_active,
  m.user_id
FROM ministers m
WHERE m.role = 'admin';
```

Deve retornar seu usuário admin.

## Passo 5: Testar RLS Policies

Para verificar se as políticas de segurança estão ativas:

1. Vá em **Database** → **Tables**
2. Clique na tabela **ministers**
3. Role até o final e veja a seção **Policies**
4. Deve mostrar várias policies como:
   - "Admins can view all ministers"
   - "Ministers can view their own record"
   - etc.

## Próximos Passos

Após executar as migrations:

1. Configure as variáveis de ambiente no projeto Next.js
2. Implemente as páginas de login e autenticação
3. Teste o login com o usuário admin criado

## Troubleshooting

### Erro: "relation does not exist"
- Certifique-se de ter executado `001_create_tables.sql` primeiro

### Erro: "column already exists"
- Pode ter executado a migration mais de uma vez
- Use `DROP COLUMN IF EXISTS` ou recrie as tabelas

### RLS bloqueando acesso
- Verifique se está autenticado ao fazer queries
- Use o SQL Editor como superuser para debug
- Teste as helper functions:
  ```sql
  SELECT is_admin();
  SELECT get_current_minister_id();
  ```
