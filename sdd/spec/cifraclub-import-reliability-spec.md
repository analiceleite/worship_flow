# SPEC: Importacao De Cifras Por Link — Rapidez E Confiabilidade

## Status E Relacao Com A SPEC Anterior

- Status: desenho aprovado pelo usuario nesta conversa; implementacao ainda nao iniciada.
- Data: 2026-10-18.
- Evolui `sdd/spec/cifraclub-importer-spec.md`, preservada como historico.
- Para esta evolucao, substitui as recomendacoes anteriores de sempre abrir o navegador e de incluir o tom solicitado na chave da extracao externa.
- Nao autoriza execucao de migrations, chamadas ao ambiente de producao, backfills ou deploy.

## Contexto E Problema

O usuario precisa cadastrar uma musica colando somente seu link do CifraClub. O fluxo atual ja integra um microservico Playwright, mas a experiencia e lenta e pouco confiavel.

A inspecao do codigo identificou:

| Evidencia | Referencia |
| --- | --- |
| Chromium iniciado e encerrado em cada importacao sem cache | `services/cifraclub-importer/src/server.js`, `importCifra` |
| Possivel segunda importacao apos preenchimento automatico do tom | `components/song-form.tsx`, `importFromUrl` e efeito de autoimportacao |
| Edicao pode reconsultar a fonte apesar de existir snapshot salvo | `components/song-form.tsx`, inicializacao e efeito de autoimportacao |
| Espera por mudanca da cifra mesmo quando o tom ja e o solicitado | `services/cifraclub-importer/src/server.js`, `extractFromPage` e `waitForCifraTextChange` |
| Timeout de 35 segundos no cliente sem deadline coordenado com o worker | `lib/cifraclub-importer-client.ts` |
| Cache em memoria e ausencia de deduplicacao de trabalhos em andamento | `services/cifraclub-importer/src/server.js`, `handleImport` |

Esses achados nao comprovam a causa dominante da latencia no deploy. Cold start, bloqueios da fonte e capacidade da instancia precisam de medicao.

### O Que Foi Observado No Cifralize

O JavaScript publico observado em `https://cifralize.com.br/assets/search_modal-e9c2d425.js` separa catalogo local, busca externa, preview e importacao pelo backend, com cache de previews no navegador. A tela de importacao redireciona para login.

Isso nao revela a implementacao de extracao no servidor. Nao ha evidencia suficiente para afirmar que utilizam HTTP direto, Playwright ou API contratada. O asset pode mudar.

Uma requisicao HTTP simples a uma pagina publica do CifraClub retornou 403 no ambiente da investigacao. Isso nao demonstra inviabilidade em toda hospedagem, mas impede assumir que um scraper HTTP resolvera o problema sozinho.

## Objetivo

Permitir colar um link, obter uma cifra validada com preview, ajustar o tom sem nova consulta externa e salvar um snapshot que continue utilizavel sem acesso a fonte.

Prioridades:

1. Correcao da musica, versao, acordes, tom e capo.
2. Eliminar consultas externas redundantes.
3. Reduzir latencia e manter recursos limitados sob concorrencia.
4. Falhar com prazo previsivel e orientacao clara.
5. Preservar autorizacao, isolamento entre igrejas e seguranca de rede.

## Decisoes Da Revisao Com O Usuario

- A hospedagem atual do importador e o Render Free. Nao ha orcamento adicional nesta entrega.
- Uma VM propria e uma possibilidade futura, nao um requisito nem uma compra autorizada.
- O usuario aceita maior espera na primeira importacao enquanto o servico inicia, desde que haja comunicacao clara e nenhum timeout prematuro.
- A importacao deve continuar durante trocas internas de tela na mesma aba do app.
- Nao e necessario recuperar a importacao depois de fechar/recarregar o navegador ou abrir outra aba.

### Recomendacoes Tecnicas Aprovadas Com O Desenho

As escolhas abaixo foram propostas pelo projeto e aprovadas com o documento completo; nao eram requisitos inicialmente declarados pelo usuario:

