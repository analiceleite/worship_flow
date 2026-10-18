# Importacao De Cifras Confiavel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar cifras por link no Render Free sem timeout prematuro, continuar durante navegacao interna e revisar/salvar uma cifra musicalmente correta sem novas buscas por troca de tom.

**Architecture:** O Next.js autentica e encaminha chamadas curtas; o microservico existente executa tarefas temporarias, com navegador reutilizavel, cache limitado e deduplicacao. Um coordenador cliente no layout acompanha despertar/status e conserva um rascunho por aba durante navegacao interna. A base musical original e imutavel; transposicao e revisao sao locais, e somente confirmacao explicita grava a musica na igreja efetiva.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/Postgres/RLS, Node.js ESM, Playwright existente; Vitest + Testing Library/jsdom para testes focados, pnpm no app e npm no container independente existente.

**Spec:** `sdd/spec/cifraclub-import-reliability-spec.md` (desenho aprovado). Ler tambem `AGENTS.md` antes de executar.

## Global Constraints

- Render Free; nenhum custo adicional, upgrade, Redis pago, fila distribuida ou keep-alive periodico.
- Despertar: 120 segundos. Trabalho aceito: 30 segundos, incluindo fila e extracao. Lease: 60 segundos. Retencao terminal para coleta: 10 minutos.
- Uma extracao ativa e no maximo tres trabalhos distintos aguardando por instancia, configuraveis.
- Um rascunho/importacao por aba, somente em memoria; sem recuperacao apos reload, fechamento, outra aba ou reinicio do worker.
- Trocar de rota nao cancela; logout ou troca de igreja/usuario limpa tudo e invalida respostas antigas.
- Snapshot e resultado nao sao salvos automaticamente. PDF e link Cifralize existentes continuam disponiveis.
- Sem tom `C` ou capo zero inventados; nenhuma transposicao parcial de tablatura apresentada como completa.
- Autorizacao server-side em cada operacao; `church_id` do frontend nunca autoriza. Cliente administrativo sempre escopado.
- Criar migrations/documentacao nao autoriza executa-las. Sem chamadas privadas, deploy ou testes externos sem autorizacao do ambiente.
- HTTP direto permanece desabilitado ate experimento aprovado e medido; nao usar API interna do Cifralize.
- Implementacao so comeca depois da revisao deste plano e escolha de execucao. Criar isolamento com `using-git-worktrees` no inicio da execucao; preservar arquivos ainda nao commitados do usuario.
- Checkpoints de commit abaixo sao sugeridos e so devem ser executados com autorizacao; incluir apenas arquivos da tarefa, nunca `git add .`.

## Review Focus

1. Resposta de criacao perdida depois de o worker aceitar: repetir a mesma chave nao pode criar tarefa, consumir quota nem extrair novamente (T4/T5).
2. Aba oculta, timers suspensos ou dispositivo offline: nao manter trabalho orfao indefinidamente nem reiniciar silenciosamente quando voltar (T4/T6).
3. Reabrir rascunho de edicao cuja musica foi removida ou mudou de dono: preservar trabalho local, mas rejeitar escrita indevida (T8/T9).
4. Separacao entre letra e acorde de um caractere, tabs e Unicode: nao alterar palavras, acentos, secoes ou diagramas por engano (T2/T3).
5. Novo deploy/reinicio entre polling e coleta: reconhecer tarefa perdida/expirada, sem loop, falso sucesso ou recriacao automatica (T4/T6/T10).

## Decisoes Tecnicas Deste Plano

- Nao criar um monorepo/workspace compartilhado nesta entrega. App TypeScript e worker JavaScript mantem fronteira HTTP; fixtures JSON de contrato iguais nos dois lados verificam compatibilidade.
- O worker retorna base original v2; Zod valida no app. O worker valida seu payload com Zod tambem, declarado em seu proprio package. Somente helpers musicais puros vao ao bundle cliente; nao importar Cheerio/Node por helpers de tom.
- Todas as chamadas do navegador continuam same-origin. Worker URL/token e identificadores de dono ficam somente no servidor.
- Vinculo de dono sem memoria Next.js: `ownerRef = HMAC-SHA256(token, JSON.stringify(['cifra-owner-v1', userId, churchId]))`; `churchRef` usa dominio separado e apenas churchId. Calcular com `node:crypto`, servidor, nunca enviar ao browser. Worker autentica bearer antes de confiar nesses refs e compara o dono em status/cancelamento.
- `jobId` deterministico e opaco: HMAC com dominio `cifra-job-v1`, ownerRef e `requestId` UUID gerado no cliente. Worker vincula jobId ao dono e hash de entrada; repeticao divergente retorna 409. Isso funciona entre instancias serverless sem store compartilhado.
- Quotas autoritativas na instancia unica do worker: 40 novas tentativas/usuario/hora e 120/igreja/hora, contando falhas; idempotencia antes de debitar. App pode ter protecao local adicional, mas nao deve alegar quota global distribuida. Probes: bucket separado 60/minuto/dono, polling 120/minuto/dono, com memoria limitada.
- Extracoes identicas compartilham resultado publico, mas cada dono possui tarefa privada e lease independente. Cancelamento de um nao cancela outros interessados.
- Limites iniciais: cache publico LRU 100 entradas e 20 MiB, TTL 7 dias; tarefas 200 registros, request JSON 8 KiB, resposta 512 KiB, cifra ate 3000 linhas de 2000 caracteres. Corpo HTTP de fonte ate 2 MiB. Rejeitar excesso explicitamente, sem truncar cifra.
- Sem cache negativo na primeira versao. Evitar tornar `Tentar novamente` uma repeticao de erro cacheado.
- Base original persistida em uma coluna JSONB aditiva `songs.cifra_original`; registros antigos mantem NULL. `capo_frets` selecionado continua compativel; confirmar ausencia de capo quando desconhecido antes de salvar importacao nova.
- Primeira entrega nao implementa provedor HTTP CifraClub: produz roteiro de experimento, mantendo navegador como caminho conhecido. Nao comprometer entrega com um caminho que ja retornou 403 na investigacao.

