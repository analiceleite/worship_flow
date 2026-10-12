# README: Setup De Nova Igreja

Este guia descreve o processo operacional para ativar uma nova igreja no Worship Flow multitenant.

## Pre-requisitos

- Seu usuario precisa estar cadastrado em `platform_admins`.
- Voce precisa conseguir acessar `/platform/churches`.
- O ambiente deve ter variaveis de email configuradas se a igreja for usar notificacoes reais.
- Para igrejas de producao, `churches.environment` deve ser `production`.

## 1. Criar A Igreja

Acesse:

```txt
/platform/churches
```

Preencha:

- Nome: nome publico da igreja.
- Slug: identificador curto, por exemplo `igreja-central`.
- Status: `active`.
- Ambiente: `production` para cliente real.
- Email: `real` para envio real de notificacoes.
- Plano: plano comercial atual, por exemplo `free`, `starter`, `pro`.

Para demo/teste:

- Ambiente: `demo` ou `test`.
- Email: `disabled` ou `test_recipient`.
- Nunca usar `real` em demo/teste.

## 2. Validar Ambiente Vazio

Na lista de igrejas, clique em:

```txt
Impersonar
```

Valide que a nova igreja nao mostra dados de outra igreja:

- Usuarios vazios ou apenas os criados para ela.
- Musicas vazias.
- Repertorio vazio.
- Escala sem bimestre publicado.

Se aparecer dado de outra igreja, pare o setup e investigue antes de seguir.

## 3. Criar Primeiro Admin Da Igreja

Com a igreja impersonada, acesse:

```txt
/users
```

Crie o primeiro usuario da igreja:

- Nome: nome do responsavel.
- Email: email real do responsavel.
- Papel: `Administrador`.
- Instrumento/funcoes: conforme necessario.

O sistema gera uma senha temporaria. Envie ao responsavel por canal seguro.

## 4. Primeiro Acesso Do Admin

Oriente o admin da igreja a acessar:

```txt
/auth/login
```

Depois do login inicial, ele deve ativar/configurar a propria conta conforme fluxo normal do sistema.

## 5. Configuracao Inicial Da Igreja

O admin da igreja deve cadastrar:

- Ministros.
- Usuarios de midia.
- Musicas.
- Eventos especiais, se necessario.
- Primeiro bimestre de escala.
- Repertorios dos proximos cultos.

## 6. Notificacoes

Para igreja real:

- `environment = production`.
- `email_mode = real`.
- Ministros precisam ter email cadastrado.
- Ministros precisam estar ativos.

Para demo/teste:

- `environment = demo` ou `test`.
- `email_mode = disabled` ou `test_recipient`.
- Se usar `test_recipient`, configurar `SCHEDULE_EMAIL_TEST_RECIPIENT` no ambiente.

## 7. Google Calendar

Cada ministro conecta sua propria conta Google em:

```txt
/profile
```

Os tokens e eventos sao isolados por igreja.

## 8. Checklist De Validacao

Antes de entregar ao cliente, valide:

- Header mostra o nome correto da igreja ativa.
- `/users` mostra apenas usuarios da nova igreja.
- `/songs` mostra apenas musicas da nova igreja.
- `/repertoire` nao mostra repertorios de outra igreja.
- `/schedule` nao mostra escala de outra igreja.
- Publicar escala nessa igreja nao altera escala de outra igreja.
- Emails estao no modo correto.
- Impersonacao pode ser encerrada e volta para `/platform/churches`.

## 9. Encerrar Impersonacao

Depois da validacao, clique no banner:

```txt
Encerrar
```

Nao permaneca impersonando uma igreja sem necessidade operacional.

## SQL Util Para Promover Platform Admin

Caso precise adicionar um usuario como admin da plataforma:

```sql
insert into public.platform_admins (user_id)
select user_id
from public.ministers
where email = 'email@exemplo.com'
on conflict (user_id) do nothing;
```

## SQL Util Para Renomear Igreja

```sql
update public.churches
set name = 'Novo Nome',
    slug = 'novo-slug',
    updated_at = now()
where slug = 'slug-atual';
```

## Dados Demo

Para recriar/popular a igreja demo padrao:

```bash
node scripts/seed-demo-worship-flow.mjs
```

Credenciais padrao da demo:

```txt
Email: demo@worshipflow.app
Senha: Demo@12345
```

Troque a senha antes de expor publicamente se quiser controle maior de acesso.

## Observacoes De Seguranca

- Nao compartilhe `SUPABASE_SERVICE_ROLE_KEY`.
- Rotacione chaves se forem expostas.
- Use impersonacao apenas para suporte e demonstracao.
- Nunca use `email_mode = real` em igreja `demo` ou `test`.
- Sempre valide isolamento antes de entregar um novo tenant.
