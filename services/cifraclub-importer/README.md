# CifraClub Importer

Microservico interno para importar cifras do CifraClub usando navegador real via Playwright.
Executa no Render Free (512 MB) e expõe endpoints curtos para despertar, criar tarefas e consultar status.

## Rodar Localmente

```bash
docker build -t worship-flow-cifraclub-importer services/cifraclub-importer
docker run --rm -p 3010:3010 -e CIFRACLUB_IMPORTER_TOKEN=dev-token worship-flow-cifraclub-importer
```

Healthcheck:

```bash
curl http://localhost:3010/health
```

Readiness (autenticado):

```bash
curl -X POST http://localhost:3010/ready \
  -H "Authorization: Bearer dev-token" \
  -H "x-cifra-owner: <hex64>" \
  -H "x-cifra-church: <hex64>"
```

Criar tarefa de importacao (autenticado, resposta curta):

```bash
curl -X POST http://localhost:3010/jobs \
  -H "Authorization: Bearer dev-token" \
  -H "x-cifra-owner: <hex64>" \
  -H "x-cifra-church: <hex64>" \
  -H "Content-Type: application/json" \
  -d '{"jobId":"<hex64>","url":"https://www.cifraclub.com.br/coldplay/the-scientist/"}'
```

Consultar status (renova lease de 60s):

```bash
curl http://localhost:3010/jobs/<jobId> \
  -H "Authorization: Bearer dev-token" \
  -H "x-cifra-owner: <hex64>"
```

Cancelar interesse na tarefa:

```bash
curl -X DELETE http://localhost:3010/jobs/<jobId> \
  -H "Authorization: Bearer dev-token" \
  -H "x-cifra-owner: <hex64>"
```

## Variaveis

- `PORT`: porta HTTP. Padrao: `3010`.
- `CIFRACLUB_IMPORTER_TOKEN`: token interno **obrigatório** (minimo 16 caracteres), exigido no header `Authorization`. O servico recusa inicializacao sem ele.
- `IMPORT_TIMEOUT_MS`: timeout de navegacao/extracao. Padrao: `30000`.
- `CACHE_TTL_MS`: TTL do cache de importacoes bem-sucedidas. Padrao: 7 dias.
- `FAILURE_CACHE_TTL_MS`: TTL do cache de falhas temporarias. Padrao: 5 minutos.
- `RATE_LIMIT_WINDOW_MS`: janela do rate limit por IP. Padrao: 10 minutos.
- `RATE_LIMIT_MAX`: maximo de chamadas por IP dentro da janela. Padrao: 30.

## Deploy no Render Free

Este repositorio inclui um `render.yaml` na raiz para criar o servico Docker a partir de
`services/cifraclub-importer`.

1. No Render, clique em **New** -> **Blueprint**.
2. Conecte este repositorio GitHub.
3. Confirme o servico `worship-flow-cifraclub-importer` com plano **Free**.
4. Em **Environment**, defina `CIFRACLUB_IMPORTER_TOKEN` com um valor secreto forte.
5. Aguarde o deploy e teste `https://<seu-servico>.onrender.com/health`.

Depois configure o Worship Flow com:

```env
CIFRACLUB_IMPORTER_URL=https://<seu-servico>.onrender.com
CIFRACLUB_IMPORTER_TOKEN=<mesmo-token-do-render>
CIFRA_IMPORT_V2_ENABLED=true   # somente apos aprovacao da validacao
```

No plano Free o servico pode dormir apos inatividade; a primeira importacao depois de um tempo
pode demorar mais. O acompanhamento de despertar e separado da extracao: ate 120 segundos para
iniciar o servico e ate 30 segundos para a tarefa aceita (incluindo fila e extracao).

## Contrato de tarefa

Resposta de `/jobs` (202 ou 200):

```json
{
  "jobId": "<hex64>",
  "state": "queued|extracting|validating|ready|failed|cancelled|expired",
  "deadlineAt": <epoch_ms>,
  "result": { ... },
  "error": { "code": "...", "message": "..." }
}
```

Quando `state` e `ready`, `result` contem o objeto `OriginalCifra` (versao 2):
`artist`, `name`, `original_lines`, `original_tone`, `capo_frets`, `cipher_url`, `source`,
`transposition_supported`, `warnings`.

## Seguranca

- Somente hosts `cifraclub.com.br` e `cifralize.com.br` via HTTPS/443.
- Redirects, subrequests e destinos privados (IPs privados, loopback, metadata) sao bloqueados antes da conexao.
- O token interno nunca e exposto ao navegador; o app Next.js encaminha headers `x-cifra-owner` e `x-cifra-church` derivados do contexto autenticado.
- Navegador reutilizado com contexto isolado por trabalho; sem cookies compartilhados entre trabalhos.

## Contrato legado (POST /import)

Mantido para compatibilidade durante o rollout. Não iniciar novos consumidores nesse endpoint.