## Mapa De Arquivos E Responsabilidades

| Unidade | Arquivos novos/modificados |
| --- | --- |
| Testes/regressoes imediatas | `vitest.config.ts`, `tests/setup.ts`, `tests/fixtures/cifra/`, `tests/cifra/`, `package.json`, `pnpm-lock.yaml`, `components/song-form.tsx` |
| Contrato e musica sem I/O | `lib/cifra/contract.ts`, `lib/cifra/tone.ts`, `lib/cifra/transpose.ts`, `lib/cifra/url.ts`; adaptadores `lib/cifraclub-url.ts`, `lib/cifralize-url.ts`, `lib/cifraclub-scraper.ts` |
| Worker modular | `services/cifraclub-importer/src/{server,config,network-policy,egress-proxy,browser,extract,transpose-wait,jobs,cache,auth,cifralize,contract}.js` |
| Proxy e autorizacao | `lib/cifra/{authorization,service-client,job-owner}.ts`, `app/api/cifra/{ready,jobs}/route.ts`, `app/api/cifra/jobs/[jobId]/route.ts`, rota legada `app/api/cifra/import/route.ts` |
| Coordenacao cliente | `lib/cifra/import-controller.ts`, `components/cifra-import-provider.tsx`, `components/cifra-import-status.tsx`, `app/layout.tsx` |
| Formulario e contexto | `components/song-form.tsx`, `components/header.tsx`, `app/songs/page.tsx`, `lib/cifra/draft.ts` |
| Persistencia autorizada | `scripts/033_song_cifra_original.sql`, `lib/types.ts`, `lib/cifra/save-song.ts`, `app/api/songs/route.ts`, `app/api/songs/[songId]/route.ts` |
| Operacao/aceite | `services/cifraclub-importer/{package.json,package-lock.json,Dockerfile,README.md}`, `sdd/plan/cifraclub-import-validation.md` |

Os caminhos de API novos foram verificados como inexistentes; cria-los explicitamente, sem assumir helpers prontos. Nao reestruturar telas alheias ao fluxo.

## Interfaces Compartilhadas Entre Tarefas

Definidas em T2 para o app; worker espelha contrato JSON, validado por fixtures:

```typescript
type CifraSource = 'cifraclub' | 'cifralize'
type OriginalCifra = {
  contract_version: 2; parser_version: string; source: CifraSource
  cipher_url: string; artist: string; name: string
  original_lines: string[]; original_tone: string | null
  capo_frets: number | null; youtube_url: string | null
  transposition_supported: boolean; warnings: string[]
}
type JobState = 'queued' | 'extracting' | 'validating' | 'ready' | 'failed' | 'cancelled' | 'expired'
type JobView = {
  jobId: string; state: JobState; deadlineAt: number
  result?: OriginalCifra; error?: { code: string; message: string }
}
type ImportScope = { userId: string; churchId: string }
type ImportFailure = { code: string; message: string; retryAfterSec?: number }
```

Tempos sao epoch em milissegundos. HTTP mapeia URL/entrada invalida a 400, autenticacao 401, permissao 403, idempotencia conflitante 409, tarefa perdida 410, validacao musical 422, quota 429, fonte 502, capacidade 503 e timeout 504. Falha terminal de tarefa conhecida retorna `JobView` em 200; erro de acesso ao recurso retorna o status correspondente, sem conteudo privado.

---

### Task 1: Fixar Regressoes Atuais Com Testes Executaveis

**Files:** criar `vitest.config.ts`, `tests/setup.ts`, `tests/cifra/song-form-regression.test.tsx`, `tests/cifra/worker-regression.test.ts`, `services/cifraclub-importer/src/transpose-wait.js`; modificar `package.json`, `pnpm-lock.yaml`, `components/song-form.tsx`, `services/cifraclub-importer/src/server.js`.