- Manter resultado como rascunho em memoria para revisao; nao cadastrar musica automaticamente.
- Separar despertar do servico, extracao e acompanhamento da tarefa, usando requisicoes curtas em vez de uma unica chamada longa ao Next.js.
- Iniciar com uma extracao ativa por instancia e no maximo tres trabalhos distintos aguardando, com limites configuraveis.
- Esperar ate 120 segundos pelo despertar e ate 30 segundos pelo trabalho aceito, incluindo fila e extracao. Sao valores iniciais configuraveis, nao garantias do Render.
- Usar tarefas/resultados temporarios em memoria no microservico, sem banco/fila paga. Reinicio do worker pode perder o trabalho: comunicar a falha e oferecer nova tentativa explicita.
- Manter o desenho e o plano em `sdd/spec/` e `sdd/plan/`, seguindo a organizacao existente do repositorio.

## Nao Objetivos

- Garantir disponibilidade de uma fonte externa em 100% das tentativas.
- Usar endpoints internos do Cifralize como API do Worship Flow sem acordo de integracao.
- Contornar CAPTCHA, autenticacao, protecoes de acesso ou limites da fonte.
- Substituir silenciosamente a versao solicitada por outro arranjo ou pelo primeiro resultado de busca.
- Executar navegador no runtime principal do Next.js.
- Reimportar o acervo, alterar automaticamente musicas existentes ou implementar processamento em massa.
- Criar fila distribuida, Redis ou nova infraestrutura antes de demonstrar sua necessidade.
- Contratar hospedagem/servicos pagos, executar pings periodicos para impedir suspensao ou prometer a mesma latencia de uma instancia sempre ativa.
- Recuperar tarefas apos reload, fechamento do navegador, reinicio do worker ou em outra aba/dispositivo.
- Implementar OCR, importacao por foto ou um novo editor manual nesta entrega. Preservar o fallback PDF existente.

## Fluxo Alvo

```txt
Colar link
  -> autenticar, autorizar e resolver igreja efetiva
  -> validar e normalizar URL, preservando a versao musical
  -> reutilizar snapshot correspondente ou consultar cache de extracao
  -> se necessario, iniciar servico e acompanhar tarefa fora do formulario
  -> agrupar pedidos identicos ainda em andamento
  -> extrair cifra original e metadados pelo provedor habilitado
  -> validar resposta, identidade, cifra, tom e capo
  -> mostrar preview
  -> transpor localmente, se solicitado
  -> salvar apenas apos confirmacao, na igreja efetiva
```

Consultar cache nao dispensa autenticacao, autorizacao ou limites de uso.

### RF00 — Segundo Plano Durante Navegacao Interna

- O estado da importacao deve viver acima das paginas/formularios, em um coordenador cliente persistente durante a navegacao interna da area autenticada.
- Oferecer indicador global com estado, cancelamento e acao para retornar a revisao. A conclusao deve gerar aviso sem abrir formulario nem sobrescrever a tela atual automaticamente.
- Na primeira versao, cada aba mantem no maximo uma importacao/rascunho pendente de revisao. Uma segunda URL exige cancelar/descartar a anterior explicitamente; nao perder resultado silenciosamente.
- Desmontar o formulario ou mudar de rota nao cancela a tarefa. Alterar explicitamente a URL da tarefa ou clicar em cancelar encerra o interesse do solicitante anterior.
- Ao concluir, preservar resultado e campos ja preenchidos do rascunho ate salvar, descartar ou terminar a sessao. Retornar ao formulario nao dispara nova extracao.
- Logout, mudanca de usuario ou mudanca da igreja efetiva/impersonacao cancela acompanhamento e limpa tarefas/resultados locais; respostas tardias do contexto anterior sao ignoradas.
- Nao persistir rascunho privado em cache publico, localStorage ou sessionStorage nesta entrega.
- Reload, fechamento e navegacao fora da area que hospeda o coordenador podem interromper o acompanhamento; nao prometer continuidade nesses casos.

### Modelo De Execucao Recomendado

