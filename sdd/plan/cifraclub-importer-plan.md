# PLAN: Importador CifraClub Com Navegador Real

Spec relacionada: `sdd/cifraclub-importer-spec.md`

## Objetivo Do Plano

Implementar suporte confiavel para importar cifras do CifraClub no Worship Flow, mantendo Cifralize e PDF/foto como fallback.

## Fase 1: Ativar CifraClub No Fluxo Atual


### 1.1 Mapear contrato existente

- Confirmar formato esperado pelo frontend em `ImportedCifra`.
- Confirmar campos salvos em `songs` no formulario de musicas.
- Confirmar erros atuais do endpoint `/api/cifra/import`.

Resultado esperado:

- Lista final dos campos obrigatorios da resposta: `artist`, `name`, `tone`, `available_tones`, `youtube_url`, `cipher_url`, `cifra`, `capo_frets`.

### 1.2 Atualizar endpoint de importacao

- Importar `parseCifraClubUrl` no endpoint `app/api/cifra/import/route.ts`.
- Importar `scrapeCifraClub` e `CifraClubScrapeError`.
- Detectar se `url` e CifraClub ou Cifralize.
- Para CifraClub, chamar sempre o microservico CifraClub Importer.
- Normalizar retorno de CifraClub para o mesmo formato usado pelo Cifralize.
- Manter o fluxo Cifralize existente sem regressao.

Resultado esperado:

- `/api/cifra/import?url=<cifraclub>&target_tone=<tom>` retorna JSON compativel com o formulario.
- `/api/cifra/import?url=<cifralize>&target_tone=<tom>` continua funcionando.

### 1.3 Atualizar mensagens e validacao do formulario

- Trocar validacao que aceita apenas `isCifralizeUrl` para aceitar CifraClub ou Cifralize.
- Atualizar placeholder para `Cole o link do CifraClub ou Cifralize...`.
- Atualizar textos de carregamento e erro para nao mencionar somente Cifralize.
- Garantir que troca de tom funcione para links do CifraClub.

Resultado esperado:

- Usuario consegue colar link do CifraClub na aba Musicas.
- UI comunica corretamente a fonte da importacao.

### 1.4 Verificacao da Fase 1

- Testar importacao com link CifraClub valido.
- Testar importacao com link Cifralize valido.
- Testar link invalido.
- Testar tom invalido ou indisponivel.
- Rodar `pnpm lint`.

Resultado esperado:

- Fluxos principais funcionando sem quebrar Cifralize.

## Fase 2: Criar Microservico CifraClub Importer

### 2.1 Criar estrutura do servico

- Criar pasta `services/cifraclub-importer`.
- Escolher runtime: Node.js + Playwright preferencialmente.
- Criar endpoint `POST /import`.
- Criar Dockerfile do servico.
- Criar README curto de execucao local.

Resultado esperado:

- Servico sobe localmente em container e responde healthcheck.

### 2.2 Implementar extracao com navegador real

- Navegar ate a URL do CifraClub.
- Aguardar seletor principal da cifra.
- Extrair titulo, artista, cifra, YouTube, tom atual, tons disponiveis e capo quando possivel.
- Normalizar resposta para o contrato da SPEC.
- Adicionar timeout por requisicao.

Resultado esperado:

- Servico retorna JSON valido para musicas existentes no CifraClub.

### 2.3 Implementar seguranca minima

- Exigir `Authorization: Bearer <token>`.
- Validar host permitido: `cifraclub.com.br` e `www.cifraclub.com.br`.
- Rejeitar redirects para hosts nao permitidos.
- Rejeitar payload sem `url` ou sem `artist/song`.

Resultado esperado:

- Servico nao aceita chamadas anonimas nem URLs externas.

### 2.4 Verificacao da Fase 2

- Testar chamada autorizada.
- Testar chamada sem token.
- Testar URL fora do CifraClub.
- Testar musica inexistente.
- Testar timeout.

Resultado esperado:

- Servico confiavel para uso controlado pelo app principal.

## Fase 3: Integrar Next.js Com Microservico

### 3.1 Adicionar configuracao

- Adicionar variaveis esperadas na documentacao:
  - `CIFRACLUB_IMPORTER_URL`
  - `CIFRACLUB_IMPORTER_TOKEN`
- Garantir que ausencia dessas variaveis nao quebre Cifralize nem upload.
- Para links do CifraClub, ausencia dessas variaveis deve retornar erro claro de servico nao configurado.

Resultado esperado:

- App consegue funcionar com ou sem microservico configurado.

### 3.2 Criar client interno do importer

- Criar utilitario em `lib/cifraclub-importer-client.ts`.
- Enviar payload normalizado ao microservico.
- Tratar status HTTP e codigos de erro.
- Retornar o mesmo formato `ImportedCifra`.

Resultado esperado:

- Endpoint Next.js chama microservico sem acoplar detalhes no route handler.

### 3.3 Integrar uso obrigatorio do microservico para CifraClub

- No fluxo CifraClub, chamar sempre o microservico.
- Se microservico falhar, retornar erro claro e orientar fallback PDF/foto ou Cifralize.

Resultado esperado:

- CifraClub usa caminho unico e mais confiavel com navegador real.

### 3.4 Verificacao da Fase 3

- Testar CifraClub com microservico desligado.
- Testar CifraClub com microservico ligado.
- Testar CifraClub sem variaveis do microservico e confirmar erro claro.
- Testar CifraClub com microservico configurado.
- Rodar `pnpm lint`.
- Rodar `pnpm build`, se ambiente estiver configurado.

Resultado esperado:

- Integracao estavel e sem regressao em rotas existentes.

## Fase 4: Cache, Rate Limit E Auditoria

### 4.1 Refinar rate limit

- Separar limites por fonte se necessario.
- Manter limite por usuario no Next.js.
- Adicionar limite simples no microservico, se ele ficar exposto em rede.

Resultado esperado:

- Importacoes repetidas nao sobrecarregam CifraClub nem o microservico.

### 4.2 Definir cache

- Criar estrategia de cache para importacoes por `source + artist + song + target_tone`.
- Decidir se cache sera em tabela Supabase ou storage simples no microservico.
- Salvar tambem falhas temporarias com TTL curto.

Resultado esperado:

- Mesma musica nao dispara scraping repetido desnecessariamente.

### 4.3 Adicionar auditoria opcional

- Avaliar migracao `songs.cifra_source`.
- Registrar origem da cifra importada.
- Registrar data da ultima importacao, se util.

Resultado esperado:

- Suporte consegue identificar se uma cifra veio de CifraClub, Cifralize ou upload.

### 4.4 Verificacao da Fase 4

- Confirmar cache hit e cache miss.
- Confirmar comportamento com erro temporario.
- Confirmar que origem aparece corretamente nos dados.

Resultado esperado:

- Operacao mais barata, observavel e previsivel.

## Sequencia Recomendada De Commits

1. `feat: accept cifraclub links in cifra import`
2. `feat: add cifraclub importer service`
3. `feat: integrate cifraclub importer service`
4. `feat: cache cifra imports`
5. `docs: document cifraclub importer setup`

## Checklist Final

- CifraClub aceito no cadastro de musica.
- Cifralize continua aceito.
- PDF/foto continua aceito.
- Cifra importada salva em `songs.cifra_content`.
- Link original salvo em `songs.cipher_url`.
- Erros exibidos de forma clara.
- Microservico protegido por token.
- Hosts externos bloqueados.
- `pnpm lint` executado.
- `pnpm build` executado quando possivel.