**Interfaces:** consumir `SongForm` existente; produzir `pnpm test:cifra` (`vitest run tests/cifra`) e guarda `shouldWaitForCifraChange(initialTone, targetTone): boolean` em `src/transpose-wait.js`, sem iniciar listener ao importar modulo.

- [ ] **1. Escrever testes falhando:** com fetch mockado, `import_without_tone_fetches_once` preenche tom e afirma `expect(importCalls).toHaveLength(1)`; `edit_snapshot_does_not_fetch` abre musica com `cifra_content` e afirma zero fetch de importacao; worker `same_tone_does_not_wait` afirma false para G/G e G#/Ab. Instalar apenas Vitest, jsdom, Testing Library React/jest-dom como devDependencies compativeis com Node local, sem atualizar React/Next.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose`; exigir falhas de comportamento esperado, nao apenas erro de configuracao/dependencia.
- [ ] **3. Implementar minimo:** consultar chave do snapshot ja satisfeito antes do debounce; registrar URL/tom efetivos retornados; esperar mudanca somente quando transposicao realmente alterar DOM. Separar inicializacao do servidor de exports testados sem mudar deploy.
- [ ] **4. Executar GREEN:** `pnpm test:cifra --reporter=verbose`; os tres casos passam e chamadas existentes de Cifralize/PDF mantem comportamento. Registrar baseline `pnpm exec tsc --noEmit` sem enfraquecer verificacoes preexistentes.
- [ ] **5. Revisar diff/checkpoint:** somente arquivos acima; commit sugerido `fix: avoid redundant cifra imports and transpose waits`.

### Task 2: Definir Contrato V2, URL Canonica E Transposicao Pura

**Files:** criar `lib/cifra/{contract,tone,transpose,url}.ts`, `tests/cifra/{contract,url,transpose}.test.ts`, `tests/fixtures/cifra/{original-v2,music-cases}.json`; modificar adaptadores `lib/cifraclub-url.ts`, `lib/cifralize-url.ts`, `lib/cifraclub-scraper.ts`, imports musicais em `components/song-form.tsx`.

**Interfaces:** produzir `OriginalCifraSchema`, `JobViewSchema` e tipos acima; `canonicalizeCifraUrl(input: string): {source: CifraSource; canonicalUrl: string; requestedTone: string | null}`; `transposeOriginal(original: OriginalCifra, targetTone: string, confirmedTone?: string): {lines: string[]; tone: string; capoFrets: number | null}`; preservar exports musicais legados por reexport sem I/O no cliente.

