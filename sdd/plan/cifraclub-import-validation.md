# Roteiro de Validação — Importacao de Cifras Confiavel

## Objetivo
Validar que a importacao por link do CifraClub funciona no Render Free, com despertar separado, acompanhamento durante navegacao interna, transposicao local e salvamento autorizado, sem custo adicional.

## Ambiente
- Worship Flow: branch da implementacao, sem deploy em producao.
- Microservico: Render Free (512 MB), sem ping periodico, sem keep-alive.
- Testes: fixtures locais autorizadas, sem credenciais, sem dados reais de igreja.

## Cenarios de Homologacao

### Cold start (despertar)
- Servico suspenso por inatividade; primeira importacao apos pausa.
- Medir tempo ate `/ready` retornar `true` (meta: ate 120 segundos).
- Aplicacao deve mostrar `Iniciando servico de importacao; voce pode continuar usando o sistema.`
- Nenhuma falha prematura antes de 120 segundos.

### Importacao sem cache (servico aquecido)
- Link valido do CifraClub, nenhuma entrada no cache.
- Medir p50/p95 da extracao completa (meta: p95 <= 8 segundos).
- Confirmar cifra, artista, tom, capo e YouTube extraídos corretamente.
- Navegar para outra tela durante a importacao; resultado permanece disponível no retorno.

### Importacao com cache quente
- Mesmo link importado anteriormente.
- Medir p95 ponta a ponta (meta: <= 1 segundo).
- Confirmar que nao houve nova consulta externa.

### Transposicao local
- Após importacao, trocar tom usando chips.
- Medir p95 de processamento local (meta: <= 200 ms).
- Confirmar zero chamadas externas adicionais por troca de tom.
- Confirmar que a base original nao e alterada por transposicoes sucessivas.

### Falhas e recuperacao
- Link invalido: erro claro, sem chamada externa.
- Bloqueio/CAPTCHA da fonte: erro claro, sugestao de PDF ou tentativa posterior.
- Timeout do servido: erro dentro do prazo, opcao de tentar novamente.
- Worker reiniciado entre polling e coleta: 410, rascunho preservado, nova tentativa so explicita.

### Isolamento entre igrejas
- Usuario da igreja A nao pode ler/cancelar job da igreja B.
- Link de igreja B na igreja A: rejeitado.
- Admin impersonando igreja B: acessa apenas dados de B.

### Salvamento
- Salvar so apos confirmacao explicita; zero gravacao antes da confirmacao.
- Snapshot salvo permanece disponivel sem nova consulta externa.
- Registro removido ou dono alterado: erro claro, sem gravacao indevida.

## Amostra de URLs
Avaliar pelo menos 30 links autorizados do CifraClub, incluindo:
- Versoes alternativas da mesma musica
- Com e sem capotraste
- Tons com sustenidos e bemois (equivalencia enarmonica)
- Acordes com baixo invertido (ex.: C/E)
- Tablaturas (transposicao desativada, aviso exibido)
- Links que retornam bloqueio/404 na fonte

Resultados musicais devem ser conferidos manualmente contra a fonte original.

## Metas de sucesso (nao garantias atuais)
| Cenario | Meta |
|---|---|
| Cold start acompanhado | ate 120 segundos, sem falha prematura |
| Importacao sem cache, servico aquecido | p95 <= 8 segundos |
| Importacao com cache quente | p95 <= 1 segundo |
| Transposicao local | p95 <= 200 ms, zero chamadas externas |
| Sucesso geral na amostra | >= 95%, sem contar cifras musicalmente incorretas como sucesso |
| Chamadas externas duplicadas | no maximo uma por chave, por instancia |

Se as metas nao forem atingidas no Render Free, registrar evidencias e limites; nao fazer upgrade automatico.

## Operacao e Rollout

### Variaveis de ambiente
- `CIFRA_IMPORT_V2_ENABLED=true` no app para ativar o novo fluxo (somente apos aprovacao).
- `CIFRACLUB_IMPORTER_URL` e `CIFRACLUB_IMPORTER_TOKEN` no app e no worker.
- Worker le `PORT`, `CIFRACLUB_IMPORTER_TOKEN` (minimo 16 caracteres).

### Sequencia de deploy
1. Fazer deploy do worker compatível (v1 continua funcionando).
2. Aplicar migration `scripts/033_song_cifra_original.sql` em ambiente aprovado (apenas aprovado, nunca implicitamente).
3. Fazer deploy do app com a nova versao.
4. Habilitar `CIFRA_IMPORT_V2_ENABLED=true` somente em ambiente aprovado.
5. Desabilitar o switch reverte para o modo legado (aviso de limitacoes, sem promessa de background); nao apaga snapshots nem bases salvas.

### Monitoramento
- Logs por `requestId`: despertar, fila, navegacao/HTTP, extracao, validacao, transposicao, total.
- p50/p95 por fonte, cache hit/miss, codigo de falha.
- Taxa de sucesso e principais motivos de falha (sem IDs pessoais nem conteudo integral de cifras).

### Limitacoes conhecidas (Render Free)
- Servico pode dormir apos inatividade; primeiro acesso apos pausa e lento.
- Tarefas em memoria nao sobrevivem a reinicio do worker; comunicar falha e oferecer tentativa explicita.
- Um rascunho por aba; nao recupera apos fechar/recarregar o navegador ou outra aba.
- 512 MB de RAM; monitorar uso de memoria do Chromium.

## Fora de escopo desta validacao
- HTTP direto como caminho preferencial (experimento futuro, desabilitado por configuracao).
- Cache distribuido/Redis ou fila distribuida.
- Recuperacao apos reload do navegador ou outra aba/dispositivo.
- Compra de VM ou hospedagem paga.
- Deploy, migration aplicada ou upgrade implicitos.