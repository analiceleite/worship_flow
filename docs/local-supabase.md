# Supabase local com Docker

## Opção recomendada: Compose na raiz

```powershell
docker compose up -d --build
```

Esse comando sobe a aplicação e os serviços locais, aplica migrações e cria contas fictícias sem Node/CLI instalados no host. A documentação completa e os comandos de teste estão em `docker/local/README.md`. Não executar o ambiente do CLI abaixo ao mesmo tempo: as portas são compartilhadas, os volumes e as contas não.

## Alternativa: Supabase CLI com aplicação no host

Ambiente de desenvolvimento separado da produção. Requer Docker Desktop em execução e Node.js 20+; o CLI está fixado como dependência de desenvolvimento do projeto.

## Primeiro uso

```powershell
pnpm install
pnpm local:start
pnpm local:seed
pnpm local:dev
```

- App local: http://127.0.0.1:3001
- Supabase Studio: http://127.0.0.1:54323
- Emails capturados no Mailpit: http://127.0.0.1:54324
- API: http://127.0.0.1:54321

O primeiro start baixa imagens Docker e pode demorar e consumir vários GB. Não abrir portas no roteador nem expor esses serviços publicamente; verificar também o firewall do Docker Desktop. A aplicação Next é vinculada a `127.0.0.1`.

## Isolamento da produção

- Não é necessário `supabase login` ou `supabase link`. **Não vincular esta configuração ao projeto produtivo.**
- `local:dev` obtém as chaves do CLI local em memória e sobrescreve as variáveis de Supabase e origem somente no processo filho. Não altera `.env.local` nem importa dados do banco remoto.
- Resend, Google Calendar, importer autenticado e YouTube API ficam sem credenciais nesse processo. A recuperação de senha usa a API do Mailpit, sem emails externos. O modo local recusa a combinação com banco remoto ou ambiente de produção.
- Cache/build da aplicação local usa `.next-local`, separado de `.next`. Fechar abas antigas antes de validar para evitar confundir sessões ou bundles. Não validar este ambiente com `pnpm dev`: esse comando continua usando a configuração habitual, que pode apontar para produção.
- Chaves de serviço e senhas não são impressas pelos scripts. Credenciais fictícias ficam em `supabase/.local/accounts.json`, ignorado pelo Git. Não publicar esse arquivo ou o conteúdo de `supabase/.local/cli-error.log`.

## Dados fictícios

`local:seed` cria quatro usuários ativos, divididos em duas igrejas de teste:

- `admin@worship.local.test`
- `vocal@worship.local.test`
- `midia@worship.local.test`
- `admin@other.local.test`

As senhas são geradas aleatoriamente e registradas no arquivo local de contas. O seed pode ser repetido; atualiza os perfis fictícios e preserva credenciais registradas. Se alterar a senha durante um teste, o arquivo não é atualizado automaticamente: usar a senha nova ou a recuperação local. Não usar o script de demonstração antigo, que lê `.env.local` diretamente.

Não existe catálogo musical ou escala completa no seed inicial. O objetivo imediato é validar Auth/recuperação e isolamento com dados mínimos. Isso não representa dados ou comportamento medido da igreja.

## Migrações

`scripts/001_create_tables.sql` é um snapshot de referência e avisa que não pode ser executado diretamente. `local:prepare` gera um bootstrap **somente local**, preservando as definições mas ordenando tabelas pelas dependências. Depois copia as migrações disponíveis a partir da 016 para `supabase/migrations/`, com nomes ordenáveis. O start aplica migrações no banco local; `local:migrate` aplica novas migrações após a preparação.

Os arquivos gerados são ignorados pelo Git. As fontes permanecem em `scripts/`; não há duplicação manual de SQL nem mudança nas migrações de produção. Migração já gerada com conteúdo diferente bloqueia a preparação, em vez de reescrever silenciosamente o histórico. Revisar a mudança e criar um incremento apropriado; o wrapper não executa reset.

**Nunca aplicar esse bootstrap em produção nem usar `db push --remote`/comandos remotos nesta pasta.** O histórico anterior à 016 não está completo no repositório; essa reconstrução é suficiente apenas para o que for efetivamente testado. Não comprova equivalência com o esquema, triggers, configurações Auth ou versão do Postgres produtivos. A configuração local usa Postgres 17; confirmar compatibilidade antes de qualquer implantação remota.

## Uso diário

```powershell
pnpm local:start    # Sobe/retoma containers e aplica migrações pendentes locais
pnpm local:status   # Confirma API local sem imprimir chaves
pnpm local:migrate  # Prepara e aplica apenas migrações locais pendentes
pnpm local:dev      # Sobe app em 127.0.0.1:3001 usando o banco local
pnpm local:stop     # Para serviços, preservando dados
```

Não há comando de reset automático. Não usar `stop --no-backup`, remover volumes Docker ou `db reset` sem decidir explicitamente descartar os dados locais.

## Testes e aceite

```powershell
pnpm test:local-tools
pnpm test:recovery
pnpm local:test
```

Os dois primeiros comandos usam verificações locais/simuladas e não precisam de Docker. `local:test` exige o stack em execução e exercita os handlers reais contra Auth/Postgres/Mailpit locais, sem subir o navegador: cria uma conta temporária, testa recuperação, reutilização, expiração, concorrência, contadores e restrições de acesso, e remove apenas essa conta ao terminar. Usa alterações SQL seletivas no container local para simular expiração. Os emails de teste permanecem no Mailpit local; não são entregues externamente.

Para validação manual do WF-01, usar o app da porta 3001, uma conta fictícia e o email capturado na porta 54324. Seguir também `docs/password-recovery-operations.md`, verificando política de senha e interação no celular. O prazo de email/OTP local é de 30 minutos, não uma afirmação sobre a configuração de produção.

Nenhum resultado local autoriza por si só publicar a correção, executar SQL remoto ou marcar o card concluído. A publicação continua exigindo revisão e autorização.