- [ ] **1. Escrever testes falhando:** URL com userinfo/HTTP/porta 444/segmentos inesperados rejeitada; www/barra/rastreamento conhecido deduplicam; versoes diferentes nao; parametros desconhecidos rejeitados em vez de descartados. Testar `#key` conforme semantica comprovada por fixture; fragmento nao entendido gera aviso, nunca troca a versao. Musical: `C/E -> D/F#`, `Bbmaj7 -> Cmaj7`, maior->menor rejeitado, ida/volta sempre deriva base; letra `A paz e real` e Unicode permanecem inalterados, tabs preservados/alinhamento definido por fixture, tablatura numerica impede transposicao. Schemas rejeitam >3000 linhas, linha >2000, numero de capo fora de 0..12 e campos musicais falsos.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose`; asserts exatos dos fixtures falham por helpers ausentes/comportamento incorreto.
- [ ] **3. Implementar interfaces:** mover helpers de tom existentes para modulo sem Cheerio; tokenizar acordes apenas em linhas/trechos reconhecidos, nao substituir palavras por regex global. Sem tom original/confirmado retornar `NO_TONE`; sem suporte retornar `UNSUPPORTED_TRANSPOSE`. Guardar tanto base como linhas selecionadas. Expansao do tamanho de acorde desloca somente espaco disponivel sem consumir texto; fixtures fixam resultado. Definir `parser_version = '2'`.
- [ ] **4. Executar GREEN:** `pnpm test:cifra --reporter=verbose`; validar fixtures v2 e transposicao completa, sem acesso a rede. `pnpm exec tsc --noEmit` nao introduz novas falhas.
- [ ] **5. Revisar diff/checkpoint:** commit sugerido `feat: define original cifra contract and local transposition`.

### Task 3: Extrair Base Original Com Navegador Seguro E Reutilizavel

**Files:** criar worker `src/{config,auth,network-policy,egress-proxy,browser,extract,contract}.js`, `tests/cifra/{worker-extract,network-policy,browser-lifecycle}.test.ts`, fixtures HTML sinteticos; modificar worker `src/server.js`, `package.json`, criar/atualizar seu `package-lock.json`, modificar `Dockerfile`.

**Interfaces:** `createBrowserManager({launch, maxConcurrent: 1}): {withPage<T>(run: (page, signal) => Promise<T>, signal): Promise<T>; close(): Promise<void>}`; `extractOriginal({url, signal, onState}): Promise<OriginalCifra>`; `assertAllowedDestination(url: string, resolvedAddresses: string[]): void`; `createEgressProxy({resolve,connect}): Promise<{url:string;close():Promise<void>}>`. Proxy local CONNECT valida hostname/porta, resolve e conecta a um IP publico validado sem segunda resolucao; Chromium usa somente esse proxy, sem bypass, com destinos nao permitidos bloqueados. Config falha sem token. Assinaturas sao JavaScript com JSDoc; sem transposicao no worker.

- [ ] **1. Escrever testes falhando:** duas extracoes sequenciais usam um launch e dois contextos; cancelamento/timeout/crash fecham contexto e proxima execucao relanca quando necessario; fixtures extraem original sem clicar; tom/capo desconhecido sao null, zero somente se confirmado. 403/challenge nao e 404, `<pre>` generico de erro nao passa. SSRF cobre IPv4/IPv6 privados, IP-mapped IPv6, metadata, redirect externo, DNS com endereco privado e subrequest proibido antes da requisicao. Ausencia de token impede startup antes de listen.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose`; mocks de navegador/rede, sem iniciar Chromium nem usar dominios reais.
- [ ] **3. Implementar modulos:** migrar seletores/extracao existentes sem refazer todo o servidor; usar prazo recebido e resposta principal para status; limitar recursos, request/response e redirects. Fixar allowlist inicial de documentos aos hosts CifraClub; inventariar recursos estritamente necessarios em fixtures, sem wildcard amplo. Validacao DNS deve ser vinculada ao destino de conexao (proxy/dispatcher com lookup validado e pinning), nao apenas preflight suscetivel a rebinding. Para Chromium, implementar proxy de egress validado usado pelo browser e bloquear bypass; se isso nao puder ser garantido no Render, documentar bloqueio de seguranca, nao declarar SSRF resolvido com `page.route` sozinho. Adicionar Zod no package do worker e `npm ci --omit=dev` no Dockerfile com lockfile. Nao colocar dependencia de app no container.
- [ ] **4. Executar GREEN:** `pnpm test:cifra --reporter=verbose`; verificar contrato contra `original-v2.json`. Chromium real local somente em teste aprovado, com fixture local e transporte de teste explicitamente injetado; producao nao permite localhost.
- [ ] **5. Revisar diff/checkpoint:** commit sugerido `feat: reuse isolated browser contexts for validated cifra extraction`.

### Task 4: Tarefas Temporarias, Cache E Provedores No Worker

**Files:** criar worker `src/{jobs,cache,cifralize}.js`, `tests/cifra/{worker-jobs,worker-cache,cifralize-provider}.test.ts`; modificar worker `src/server.js`, `package.json`, `package-lock.json`; ler `lib/cifralize-scraper.ts` como referencia, sem importar TS de fora do container.

**Interfaces:** `createJobManager({extract, now, limits}): {create(input): JobView; read(jobId, ownerRef): JobView; cancel(jobId, ownerRef): JobView; sweep(): void; close(): Promise<void>}`; create input `{jobId, ownerRef, churchRef, canonicalUrl, source}`. `createPublicCache({maxEntries:100,maxBytes:20971520,ttlMs:604800000})`. Worker HTTP: `GET /health` liveness sem navegador; `GET /ready` autenticado `{ready:true,contract_version:2}`; `POST /jobs` 202/200; `GET /jobs/:jobId` renova lease; `DELETE /jobs/:jobId` cancela interesse. Rotas protegidas exigem bearer e dono/ref de igreja encaminhados somente pelo app.