- O navegador conversa somente com rotas autenticadas do Next.js; token interno e endereco privado do importador nao sao expostos ao cliente.
- O coordenador solicita o despertar apenas quando ha importacao demandada. Probes de prontidao sao leves, com espera entre tentativas, cancelamento e prazo total; nao usar o endpoint de extracao como health check.
- Cada requisicao Next.js tem prazo curto compativel com a hospedagem principal. Nao manter um handler aberto durante todo o cold start.
- Com o servico pronto, o app solicita uma tarefa identificada e consulta seu estado por requisicoes curtas. Nao iniciar trabalho solto apos retornar de um handler serverless.
- O worker aceita tarefa, executa em seu proprio processo, deduplica a base publica e disponibiliza estado/resultado temporario. Cache de cifra publica e tarefa privada do solicitante sao estruturas separadas.
- Criacao deve ser idempotente: se a resposta de aceite se perder, repetir com a mesma chave nao cria outra extracao. Polling nao recria tarefas.
- Estado, resultado e cancelamento exigem autorizacao por solicitante e igreja efetiva em cada rota. ID aleatorio sozinho nao e autorizacao; o plano deve definir vinculo verificavel pelo servidor, sem depender de memoria local de uma unica instancia Next.js.
- Apos conclusao/falha, reter tarefa por ate 10 minutos para coleta; o rascunho coletado continua no cliente ate revisao. Limitar armazenamento/quantidade de tarefas e aplicar limpeza tambem a canceladas/expiradas.
- Estados observaveis: iniciando servico, aguardando capacidade, extraindo, validando, pronta, falha, cancelada e expirada. Progresso detalhado so deve ser exibido se o worker o reportar realmente.
- Consultas de status bem-sucedidas confirmam interesse por lease curta e renovavel (inicialmente 60 segundos). Sem renovacao, expirar o interesse e cancelar trabalho sem outros interessados; isso limita tarefas orfas apos fechar a aba. Lease nao renova o deadline absoluto de extracao.
- Em reinicio/eviccao do worker ou perda de tarefa, sinalizar expiracao/indisponibilidade. Nao reiniciar automaticamente em loop nem declarar que o resultado foi salvo.

## Requisitos Funcionais

### RF01 — Importacao Unica E Estado Do Formulario

- Colar um link valido inicia no maximo um trabalho de extracao para aquela URL/versao enquanto ele estiver em andamento.
- Preencher automaticamente tom, titulo ou URL canonica nao inicia outra extracao.
- Abrir edicao com snapshot correspondente nao consulta a fonte. Atualizacao externa exige acao explicita.
- Alterar explicitamente a URL da tarefa cancela a espera anterior e impede que a resposta antiga sobrescreva o formulario, mesmo se o cancelamento chegar tarde; navegar entre telas nao equivale a cancelar.
- Alterar apenas o tom utiliza o conteudo original ja importado.
- Uma importacao com erro nao apaga o snapshot anterior nem deixa o formulario permanentemente bloqueado.
- Ausencia de YouTube nao invalida a extracao da cifra. A selecao do video permanece independente e as validacoes de salvamento devem comunicar claramente qualquer exigencia existente.

### RF02 — Extracao E Validacao

- Importar a cifra original uma vez, sem clicar nos controles de transposicao da pagina.
- Preservar titulo, artista, URL da versao, linhas, espacos significativos, tom original e capo quando identificados.
- Distinguir capo confirmado como zero de capo nao identificado; ausencia nao deve se converter em informacao inventada.
- Nao usar `C` como tom padrao quando a extracao nao identifica o tom.
- Tom desconhecido exige confirmacao explicita antes da transposicao/salvamento que dependa dele; nao produzir sucesso musical ficticio.
- Validar status HTTP, identidade da pagina e estrutura musical. Um `<pre>` nao vazio, sozinho, nao comprova uma cifra valida.
- Paginas de erro, desafio, tablaturas sem suporte ou conteudo inconsistente nao devem entrar no cache como sucesso.
- Validar respostas em runtime com Zod, incluindo tamanho maximo do payload e quantidade/comprimento de linhas, com limites documentados e testados na implementacao.
- Conteudo importado deve ser tratado como texto nao confiavel. Nao renderizar HTML externo sem sanitizacao.

### RF03 — Transposicao Local

