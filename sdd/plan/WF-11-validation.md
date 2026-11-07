# WF-11 — Evidências e pendências de validação

**Branch:** `fix/wf-11-consulta-escala-midia`

**Referências:** [SPEC](../spec/SPEC-WF-11-consulta-escala-midia.md) · [PLAN](PLAN-WF-11-implementation.md)

**Resultado:** Implementação validada automaticamente em ambiente local; revisão humana, acessibilidade manual e implantação pendentes.

## 1. Alterações entregues

- Mídia acessa somente a rota de consulta de escala, pelo menu desktop/móvel e link direto. A árvore administrativa continua bloqueada.
- Entrada em “Meus compromissos”, com alternância explícita para a escala geral publicada da igreja.
- Compromissos agrupados por ocorrência e identidade do integrante; chegada e início do culto vêm do período retornado. Ensaio mantém sua própria data, horário e local.
- Mensagens distintas para ausência de publicação, de atribuições e de compromissos futuros; erros principal e auxiliar têm recuperação, sem falso vazio. Requisições antigas são abortadas/ignoradas.
- Consultas de ensaios, lista de períodos e atribuições por período impedem leitura de rascunhos por mídia. As rotas permanecem dinâmicas e autenticadas.
- Migração `scripts/037_schedule_media_read_access.sql`: políticas **restritivas** sobre períodos, atribuições e ensaios, limitando leitura por mídia a publicações da própria igreja e negando escrita, mesmo com políticas permissivas anteriores.
- `ScheduleGrid` distingue erro/carregamento de ensaio não cadastrado; demais consumidores preservam o comportamento padrão.
- Testes integrados aos executores locais CLI/Compose; versão e catálogo de novidades não alterados.

## 2. Ambiente e segurança dos testes

- Stack Docker existente e isolado: `worship-flow-wf07-test`; aplicação em `127.0.0.1:3001`, API em `127.0.0.1:54321`, Postgres em `127.0.0.1:54322`.
- Testes de navegador exigem opt-in e o marcador preexistente `wf07.browser_test=on`, usado para distinguir esse banco de testes do desenvolvimento comum.
- Somente dados fictícios, duas igrejas e perfis de teste. Integração de RLS usa transação com rollback; navegador remove apenas suas próprias fixtures e conta temporária.
- Sem carregamento de credenciais produtivas nem entrega externa de e-mail. Navegador bloqueia destinos não locais. Erros das requisições de teste são sanitizados para não publicar cookies de sessão.
- Nenhum reset, remoção de volume, migração remota ou alteração de checksum histórico foi realizado.
- As duas igrejas fictícias e a conta temporária deixadas pela execução interrompida também foram removidas seletivamente do banco de testes, sem afetar os demais dados locais.

## 3. Comandos e resultados

| Validação | Resultado |
|---|---|
| `pnpm test:schedule-media` | 14 testes aprovados: navegação e contratos/regras de mídia. |
| `node --test tests/navigation.test.cjs tests/schedule-media.test.cjs tests/repertoire.test.cjs tests/password-recovery.test.cjs tests/release-notes.test.cjs tests/profile-avatar.test.cjs tests/user-identity.test.cjs tests/local-supabase.test.mjs tests/compose-transport.test.cjs` | 73 testes aprovados. Inclui os testes de mídia/navegação anteriores, não é uma contagem adicional independente. |
| `docker compose -p worship-flow-wf07-test run --rm --no-deps test node --test tests/schedule-media.local.test.cjs` | 5 testes aprovados contando o agrupador: leitura real por RLS, negativas de escrita, isolamento, regressão de papéis e despublicação. |
| `docker compose -p worship-flow-wf07-test run --rm --no-deps test` | 28 testes aprovados contando agrupadores: recuperação real de senha, regressão WF-07 e WF-11. Inclui os testes de RLS acima. |
| `$env:WF11_BROWSER_TEST='true'` e `pnpm test:schedule-media:browser` | 10 testes aprovados contando o agrupador, em Edge headless: 9 cenários de jornada, incluindo resposta atrasada após abandonar a página. |
| `pnpm exec tsc --noEmit --incremental false` | Aprovado no host, independentemente do build, cuja configuração atual ignora erros de TypeScript. |
| `docker compose -p worship-flow-wf07-test run --rm --no-deps -e NODE_ENV=production test pnpm build` | Build de produção aprovado no container, usando somente configuração local. |
| `pnpm lint` | Bloqueado: executável ESLint não instalado no projeto. Nenhuma dependência foi adicionada apenas para ocultar esse bloqueio. |

O primeiro build no serviço de testes, que define `NODE_ENV=development`, falhou no prerender de autenticação. A execução com `NODE_ENV=production` passou. Persistem avisos de migração futura de `middleware` para `proxy` e do build de PDF no Node; não foram tratados neste card.