- [ ] **1. Escrever testes falhando com relogio falso:** replay mesma chave/dono/entrada nao debita duas vezes; payload diferente 409; dois donos da mesma URL compartilham uma extracao, mas nunca tarefas privadas; outro dono nao le/cancela; cancelar um mantem outro. Quarta espera distinta alem de uma ativa e tres aguardando retorna 503. Contar falhas/quota, TTL7d/cache100/20MiB, cleanup de 200 tarefas, lease60s, deadline30s inclusive fila, retencao10min e restart retornando 410. Aba sem heartbeat nao perpetua trabalho; retry de POST apos timeout nao duplica. Cifralize 429/500 nao vira 404 e tom ignorado nao vira sucesso em tom solicitado.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose`; todos os cenarios sem rede real.
- [ ] **3. Implementar fila/cache/tarefas:** registros privados independentes ligados a trabalho publico single-flight; TTL de cache nao retem IDs privados; cleanup periodico fechado em shutdown. Aplicar quotas e limites definidos neste plano com buckets limitados/expiraveis. Extrator Cifralize HTTP+Cheerio retorna base original sem `?tom`, usando a politica de rede T3 e limite2MiB; adicionar Cheerio no worker com versao compativel com runtime. Capo ausente e null, nunca zero inferido. Parser v2 de ambas as fontes compartilha fixtures JSON. Nao implementar cache negativo.
- [ ] **4. Executar GREEN:** `pnpm test:cifra --reporter=verbose`; 100 iteracoes simuladas nao deixam trabalhos/leases abertos. Remover `/import` sincrono apenas depois do adaptador T5 estar preparado; ate la mantê-lo protegido e sem novos consumidores.
- [ ] **5. Revisar diff/checkpoint:** commit sugerido `feat: add bounded asynchronous cifra jobs and canonical cache`.

### Task 5: Proxy Curto E Autorizacao Sem Estado Serverless

**Files:** criar `lib/cifra/{authorization,job-owner,service-client}.ts`, `app/api/cifra/ready/route.ts`, `app/api/cifra/jobs/route.ts`, `app/api/cifra/jobs/[jobId]/route.ts`, `tests/cifra/{job-routes,job-owner,legacy-import}.test.ts`; modificar `app/api/cifra/import/route.ts`, `lib/cifraclub-importer-client.ts`.

**Interfaces:** `requireSongImportContext(): Promise<CurrentMinisterContext>` (admin efetivo ou ministro ativo com `hasLeadVoiceRole(instrument)` na propria igreja); `deriveOwner(context): {ownerRef:string;churchRef:string}` e `deriveJobId(ownerRef, requestId): string` conforme HMAC deste plano. `probeImporter(signal): Promise<{ready:boolean}>`, `createImportJob({jobId,ownerRef,churchRef,url,source},signal): Promise<JobView>`, `readImportJob(...)`, `cancelImportJob(...)`.

- [ ] **1. Escrever testes falhando:** 401 anonimo; 403 midia/inativo/nao cantor; admin autorizado incluindo impersonacao validada; instrumento buscado pelo servidor com igreja correta. Mesmo usuario em outra igreja nao acessa job; cliente nao injeta ownerRef/churchRef; instancias Next diferentes derivam a mesma chave com token fake; token/URL do worker nao aparecem na resposta. Timeout de readiness retorna estado retryable sem iniciar job. Criacao perdida e repetida tem mesmo jobId. Cross-origin POST/DELETE rejeitado; payload/query invalidos nao vao ao worker.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose` com auth/Supabase/fetch mockados.
- [ ] **3. Implementar rotas Node:** `POST /api/cifra/ready` faz probe ate5s; `POST /api/cifra/jobs {url,requestId}` cria ate5s; `GET/DELETE /api/cifra/jobs/[jobId]` ate5s. `Cache-Control: private, no-store`, sem segredos/logs do bearer; propagar disconnect e erro tipado, verificar Origin para mutacoes. Responder 202 enquanto iniciando, 503 nao configurado/incompativel, preservar Retry-After. Permissao em todas as rotas antes do worker; checar church ativo. Nenhum timer/trabalho solto no handler Next.
- [ ] **4. Implementar compatibilidade e executar GREEN:** rota GET legada nao tenta aguardar cold start: para URL retorna resposta v2/202 com jobId e instrucao de polling, documentando mudanca; cliente interno antigo adapta temporariamente com prazo curto ou erro claro. `artist+song` resolve URL Cifralize; `q` retorna lista de candidatos com `SELECTION_REQUIRED`, nunca importa primeiro silenciosamente. Novo formulario sera migrado em T9; rollout exige T9, nao publicar apenas esta tarefa. `pnpm test:cifra --reporter=verbose` passa.
- [ ] **5. Revisar diff/checkpoint:** commit sugerido `feat: proxy cifra jobs with tenant-bound authorization`.

### Task 6: Coordenador De Importacao Independente Da Tela

**Files:** criar `lib/cifra/{import-controller,draft}.ts`, `tests/cifra/import-controller.test.ts`.

**Interfaces:** `createImportController({transport, now, timers}): {getSnapshot(): ImportSnapshot; subscribe(listener):()=>void; start(input: ImportDraftInput, scope:ImportScope):Promise<void>; updateDraft(patch):void; cancel():Promise<void>; discard():void; resetScope(scope:ImportScope|null):void; dispose():void}`. `ImportDraftInput` contem campos editaveis, `songId?:string`, URL, tom desejado e base existente; sem File/PDF privado serializado. `ImportSnapshot` inclui fase `idle|starting|queued|extracting|validating|ready|failed|cancelled|expired`, rascunho, requestId e escopo/geracao local.