- Manter uma base imutavel: cifra original, tom original e capo original conhecido.
- Cada mudanca deriva dessa base, nunca da ultima cifra transposta, evitando deriva acumulada.
- Transpor acordes e baixos invertidos, preservando qualificadores, letras, secoes e alinhamento conforme os casos suportados.
- Definir e testar equivalencias enarmonicas e preferencia de exibicao entre sustenidos e bemois.
- Nao transformar maior em menor apenas porque a fundamental coincide.
- Preservar o capo por padrao: o tom exibido deve representar o tom dos acordes conforme o contrato adotado. Se a fonte usar outro significado, exigir reconciliacao explicita; nao recalcular capo ou tom de concerto implicitamente.
- Tablaturas numericas nao devem ser transpostas como se fossem acordes. Quando presentes e nao suportadas, avisar e impedir uma transposicao parcial apresentada como completa.
- Musicas antigas sem base original continuam sendo exibidas sem reimportacao. Uma transposicao deve usar uma base local verificavel com tom conhecido ou solicitar confirmacao/importacao explicita.

### RF04 — Provedores E Caminho De Extracao

- Manter o microservico como fronteira da extracao CifraClub.
- Navegador otimizado e o caminho inicial conhecido; HTTP direto e uma possibilidade experimental, nao uma dependencia da primeira melhoria.
- Habilitar HTTP como caminho preferencial somente apos validar sucesso, correcao e latencia no ambiente real de hospedagem com a amostra definida nesta SPEC.
- Se habilitado, HTTP deve ter orcamento curto e fallback para navegador apenas em falhas recuperaveis e permitidas, dentro do deadline total.
- Nao adicionar uma tentativa HTTP sabidamente bloqueada antes de toda importacao. Bloqueios recorrentes suspendem esse caminho por intervalo configuravel.
- CAPTCHA/bloqueio explicito encerra a tentativa com erro claro; nao iniciar ciclos de evasao ou retries cegos.
- Manter importacao por link Cifralize existente, com a mesma validacao de tom e conteudo.
- Alternativa Cifralize deve ser escolhida pelo usuario com confirmacao de musica/versao e atribuicao correta da fonte.

## Contrato E Persistencia

- Preservar a compatibilidade dos campos existentes de `ImportedCifra` durante a transicao.
- Separar extracao original de apresentacao/transposicao. `target_tone` existente deve ser atendido localmente ou pelo adaptador de compatibilidade, sem exigir outra navegacao.
- Acrescentar, de forma versionada, os dados necessarios: versao do contrato/parser, URL canonica da versao, fonte real, cifra/tom originais, estado de identificacao do capo e avisos de validacao.
- Enquanto o cliente legado exigir tom/capo nao nulos, nao enviar valores inventados: exigir confirmacao ou retornar erro tipado. A migracao de contrato deve definir esse comportamento explicitamente.
- Campos de diagnostico como provedor, cache e duracoes devem atravessar a integracao sem conter segredos.
- Continuar salvando o snapshot selecionado em `songs.cifra_content`, o tom correspondente em `songs.tone` e a referencia da fonte em `songs.cipher_url`.
- Definir em migration dedicada, se necessario, armazenamento da base original e proveniencia para novas importacoes. Nao sobrescrever snapshots existentes com o conteudo original automaticamente.
- A extracao/preview nao deve criar ou atualizar uma musica. A persistencia exige confirmacao e autorizacao propria.
- Salvamento deve validar relacionamentos e igreja no servidor/RLS equivalente; confirmar que updates afetaram o registro esperado, inclusive em impersonacao.
- Reabrir uma musica salva deve permitir transposicao suportada sem nova dependencia externa quando sua base original estiver disponivel.

## Cache E Controle De Carga

