# Ambiente local via Compose

Na raiz do repositório:

```powershell
docker compose up -d --build
```

Não exige Node, pnpm, Supabase CLI, login ou link com projeto hospedado no computador. É necessário Docker Desktop com containers Linux e Compose v2 atualizado. O primeiro build baixa dependências e pode levar vários minutos.

## Acessos

| Serviço | URL |
|---|---|
| Aplicação Next.js | http://127.0.0.1:3001 |
| Supabase Studio | http://127.0.0.1:54323 |
| Mailpit (emails capturados) | http://127.0.0.1:54324 |
| API Supabase | http://127.0.0.1:54321 |
| PostgreSQL | 127.0.0.1:54322 |

Todas as portas publicadas são vinculadas a `127.0.0.1`. O arquivo usa **credenciais públicas de desenvolvimento**, não é uma configuração de produção e não deve ser exposto na rede ou publicado como ambiente hospedado.

## Contas de teste

O serviço `seed` cria quatro usuários fictícios em duas igrejas, com senhas aleatórias:

- `admin@worship.local.test`
- `vocal@worship.local.test`
- `midia@worship.local.test`
- `admin@other.local.test`

Para consultar suas credenciais locais:

```powershell
docker compose exec app cat /local/accounts.json
```

Esse arquivo fica no volume `local-state`, não no Git ou na imagem. Não compartilhar sua saída. Alterações de senha feitas nos testes manuais não atualizam automaticamente o arquivo; usar a senha nova ou a recuperação via Mailpit.

## Como funciona

- `prepare` gera a configuração do gateway e o bootstrap de banco a partir dos scripts versionados. Não usa arquivos de credenciais da máquina.
- `db`, `auth`, `rest`, `storage`, `gateway`, `meta`, `studio` e `mailpit` fornecem os serviços usados pela aplicação. Realtime, Edge Functions, integrações pagas e cron não são iniciados.
- `db-bootstrap` ajusta os proprietários dos esquemas Auth/Storage e dos helpers Auth antes das migrações dos serviços. É idempotente e atende volumes já existentes, sem apagar dados ou conceder superusuário ao Auth.
- `migrate` aplica as migrações pendentes em transações e registra checksums no esquema privado `worship_local`. Alterar migração já aplicada bloqueia a execução; não há reset automático.
- `seed` espera o banco e a API estarem prontos. A aplicação só sobe após concluir a criação dos perfis fictícios.
- O navegador usa a API da porta 54321. Requisições de servidor são encaminhadas ao gateway na rede Docker, preservando a identidade pública usada por cookies. Esse encaminhamento é permitido somente no modo local.
- Resend e demais integrações autenticadas ficam sem credenciais. Emails de recuperação vão para o Mailpit, sem entrega externa.
- `.dockerignore` exclui `.env*`, credenciais/artefatos do CLI, `.git` e caches do contexto de build. O Compose não usa `env_file` nem interpola segredos de produção.
- A imagem é de desenvolvimento e contém o código no momento do build. Após editar código, executar novamente `docker compose up -d --build`; não há bind mount da pasta inteira ou Docker socket dentro dos containers.

O bootstrap reorganiza o snapshot de referência da migração 001 e aplica as migrações disponíveis desde a 016. Não prova equivalência com o banco produtivo nem substitui revisão de implantação. Nunca aplicar o bootstrap gerado em um banco hospedado.

## Comandos úteis

```powershell
docker compose ps
docker compose logs -f app
docker compose logs migrate seed
docker compose logs db-bootstrap auth
docker compose --profile test run --rm test
docker compose down
```

O teste real usa apenas Auth, Postgres e Mailpit desse Compose, cria um usuário temporário e remove somente esse usuário. Testa recuperação, expiração, reutilização, concorrência, contadores e permissões; não cobre interação no navegador.

`down` preserva os volumes de banco, PDFs, emails, credenciais fictícias e cache. **Não usar `down -v` para parar o ambiente**: essa opção apagaria os dados locais.

## Ambiente anterior do CLI

O Compose e o CLI usam as mesmas portas, mas **não compartilham volumes nem contas**. Para usar o Compose, parar antes o ambiente do CLI com `pnpm local:stop`; isso preserva seus dados. Para voltar ao CLI, executar `docker compose down` e depois `pnpm local:start`.

Não é feita migração automática de dados entre os dois ambientes. Não é necessário usar nenhum comando remoto do Supabase.

## Atualização após erro de proprietário no Auth

Se o Auth falhou com `must be owner of function uid`, manter os volumes e executar novamente `docker compose up -d --build`. O serviço `db-bootstrap` aplica o ajuste no banco local existente; não é necessário reset. Apenas `app` constrói a imagem, reutilizada pelos serviços auxiliares para evitar colisões de build.