- [ ] **1. Escrever testes falhando com fake timers:** readiness pendente90s e job pronto depois nao falham em35s; readiness>120s falha uma vez; cada chamada<=5s, total de trabalho30s; polling a cada2s, respeita Retry-After. Replay de criacao usa requestId inicial, resposta tardia ignorada por geracao. Um rascunho por aba exige descarte explicito. Scope change/logout cancela e limpa; mesma rota/mesmo scope nao reinicia. Offline/suspensao>lease expira sem criar job novo; restart410 termina sem loop.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose`; nao usar delays reais.
- [ ] **3. Implementar maquina de estados:** tempo monotônico/deadline separado, probe sob demanda, backoff readiness2s limitado por prazo; distinguir recebimento tardio do aceite e trabalho. Retentar criacao somente com a mesma idempotency key; sem retry automatico para blocked/expired/invalid. Snapshot estavel para `useSyncExternalStore`, abortar timers/fetches em dispose/reset, nunca guardar em storage. Guardar campos alterados pelo usuario sem substitui-los por metadados retornados depois; campos ainda vazios podem ser preenchidos.
- [ ] **4. Executar GREEN:** `pnpm test:cifra --reporter=verbose`; contar chamadas, timers e abort controllers restantes no dispose: zero.
- [ ] **5. Revisar diff/checkpoint:** commit sugerido `feat: coordinate background cifra imports in browser memory`.

### Task 7: Integrar Coordenador Global, Aviso E Retomada

**Files:** criar `components/cifra-import-provider.tsx`, `components/cifra-import-status.tsx`, `tests/cifra/import-provider.test.tsx`; modificar `app/layout.tsx`, `components/header.tsx`, `app/songs/page.tsx`.

**Interfaces:** `CifraImportProvider({children})`; `useCifraImport()` expoe T6 e `requestReview():void`. Indicador usa Link/router para `/songs?reviewImport=1`; pagina consome intencao uma vez, abre formulario com rascunho e limpa parametro por replace sem reimportar.

- [ ] **1. Escrever testes falhando:** provider mantido no layout com duas paginas simuladas conserva job e campos; conclusao anuncia status uma vez, nao abre modal automaticamente; clique retomar abre rascunho sem rede externa nova. Auth event SIGNED_OUT limpa imediatamente; evento de troca de impersonacao/contexto invalida antes de navegar; retorno por foco/rota revalida `/api/context` e falha de contexto bloqueia acesso ao resultado ate validar. Alertas possuem live region e controles acessiveis por teclado.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose`.
- [ ] **3. Implementar integracao:** montar provider no root layout, mas desativar/limpar em rotas auth/publicas/plataforma fora do contexto ativo; usar cliente Supabase para evento de sessao e fetch `/api/context` no foco e mudanca de caminho. Nao remontar provider a cada pathname. Header dispara invalidacao sincrona antes de logout/fim de impersonacao. Indicador informa `Iniciando servico de importacao; voce pode continuar usando o sistema`, sucesso/erro/cancelar/retomar; usar UI wrappers existentes, nao criar nova navegacao global.
- [ ] **4. Executar GREEN:** `pnpm test:cifra --reporter=verbose`; navegar/desmontar formulario nao chama controller.dispose enquanto provider permanece; auth reset e unmount definitivo chamam dispose.
- [ ] **5. Revisar diff/checkpoint:** commit sugerido `feat: keep cifra drafts available across internal navigation`.

### Task 8: Persistir Base Original E Salvar Com Autorizacao Real

**Files:** criar `scripts/033_song_cifra_original.sql`, `lib/cifra/save-song.ts`, `app/api/songs/route.ts`, `app/api/songs/[songId]/route.ts`, `tests/cifra/save-song.test.ts`; modificar `lib/types.ts`.

**Interfaces:** `Song.cifra_original?: OriginalCifra|null`; `SaveImportedSongInput = {title,artist,tone,youtube_url,youtube_video_title,original:OriginalCifra,confirmedOriginalTone?:string,confirmedCapoFrets?:number,ministerId?:string}`. `saveImportedSong(input, context, songId?):Promise<{id:string}>`. `POST /api/songs`, `PATCH /api/songs/[songId]` para importacao textual v2; nao ampliar CRUD geral nem alterar upload PDF nesta tarefa.