- Chave de extracao: fonte + identidade canonica da musica/versao + versao do parser. Tom de destino nao faz parte da chave da base original.
- Remover apenas parametros de rastreamento conhecidos. Preservar parametros/caminhos que definam versao ou arranjo; fragmentos de tom devem ser interpretados como preferencia de apresentacao, nao apagados sem tratamento.
- Agrupar trabalhos em andamento por chave (single-flight). Cada solicitante mantem autorizacao, resposta e cancelamento independentes.
- Cancelar um solicitante nao interrompe o trabalho necessario aos demais; cancelar o worker quando nao houver interessados ou o deadline do trabalho expirar.
- Cache limitado por quantidade/tamanho, com expiracao, descarte e versao do parser. TTL inicial proposto: 7 dias para sucesso, ajustavel por medicao e condicoes da fonte.
- Nao cachear bloqueios, timeouts ou erros de parser como cifra valida. Cache negativo, quando usado para falhas deterministicas, deve ter TTL curto e nao tornar a acao de tentar novamente enganosa.
- Iniciar com cache local limitado. Adotar persistencia compartilhada apenas se reinicios/multiplas replicas reduzirem comprovadamente sua eficacia.
- Somente conteudo publico da fonte pode ser compartilhado no cache tecnico. Nunca incluir edicoes privadas, IDs de igreja/usuario, PDFs privados ou dados de repertorio nesse payload.
- Limitar tentativas, inclusive falhas, por usuario/igreja no app, e limitar consumo agregado do servico. Nao depender apenas do IP compartilhado do proxy.

## Navegador E Deadline

- Reutilizar Chromium com um contexto isolado por trabalho; nao compartilhar cookies ou estado entre contextos.
- Limitar concorrencia e tamanho da espera; excesso deve retornar erro recuperavel, nao criar navegadores ilimitados.
- Bloquear recursos dispensaveis apos verificar que isso nao impede extracao correta.
- Fechar contexto em sucesso, erro, cancelamento e timeout; reciclar processo por falha ou limites de recursos.
- Propagar deadline absoluto/orcamento restante entre app e servico. O timeout externo deve incluir margem para resposta e limpeza, sem permitir trabalho orfao indefinido.
- Separar o prazo de despertar (inicialmente 120 segundos) do deadline do trabalho apos aceite (inicialmente 30 segundos, incluindo fila, navegacao e extracao). Retornar erro claro ao atingir qualquer limite, sem espera infinita.
- O prazo de despertar pertence ao coordenador, nao a uma chamada HTTP longa. Cada tentativa de prontidao e curta; uma falha nessa tentativa nao e tratada como falha musical nem inicia outra extracao.
- Esperas por capacidade contam no deadline do trabalho. Capacidade esgotada deve retornar erro com orientacao de espera em vez de exceder a fila limitada.
- Retry de rede, se necessario, no maximo uma vez para erro transitorio elegivel, com jitter e dentro do mesmo orcamento. Nao repetir URL invalida, 404 confirmado, CAPTCHA ou erro deterministico de validacao.

## Seguranca E Isolamento

- Resolver contexto por `getCurrentMinisterContext()` e exigir a permissao funcional de gestao de musicas; um login isolado nao basta.
- Usar a igreja efetiva durante impersonacao autorizada. Nao aceitar `church_id` do cliente como autorizacao nem assumir que `ministerId` pertence a igreja impersonada.
- Cliente administrativo exige escopo manual da igreja em toda operacao tenant-scoped.
- Microservico deve recusar inicializacao sem token interno configurado e rejeitar chamadas nao autorizadas antes de abrir navegador.
- Aceitar apenas HTTPS, hosts explicitamente permitidos, porta padrao e URLs sem credenciais embutidas.
- Proteger contra SSRF antes de acessar a rede: validar destinos/redirects, bloquear IPs privados, loopback, link-local e metadata; restringir egress e tratar resolucao DNS de forma segura.
- No navegador, aplicar politica tambem a subrequests e navegacoes, com allowlist minima de recursos publicos necessarios. Validar somente o host final e insuficiente.
- Limitar redirects, payloads e tempo de leitura. Nao registrar tokens, cookies ou URLs com parametros sensiveis.
- Revisar condicoes de uso e direitos de armazenamento/exibicao da fonte antes de ampliar a operacao. Manter atribuicao e link original.

## Erros E UX

Mapear erros estaveis para mensagens acionaveis, preservando compatibilidade com codigos existentes quando necessario:

| Categoria | Comportamento esperado |
| --- | --- |
| URL invalida/nao suportada | Explicar formato aceito, sem chamada externa |
| Nao autenticado/sem permissao | Solicitar acesso adequado, sem abrir worker |
| Musica nao encontrada | Informar ausencia confirmada; nao confundir 403/429/5xx com 404 |
| Bloqueio da fonte | Explicar indisponibilidade automatica e oferecer PDF/tentativa posterior |
| Limite de uso/capacidade | Informar espera e `Retry-After` quando disponivel |
| Timeout/falha transitoria | Permitir nova tentativa sem apagar campos validos |
| Cifra/tom inconsistente | Solicitar confirmacao ou impedir importacao incorreta |

