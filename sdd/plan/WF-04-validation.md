# WF-04 — Evidências da validação local do primeiro incremento

**Data:** 2026-11-07

**Branch:** `feature/wf-04-onboarding-multichurch`

**PLAN:** [PLAN-WF-04-implementation.md](PLAN-WF-04-implementation.md)

**Resultado:** primeiro incremento validado automaticamente no ambiente local. A WF-04 completa **não está concluída nem aprovada para implantação**: convites e integração multigreja ainda estão pendentes.

## 1. Escopo implementado e validado

- Migração de expansão `scripts/038_onboarding_foundation.sql`: snapshot único do legado, ativação dos vínculos existentes, estados explícitos, perfil global, projeção de nome/foto, restrições adicionais por vínculo ativo, proteção do último ADMIN e auditoria de suspensão/reativação.
- Identidade separada do contexto; resolução segura de vínculo, recusando seleção ambígua, destino não autorizado, vínculo pendente/suspenso e igreja inativa.
- `/api/me/memberships` limitado à identidade autenticada.
- `/api/profile` e avatar globais, com escrita pelo titular; projeções locais preservam os joins existentes e IDs dos ministros.
- Edição de nome no perfil, atualização do cabeçalho, upload e remoção de foto por identidade.
- Suspensão/reativação local na equipe por API transacional. DELETE antigo rejeita exclusão definitiva, sem remover conta Auth ou histórico.
- Seed e fixtures adaptados aos estados; manutenção de fixtures limitada a sessão postgres direta e protocolo explícito.

## 2. Ambiente e limites de isolamento

- Stack Compose existente: `worship-flow-wf07-test`, com marcador de banco `wf07.browser_test=on` previamente presente.
- API Supabase em `127.0.0.1:54321`, banco em `127.0.0.1:54322`, app em `127.0.0.1:3001`, Mailpit em `127.0.0.1:54324`.
- Aplicação reconstruída a partir do código local, com configuração pública de teste, sem carregar `.env` de produção na imagem.
- Testes browser com Edge headless e bloqueio de destinos externos. Usuários e dados de fixtures fictícios; recuperação enviou somente ao Mailpit.
- Nenhum banco remoto foi consultado ou modificado, nenhum e-mail real foi enviado e nenhum volume foi resetado.

### Divergência histórica preservada

O banco tinha migrações até 036, cuja checksum registrada difere do arquivo atual do repositório. A divergência foi identificada antes de migrar e **não foi apagada, regravada ou tratada como equivalência de histórico**.

Para validar o incremento nesse stack dedicado, foram aplicadas somente 037 e 038, em transações com registro de suas próprias checksums e recarga do schema PostgREST. A aplicação incremental não passou pelo migrador completo que recusa a divergência da 036.

Portanto, estes resultados validam o incremento sobre esse banco de testes. **Não comprovam uma instalação limpa de toda a cadeia de migrações nem removem a necessidade de reconciliar a proveniência da 036 antes de implantação.**

## 3. Resultados finais

Contagens seguem o relatório do `node:test`, incluindo testes-pai.

| Validação | Resultado final |
|---|---|
| Unitários e regressões sem banco | **86 passaram**, zero falhas. |
| Integração real: onboarding, recuperação, repertório e escala de Mídia | **34 passaram**, zero falhas. |
| Browser WF-04 | **6 passaram**, zero falhas. |
| Browser repertório WF-07 | **12 passaram**, zero falhas na repetição final. |
| Browser escala de Mídia WF-11 | **10 passaram**, zero falhas. |
| Preflight da migração 038 antes da aplicação persistente | **1 passou**, com rollback integral. |
| `pnpm build` | Passou; configuração existente pula tipos, conferidos separadamente. |
| `pnpm exec tsc --noEmit --incremental false` | Passou, executado após build, sem corrida de tipos gerados. |
| `git diff --check` | Passou; avisos locais LF/CRLF não são erros de whitespace. |
| `pnpm lint` | Bloqueado: ESLint ausente das dependências disponíveis; nenhuma instalação realizada. |

### Banco/RLS e migração

- Legado originalmente inativo fica ativo uma única vez, com perfil global e ID preservado.
- Reaplicar a migração não amplia o conjunto legado nem reativa suspensões posteriores; novos registros ficam pendentes.
- Pendentes e suspensos não consultam equipe operacional; ativo não acessa outra igreja.
- Perfis globais projetam nome/foto; ADMIN local não renomeia outra pessoa globalmente nem escreve no perfil global diretamente.
- RPC de acesso indisponível ao papel `authenticated`; último ADMIN, ativação administrativa de pendente, troca de identidade do vínculo e exclusão física são rejeitados.
- Repetir suspensão não duplica auditoria.
- Duas conexões tentam suspender simultaneamente seus próprios administradores: exatamente uma operação conclui; a outra é recusada e um ADMIN permanece ativo.

### Browser WF-04