- [ ] **1. Escrever testes falhando:** snapshots antigos NULL continuam legiveis; novo snapshot armazena original e linhas transpostas correspondentes; nao confiar em linhas selecionadas/capo/tom inventados pelo cliente. Tom/capo desconhecidos exigem confirmacao. Admin com ministro de outra igreja rejeitado; cantor so edita propria musica. Edicao com registro removido retorna404, dono mudado403, zero linhas afetadas nao e sucesso. Plataforma impersonando deve indicar ministro valido da igreja, nao usar fallback userId como FK.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose` com banco mockado, sem executar migration.
- [ ] **3. Implementar migration/tipo/helper:** JSONB nullable com CHECK objeto/version2, sem backfill nem novo acesso amplo/RLS. Rotas reutilizam auth de T5, validam Zod e escopo antes de escrita, usam cliente admin apenas com filtros explicitos igreja+ID e ownership na propria escrita para evitar race. Na criacao, resolver ministro pelo contexto ou selecionar ministro autorizado na igreja para admin; exigir registro ativo. Servidor calcula transposicao pela base T2 e grava cifra selecionada, tom e proveniencia consistentemente; erros de schema ausente nao descartam silenciosamente campos originais.
- [ ] **4. Executar GREEN:** `pnpm test:cifra --reporter=verbose`; documentar verificacao SQL em banco descartavel aprovado para NULL/objeto invalido/rollback, sem roda-la sem autorizacao. `pnpm exec tsc --noEmit` nao introduz falhas.
- [ ] **5. Revisar diff/checkpoint:** commit sugerido `feat: persist original cifra with tenant-scoped song writes`.

### Task 9: Migrar Formulario Para Rascunho E Tom Local

**Files:** modificar `components/song-form.tsx`, `app/songs/page.tsx`, `lib/cifralize-scraper.ts`, `lib/cifraclub-importer-client.ts`; criar `tests/cifra/song-form-v2.test.tsx`.

**Interfaces:** SongForm consome T6/T7, T2 e escrita T8; preservar props existentes e callbacks de sucesso. Mudanca de tom chama apenas `transposeOriginal`; fluxo PDF continua local existente. Consumidores remanescentes de `ImportedCifra` usam adaptador explicito de v2 com confirmacao, nunca defaults falsos.

- [ ] **1. Escrever testes falhando:** link sem tom inicia uma tarefa; escolher tom nao cria outra; fechar/navegar/reabrir preserva campos alterados e resultado; nova URL pede descarte antes de substituir. Edicao antiga usa base local com tom/capo verificados ou avisa necessidade de confirmacao, nunca reimporta sozinha. YouTube ausente mostra cifra pronta e continua solicitando video antes de salvar conforme regra atual. Importacao desconhecida exige confirmar tom/capo; versao/fonte/avisos visiveis. PDF nao exige worker; salvar v2 envia so para rotas autorizadas, snapshot+base consistentes.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose`.
- [ ] **3. Implementar formulario:** retirar rede e estado de tarefa duplicado do componente; manter debounce para iniciar primeira URL, nao para tom. Separar estado do rascunho do estado do modal; cancelar explicito vs fechar. Incluir selecao de ministro da igreja quando admin impersonando sem ministro local. `onSuccess` atualiza lista e descarta rascunho so apos confirmacao do servidor. Nao perder draft em erro de salvamento. Remover caminho de importacao automatica do primeiro resultado textual e atualizar mensagens incompatíveis; adaptar Cifralize legado para nao rotular tom solicitado como confirmado. Nao mexer no scraper/backfill fora do necessario para consumidores ativos.
- [ ] **4. Executar GREEN:** `pnpm test:cifra --reporter=verbose`; T1 permanece verde ou e substituido por asserts equivalentes v2, nunca eliminado sem cobertura. `pnpm exec tsc --noEmit` compara baseline.
- [ ] **5. Revisar diff/checkpoint:** commit sugerido `feat: review imported cifra drafts and transpose without refetching`.

### Task 10: Validacao Integrada, Operacao Free E Rollout Reversivel

**Files:** criar `tests/cifra/import-flow.test.tsx`, `sdd/plan/cifraclub-import-validation.md`; modificar `services/cifraclub-importer/README.md`, `AGENTS.md` apenas para novos comandos/padroes reais; verificar `render.yaml`, `public/sw.js` e `Dockerfile` sem alterar custos ou caching autenticado.

**Interfaces:** testes integrados usam transporte local de worker real com extrator fake e contexto autenticado fake. Roteiro externo e registro de medicao nao executam fontes reais automaticamente.