- Mostrar estados reais, incluindo `Iniciando servico de importacao; voce pode continuar usando o sistema` durante cold start; nao simular porcentagem de progresso.
- Oferecer cancelamento e tentativa explicita de atualizacao sem consultas automaticas repetidas.
- Preview deve indicar fonte, versao quando disponivel, tom, capo conhecido/desconhecido e avisos relevantes.
- Preservar PDF e selecao explicita de outro link como alternativas. Nao prometer foto/OCR ou editor ainda inexistentes.

## Metricas E Metas Propostas

Registrar request ID e tempos de fila, inicializacao, navegacao/HTTP, extracao, validacao, transposicao e total. Correlacionar app/worker sem registrar dados pessoais ou conteudo integral.

Medir por provedor, cache hit/miss e resultado: p50/p95, taxa de sucesso, codigos de falha, consultas externas por acao, uso de memoria e trabalhos ativos.

Metas iniciais para homologacao, nao garantias atuais:

| Cenario | Meta |
| --- | --- |
| Snapshot salvo ao abrir edicao | Zero consultas externas |
| Mudanca de tom suportada apos importacao | Zero consultas externas; p95 de processamento local <= 200 ms |
| Importacao com cache quente | p95 ponta a ponta <= 1 segundo no ambiente de teste definido |
| Importacao sem cache, servico aquecido | p95 ponta a ponta <= 8 segundos |
| Primeira importacao apos suspensao | Despertar separado, acompanhado ate 120 segundos; sem promessa de resposta em 8 segundos |
| Troca interna de tela durante importacao | Trabalho continua e resultado pode ser retomado sem reimportacao |
| Falha/indisponibilidade | Encerrar dentro do deadline e informar motivo |
| Requisicoes concorrentes identicas | No maximo um trabalho externo por chave, por instancia |

Avaliar pelo menos 30 URLs representativas, com resultados esperados conferidos manualmente, incluindo versoes alternativas, capo, sustenidos/bemois, baixos invertidos e tablaturas. Registrar tambem falhas externas reais; nao excluir bloqueios da taxa de sucesso geral.

Meta proposta de sucesso geral >= 95% nessa amostra, sem aceitar cifras musicalmente incorretas como sucesso. Reportar separadamente cold starts e, em teste controlado, lotes de 1, 3 e 5 solicitacoes concorrentes, incluindo URLs repetidas e distintas. Se as metas nao forem atingidas, registrar a causa e decidir infraestrutura/estrategia antes de prometer desempenho ao usuario.

## Testes E Criterios De Aceite

Como o projeto ainda nao possui suite configurada, a implementacao deve prever uma etapa explicita de testes automatizados focados, com ferramenta definida no plano tecnico e escopo minimo. Testes de parser/transposicao devem usar fixtures locais permitidas, sem depender da disponibilidade externa.