- Login de ADMIN e integrante com fixtures independentes.
- Nome editado no perfil é persistido globalmente e projetado para o ministro.
- Upload real de PNG no Storage usa caminho por identidade; remoção funciona e preserva propriedade.
- Injeção de identidade, alteração de integrante de outra igreja, suspensão do último ADMIN e DELETE legado são recusados.
- Integrante comum não modifica acesso administrativo.
- Suspensão pela UI mantém a conta Auth e o perfil, negando acesso a uma sessão previamente aberta; reativação restaura esse acesso.
- Formulário de perfil usável em viewport de 360px, sem overflow horizontal.
- Isso não equivale a uma auditoria completa de leitor de tela, contraste ou zoom 200%.

## 4. Problemas encontrados e correções

1. **Origem atrás de proxy:** comparar `Origin` à URL interna do Next.js rejeitava gravações legítimas no Docker. Novo `lib/auth/request-origin.ts` usa a origem pública configurada em `APP_BASE_URL`, não confia em forwarded headers e continua rejeitando origem externa/ausente e configuração inválida. Correção coberta por testes unitários e browser reais.
2. **Fixtures WF-04:** casts explícitos de UUID eliminaram erro PostgreSQL de tipos inconsistentes no identificador também usado como slug.
3. **Teste de rollback do repertório:** concorrência anterior pode remover um item, tornando posição fixa 25 inválida. O teste agora usa o total real, alcançando a falha injetada sem relaxar sua asserção de rollback.
4. **Browser em desenvolvimento:** navegação do player e primeira compilação podem exceder 20s; timeout de navegação ajustado para 90s, sem alterar timeout de asserts. Foto é testada após recarregar o perfil para evitar interferência de navegação/HMR do subteste anterior.
5. **Runner de recuperação:** execução inicial pelo host apontava para container do CLI ausente. A execução final ocorreu via serviço Compose e passou integralmente, sem mudar a lógica de recuperação.

As falhas iniciais não foram omitidas: os resultados da seção 3 são as repetições finais após essas correções/ajustes de ambiente.

## 5. Comandos para reproduzir

Depois de reconstruir a imagem, com schema 038 já validado/aplicado no stack dedicado:

```powershell
docker compose -p worship-flow-wf07-test --profile test run --rm --no-deps test

$env:WF04_BROWSER_TEST='true'
pnpm test:onboarding:browser

$env:WF07_BROWSER_TEST='true'
pnpm test:repertoire:browser

$env:WF11_BROWSER_TEST='true'
pnpm test:schedule-media:browser

pnpm test:onboarding
pnpm build
pnpm exec tsc --noEmit --incremental false
```

O serviço Compose `test` inclui os quatro arquivos de integração com execução serial. Nesta sessão, o mesmo comando foi executado com a lista explícita de arquivos como override, antes de atualizar seu default.

Unitários completos executados:

```powershell
node --test tests/onboarding.test.cjs tests/profile-avatar.test.cjs tests/password-recovery.test.cjs tests/repertoire.test.cjs tests/navigation.test.cjs tests/schedule-media.test.cjs tests/user-identity.test.cjs tests/release-notes.test.cjs tests/local-supabase.test.mjs tests/compose-transport.test.cjs
```

`tests/onboarding-migration.local.test.cjs` requer conexão loopback e marcador do banco dedicado; só testa o primeiro corte antes da 038. Se ela já estiver aplicada, pula o preflight em vez de resetar histórico. O replay com corte existente continua coberto por `onboarding.local.test.cjs`.

## 6. O que impede encerrar a WF-04 inteira

1. **Convites não implementados:** faltam persistência, outbox, envio/reenvio/revogação, prova Supabase e aceite idempotente. A criação antiga por senha temporária e login/set-password ainda não foram substituídos. Não implantar esse estado intermediário como onboarding concluído.
2. **Multigreja ainda bloqueada:** índices de usuário/e-mail únicos e helpers antigos foram preservados intencionalmente. Seletor e todos os consumidores operacionais ainda precisam ser migrados. Os testes de contexto multigreja em memória não substituem a futura validação real de uma identidade em duas igrejas.
3. **Preferências/Google:** pausa global não pode ser exposta antes de os workers respeitarem sua semântica; conexão pessoal e seleção das igrejas precisam de migração.
4. **Migração histórica 036:** reconciliar proveniência e validar cadeia limpa/ambiente de homologação antes de qualquer aprovação de implantação.
5. **UX e segurança operacional:** telas sem igreja, mensagem de login suspenso, validação humana/auditoria de acessibilidade e revisão efetiva do Storage ainda pendentes. Objetos de avatar legados são retidos para limpeza segura posterior.
6. **Etapas relacionadas:** provisionamento, cota pública, checklist e signup permanecem pendentes e não são declarados concluídos pela validação da fundação.
7. **Lint:** resolver disponibilidade/configuração do ESLint em trabalho autorizado antes de declarar esse gate atendido.

Nenhum commit, push, PR, deploy ou migração remota foi realizado. Apenas o stack local dedicado recebeu as migrações 037/038; fixtures temporárias foram removidas ou revertidas, sem apagar dados preexistentes.