As primeiras execuções de navegador exigiram aumentar timeout para compilação inicial do Next e selecionar o elemento visível entre versões desktop/móvel da grade. A execução final passou; uma reexecução intermediária foi interrompida e não foi contada como aprovação.

## 4. Rastreabilidade por critério

| Critério | Evidência automatizada e limites |
|---|---|
| CA-01 | Navegador: menu desktop, menu de 360px e acesso direto; regra de rota exata coberta em unitários. |
| CA-02 | Navegador abre `/schedule`, mesmo destino dos avisos; contexto anônimo é redirecionado ao login. Nenhum e-mail real disparado. Retorno automático após login permanece fora do escopo. |
| CA-03 | Navegador confirma função, chegada `16:15`, culto `18:45` e ensaio no dia anterior às `19:25`; unitários cobrem homônimos, múltiplas funções, ano novo e horários ausentes. |
| CA-04 | Navegador confirma entrada pessoal, alternância para geral, colega da equipe visível e ausência de troca automática quando não escalado. |
| CA-05 | Navegador confirma ausência de publicação; contratos e RLS reais negam rascunhos, inclusive despublicação após criação. |
| CA-06 | Navegador distingue nenhuma atribuição de atribuições apenas no passado; visão geral continua disponível. |
| CA-07 | Navegador injeta falhas principal/auxiliar e verifica recuperação, sem falso vazio; resposta de visita abandonada não substitui estado atual. Troca de igreja via impersonação não foi exercitada no navegador. |
| CA-08 | Navegador chama diretamente APIs de atribuição, criação, exclusão, publicação, importação e ensaio: 403; ausência de controles de gestão. Postgres confirma insert negado e update/delete sem efeitos para mídia. |
| CA-09 | APIs reais e RLS recusam outra igreja/IDs manipulados; leituras alternativas e auxiliares cobertas. |
| CA-10 | RLS real confirma consulta de rascunhos por admin/ministro, edição de ensaio por ambos e gestão de período/atribuição por admin. Login de mídia continua no repertório. Jornada visual completa dos demais perfis não foi refeita. |
| CA-11 | Navegador desktop e 360px, navegação de aba por teclado e controles sem edição. Revisão manual de leitor de tela, foco/zoom e dispositivo real permanece pendente. |

O checklist da SPEC não foi marcado automaticamente como aceite humano.

## 5. Migração local e pendência operacional

O preparador Compose gerou as fontes locais; o migrador interrompeu a execução ao detectar checksum diferente para a migração **preexistente 036**. O histórico não foi sobrescrito e os dados não foram resetados.

A migração **037** foi aplicada isoladamente ao Postgres do stack de testes com `psql -v ON_ERROR_STOP=1 -f`, e sua transação concluiu com sucesso antes dos testes de RLS. Ela não depende das funções de repertório da 036. Essa aplicação seletiva não foi usada para falsificar uma entrada no registro de migrações; o runner completo continua exigindo revisão da divergência antiga.

Antes de uma implantação autorizada:

1. Revisar a origem da divergência de 036 no ambiente local, sem reescrever migrações já aplicadas nem alterar checksums para forçar sucesso.
2. Conferir políticas/grants e histórico do ambiente alvo; a reconstrução local não comprova equivalência com produção.
3. Aplicar a 037 revisada **antes** de liberar a nova consulta. A proteção das APIs não substitui RLS para acesso direto.
4. Executar smoke check autorizado de mídia/admin/ministro. Em falha, retirar a liberação da consulta sem relaxar políticas ou apagar dados.

## 6. Estado da entrega

- Implementação e testes locais concluídos nos limites acima.
- Revisão humana e verificação manual de acessibilidade pendentes.
- Lint bloqueado por dependência preexistente ausente.
- Checksum local de 036 pendente de investigação operacional; nenhuma mudança nele faz parte do WF-11.
- Commit, push e abertura de PR autorizados pelo usuário em 2026-11-07; sem alteração de versão ou deploy. O histórico Git e a PR registram a publicação da branch para revisão.
- A alteração preexistente de `next-env.d.ts` foi preservada.

### Retomada após reinício — 2026-11-07

A última suíte de navegador concluiu com os 10 testes aprovados, incluindo o cenário adicional de resposta atrasada. Depois disso, a tentativa de reconstruir novamente a imagem local foi interrompida; na retomada, o Docker Desktop estava indisponível. Não foi repetido nem presumido sucesso dessa reconstrução final. O build de produção aprovado anteriormente permanece como evidência da execução registrada acima; a página final também passou por TypeScript e pelo navegador após os últimos ajustes de formatação e extração da chave de semana ISO.