- [ ] Colar URL e preencher tom automaticamente gera uma unica extracao.
- [ ] Navegar internamente e desmontar o formulario nao interrompe importacao nem perde rascunho; conclusao permite retornar para revisao sem salvamento automatico.
- [ ] Cold start simulado de 60-90 segundos nao causa falha prematura; despertar acima de 120 segundos encerra com erro claro. Esses testes nao dependem da disponibilidade real do Render.
- [ ] Perda da resposta de criacao, polling repetido e navegacao nao duplicam trabalho; polling usa rotas curtas, sem handler serverless abandonado.
- [ ] Logout/troca de igreja limpa resultado; consultar/cancelar tarefa de outro usuario ou igreja e rejeitado.
- [ ] Reinicio do worker, vencimento de lease e expiracao de tarefa sao tratados sem loops e sem vazamento de memoria.
- [ ] Editar registro com snapshot valido nao acessa a fonte.
- [ ] Resposta atrasada nao substitui dados de outra URL; cancelar libera recursos sem prejudicar outros interessados.
- [ ] Mudancas repetidas de tom usam a base original e nao acumulam alteracoes.
- [ ] Fixtures cobrem baixos invertidos, acidentes, acordes estendidos, secoes, alinhamento, maior/menor, capo e tablaturas nao suportadas.
- [ ] Falta de tom/capo nao e silenciosamente convertida em `C`/zero confirmado.
- [ ] URL canonica preserva versoes diferentes e deduplica apenas variantes equivalentes.
- [ ] Payload invalido, pagina de bloqueio e conteudo nao musical nao viram sucesso/cache valido.
- [ ] Cache respeita TTL, limites, versao do parser e separacao entre conteudo publico e privado.
- [ ] Pedidos identicos compartilham trabalho; requests distintos respeitam capacidade e deadline.
- [ ] Worker fecha contextos e se recupera de crash sem vazamento continuado de recursos.
- [ ] 403, 429, 404, timeout e 5xx possuem tratamento distinto e testado.
- [ ] Token ausente/invalido, redirects externos, portas indevidas e destinos privados sao rejeitados.
- [ ] Usuario sem permissao nao importa; leitura/salvamento entre duas igrejas nao atravessam o tenant, inclusive por IDs relacionados e impersonacao.
- [ ] Cifralize e PDF existentes continuam funcionando; alternativas nunca substituem a fonte silenciosamente.
- [ ] Snapshot salvo permanece utilizavel sem nova consulta externa.
- [ ] Metricas, amostra e resultados de homologacao ficam registrados antes do rollout.

## Entregas Incrementais

### Fase 1 — Correcoes Imediatas E Linha De Base

- Corrigir importacao duplicada, reimportacao na edicao e espera desnecessaria quando o tom nao mudou.
- Acrescentar correlacao/tempos e classificacao de erros.
- Endurecer autenticacao do servico, validacao de URL e limites essenciais antes de ampliar uso.
- Medir o comportamento atual em ambiente aprovado, sem alterar musicas existentes.

### Fase 2 — Acompanhamento Independente Do Formulario

- Implementar coordenador global, rascunho em memoria e aviso/retomada durante navegacao interna.
- Implementar despertar sob demanda, tarefas idempotentes no worker, status/cancelamento autenticados e limites temporais.
- Testar cold start simulado, perda de resposta, troca de rota/contexto e reinicio do worker sem adicionar infraestrutura paga.

### Fase 3 — Base Original E Transposicao Local

- Definir contrato versionado, compatibilidade e eventual migration aditiva.
- Implementar base original imutavel, preview e transposicao com testes.
- Remover navegacao por troca de tom e estabelecer cancelamento/deadline ponta a ponta.

### Fase 4 — Recursos, Cache E Concorrencia

- Reutilizar navegador, isolar contextos e limitar trabalhos.
- Implementar canonicalizacao, cache limitado e single-flight.
- Executar testes de carga pequenos e comparar metas com a linha de base.

### Fase 5 — Experimento HTTP E Rollout

- Avaliar HTTP direto com as mesmas fixtures/URLs e ambiente de hospedagem, respeitando acesso permitido.
- Habilitar por configuracao somente se trouxer ganho comprovado sem piorar correcao ou sucesso.
- Registrar eventual beneficio de instancia sempre ativa ou cache compartilhado como recomendacao futura; esta entrega deve permanecer sem custo adicional.
- Fazer rollout gradual com configuracao reversivel. Desabilitar caminho experimental sem apagar snapshots ou alterar cifras salvas.

## Riscos E Decisoes Pendentes

- HTML e mecanismos de bloqueio podem mudar; manter fixtures, versao do parser e alternativa PDF.
- Render Free pode continuar lento ou indisponivel mesmo com espera maior. Cold start tem meta separada e falha finita; nao ha autorizacao para upgrade pago.
- Tarefas em memoria nao sobrevivem a reinicio. Essa limitacao sera comunicada e nao impede a continuidade apenas entre rotas na mesma aba quando o worker permanece ativo.
- A semantica de tom/capo precisa ser validada em exemplos reais antes da transposicao local.
- Escolha do armazenamento da base original e do harness de testes deve constar no plano de implementacao, nao ser improvisada durante a entrega.
- Nenhuma etapa depende de conhecer ou reproduzir o backend privado do Cifralize.
