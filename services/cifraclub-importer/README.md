# CifraClub Importer

Microservico interno para importar cifras do CifraClub usando navegador real via Playwright.

## Rodar Localmente

```bash
docker build -t worship-flow-cifraclub-importer services/cifraclub-importer
docker run --rm -p 3010:3010 -e CIFRACLUB_IMPORTER_TOKEN=dev-token worship-flow-cifraclub-importer
```

Healthcheck:

```bash
curl http://localhost:3010/health
```

Importacao:

```bash
curl -X POST http://localhost:3010/import \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.cifraclub.com.br/coldplay/the-scientist/","target_tone":"G"}'
```

## Variaveis

- `PORT`: porta HTTP. Padrao: `3010`.
- `CIFRACLUB_IMPORTER_TOKEN`: token interno exigido no header `Authorization`.
- `IMPORT_TIMEOUT_MS`: timeout de navegacao/extracao. Padrao: `30000`.
- `CACHE_TTL_MS`: TTL do cache de importacoes bem-sucedidas. Padrao: 14 dias.
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
```

No plano Free o servico pode dormir apos inatividade; a primeira importacao depois de um tempo
pode demorar mais.

## Contrato

Retorna JSON normalizado para o Worship Flow:

```json
{
  "artist": "Coldplay",
  "name": "The Scientist",
  "tone": "G",
  "available_tones": ["C", "D", "E"],
  "youtube_url": "https://www.youtube.com/watch?v=...",
  "cipher_url": "https://www.cifraclub.com.br/coldplay/the-scientist/",
  "cifra": ["[Intro] ..."],
  "capo_frets": 0,
  "source": "cifraclub"
}
```