- [ ] **1. Escrever teste integrado falhando:** readiness90s simulados -> POST aceito com primeira resposta perdida -> retry mesmo jobId -> troca de tela -> ready -> retomar -> tom local -> save; afirmar uma extracao, zero escrita antes de confirmar, zero dado de outra igreja e nenhuma chamada externa adicional por tom. Segundo caso reinicia worker entre polling/coleta:410, rascunho anterior preservado, nova tentativa somente explicita. Verificar cache HTTP no-store e API fora do service worker.
- [ ] **2. Executar RED:** `pnpm test:cifra --reporter=verbose`; sem servicos externos/segredos.
- [ ] **3. Completar operacao/documentacao:** configuracoes e valores deste plano, liveness vs readiness, rotina de cleanup/shutdown, logs por requestId com etapas reais, p50/p95 e erro por fonte/cache, sem IDs pessoais nem cifra completa. Feature switch app `CIFRA_IMPORT_V2_ENABLED` servidor exposto via contexto apenas como booleano; worker aceita v1 durante rollout e declara versao. Deploy worker compativel -> migration autorizada -> app v2 -> habilitar por ambiente aprovado. Voltar switch nao apaga base/snapshot; modo legado avisa limitacoes e nao promete background. Build Docker usa lockfile e plano Render continua free. Documentar limitacao de memoria512MB e tarefa perdida em reinicio.
- [ ] **4. Executar verificacoes locais:** `pnpm test:cifra --reporter=verbose`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`, `git diff --check`; relatar falhas preexistentes/ausencia de ESLint, nao instalar/configurar lint fora do escopo. Build pode exigir configuracao e fontes remotas: se bloqueado, registrar, sem ler .env. Docker build/test com fixture somente quando ambiente permitir e autorizado, sem chamar producao.
- [ ] **5. Produzir roteiro de homologacao e revisar:** 30 URLs autorizadas com resultados musicais conferidos; lotes1/3/5; medir cold start separado, warm miss p95<=8s, cache hit p95<=1s, transposicao local p95<=200ms, sucesso geral>=95% sem excluir bloqueios. Caso metas nao cumpridas no Free, registrar evidencias e limites sem upgrade automatico. Incluir experimento HTTP opcional explicitamente nao executado/desabilitado, criterios para futura ativacao e revisao de termos/direitos. Commit sugerido `test: validate free-tier background cifra import lifecycle`.

## Ordem, Dependencias E Cobertura Da SPEC

- T1 pode ser validada isoladamente; T2 fixa interfaces musicais antes de worker/formulario.
- T3 -> T4 -> T5 fixam execucao e protecao; T6 usa esses contratos, T7 integra navegacao.
- T8 depende de T2/T5; T9 depende de T2/T6/T7/T8. T10 valida o fluxo completo antes de habilitar.
- RF00: T4-T7/T9/T10. RF01: T1/T6/T9. RF02: T2-T4/T9. RF03: T2/T8/T9. RF04: T3/T4/T5/T10.
- Persistencia: T8/T9. Cache/carga: T4. Deadline: T4-T6. Seguranca: T2-T5/T8. UX: T6/T7/T9. Metricas/aceite: T10 com fixtures especificas nas demais tarefas.
- HTTP direto, cache distribuido, sobrevivencia a reload e compra de VM ficam fora da implementacao; nao sao pendencias escondidas para declarar sucesso.

## Evidencias E Encerramento

Durante execucao, marcar checkboxes apenas depois de registrar comando/resultado. Acrescentar ao roteiro de validacao baseline e evidencias; nao simular sucesso sem amostra externa autorizada.

Antes de considerar entrega pronta: revisao final do diff, testes de isolamento, revisao independente do conjunto, relatorio de validacoes realmente executadas e passos operacionais pendentes. Sem deploy, migration aplicada ou upgrade implicitos.

## Auto-Revisao Do Plano

- Cobertura da SPEC: mapeada acima; cold start e acompanhamento possuem tarefas explicitas, nao dependem de timeout longo serverless.
- Interfaces: contrato v2 e os mesmos nomes/valores usados entre T2/T4/T5/T6/T8/T9; dois runtimes confrontam fixtures comuns, sem imports fora do container.
- Riscos de revisao: os cinco cenarios de Review Focus possuem testes nas tarefas indicadas.
- Escopo: dez entregas com ciclo RED/GREEN, sem commits de usuario, instalacao, migration ou codigo funcional executados durante a elaboracao do plano.
- Proxima acao: usuario revisa este plano e escolhe execucao nativa ou por subagentes; so depois iniciar implementacao.

### Assercoes Ancora Para O Ciclo RED/GREEN

Os cenarios detalhados de cada tarefa sao obrigatorios; estas assercoes fixam os resultados centrais e devem constar nos testes, com doubles definidos na propria suite:

```typescript
// T1: import_without_tone_fetches_once
expect(importCalls).toHaveLength(1)
// T2: slash_chord_transposes_from_original
expect(transposeOriginal(originalCOverE, 'D').lines).toEqual(['D/F#'])
// T3: sequential_jobs_reuse_browser_not_context
expect(launch).toHaveBeenCalledTimes(1)
expect(newContext).toHaveBeenCalledTimes(2)
// T4: replay_and_shared_extraction_do_not_duplicate
expect(replay.jobId).toBe(first.jobId)
expect(extract).toHaveBeenCalledTimes(1)
// T5: foreign_church_cannot_read_job
expect(foreignChurchResponse.status).toBe(403)
// T6: cold_start_90_seconds_is_not_timeout
expect(snapshotAt90Seconds.phase).not.toBe('failed')
// T7: internal_navigation_preserves_draft
expect(controller.getSnapshot().draft.title).toBe('Titulo revisado')
// T8: no_rows_updated_is_not_success
expect(deletedSongResponse.status).toBe(404)
// T9: transpose_does_not_refetch
expect(jobCreateCallsAfterToneChange).toHaveLength(1)
// T10: no_song_write_before_confirmation
expect(saveBeforeUserConfirmation).not.toHaveBeenCalled()
```
