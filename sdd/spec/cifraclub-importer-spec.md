# SPEC: Importador CifraClub Com Navegador Real

## Contexto

O Worship Flow tem como foco armazenar repertorios de musicas para ministros, gerenciar repertorios e visualizar escalas. A aba de musicas precisa permitir que a equipe cadastre cifras usando a fonte que ela ja utiliza no dia a dia: o CifraClub.

Hoje o app consegue importar cifras pelo Cifralize e salvar o conteudo em `songs.cifra_content`, mas isso cria uma dependencia indireta: a musica precisa existir no Cifralize antes de entrar no Worship Flow. Como o Cifralize tambem importa musicas do CifraClub, o objetivo e trazer uma capacidade parecida para dentro do produto.

## Problema

O fluxo atual limita a importacao automatica ao Cifralize. Isso causa:

- Cadastro bloqueado quando a musica existe no CifraClub, mas nao existe no Cifralize.
- Desalinhamento com o habito da equipe, que usa CifraClub como fonte principal.
- Dependencia de um intermediario para obter conteudo que deveria vir da fonte usada pela equipe.
- Maior chance de cifra/tom/video divergirem da referencia real usada nos ensaios.

## Objetivo

Permitir que o Worship Flow importe cifras diretamente do CifraClub, salve um snapshot local no Supabase e use esse conteudo dentro do app sem depender de consulta futura ao CifraClub.

O resultado esperado e:

```txt
Ministro cola link do CifraClub
  -> Worship Flow importa a cifra
  -> salva conteudo estruturado em songs.cifra_content
  -> salva link original em songs.cipher_url
  -> cifra fica disponivel no app para repertorio e escala
```

## Nao Objetivos

- Nao substituir o armazenamento local por leitura sob demanda do CifraClub.
- Nao remover Cifralize imediatamente.
- Nao executar Selenium/Playwright dentro do runtime principal do Next.js.
- Nao depender exclusivamente de scraping sem fallback manual.
- Nao fazer backfill massivo antes de validar estabilidade em producao.

## Abordagem Recomendada

Criar um microservico separado para importacao do CifraClub usando navegador real. O app Next.js continua responsavel por autenticacao, autorizacao, validacao, persistencia e experiencia do usuario.

Arquitetura:

```txt
Worship Flow Next.js
  -> app/api/cifra/import
    -> valida usuario e rate limit
    -> identifica origem do link
    -> chama microservico CifraClub Importer para links do CifraClub
    -> usa Cifralize como fallback secundario
    -> salva snapshot local em songs.cifra_content
```

O microservico deve rodar separado porque navegador headless tem dependencias de sistema, consumo de memoria e perfil de deploy diferentes do Next.js.

## Decisao Tecnica

Decisao tecnica: Playwright.

Alternativa aceita: Selenium.

Motivos para preferir Playwright:

- Melhor suporte a execucao em container.
- APIs modernas para aguardar seletores, interceptar timeouts e extrair conteudo.
- Imagens Docker oficiais e instalacao mais previsivel.
- Menor friccao operacional que Selenium + webdriver remoto.

Selenium continua viavel caso seja necessario seguir o modelo do projeto `code4music/cifraclub-api`, mas o projeto encontrado deve ser tratado como referencia, nao como dependencia direta sem revisao.

## Contrato Do Microservico

Endpoint sugerido:

```http
POST /import
Content-Type: application/json
Authorization: Bearer <INTERNAL_TOKEN>
```

Payload:

```json
{
  "url": "https://www.cifraclub.com.br/artista/musica/",
  "target_tone": "G"
}
```

Alternativamente:

```json
{
  "artist": "artista",
  "song": "musica",
  "target_tone": "G"
}
```

Resposta normalizada:

```json
{
  "artist": "Nome do artista",
  "name": "Nome da musica",
  "tone": "G",
  "available_tones": ["C", "D", "E", "F", "G", "A", "B"],
  "youtube_url": "https://www.youtube.com/watch?v=...",
  "cipher_url": "https://www.cifraclub.com.br/artista/musica/",
  "cifra": ["[Intro] G D Em C", "", "G ..."],
  "capo_frets": 0,
  "source": "cifraclub"
}
```

Erros esperados:

```json
{
  "error": "Cifra nao encontrada.",
  "code": "NOT_FOUND"
}
```

Codigos sugeridos:

- `NOT_FOUND`: musica nao encontrada.
- `NO_CIFRA`: pagina encontrada, mas cifra nao extraida.
- `BLOCKED`: bloqueio, captcha ou pagina de protecao.
- `INVALID_TONE`: tom solicitado indisponivel ou invalido.
- `TIMEOUT`: pagina demorou demais.
- `FETCH_FAILED`: erro generico de navegacao/extracao.

## Fluxo No Worship Flow

O endpoint `app/api/cifra/import` deve aceitar:

- Link do CifraClub.
- Link do Cifralize.
- Parametros `artist`, `song` e `target_tone`.
- Busca textual futura, se necessario.

Ordem recomendada:

```txt
1. Validar usuario autenticado.
2. Aplicar rate limit por usuario.
3. Detectar origem da URL.
4. Se CifraClub:
   - chamar sempre o microservico CifraClub Importer.
5. Se Cifralize:
   - usar fluxo atual.
6. Normalizar resposta para o mesmo contrato usado pelo formulario.
7. Retornar JSON para o frontend.
```

## Persistencia

O app deve continuar salvando:

- `songs.cifra_content`: linhas da cifra importada.
- `songs.cipher_url`: URL original da cifra, preferencialmente CifraClub.
- `songs.tone`: tom selecionado/importado.
- `songs.capo_frets`: casa do capo, quando encontrada.
- `songs.youtube_url`: video detectado ou selecionado manualmente.

Campo opcional recomendado em migracao futura:

```txt
songs.cifra_source text check in ('cifraclub', 'cifralize', 'upload', 'manual')
```

Esse campo ajudaria auditoria e suporte, mas nao e obrigatorio para a primeira entrega.

## Cache E Rate Limit

O importador deve evitar consultar o CifraClub repetidamente para a mesma musica.

Cache recomendado:

- Chave: `source + artist_slug + song_slug + target_tone`.
- TTL inicial: 7 a 30 dias.
- Armazenar payload bruto normalizado e status de falha temporaria.

Rate limit recomendado:

- Por usuario no Next.js.
- Por IP/origem no microservico.
- Limite menor para falhas repetidas.
- Timeout agressivo por tentativa, por exemplo 20 a 30 segundos.

## Seguranca

O microservico nao deve ficar publico sem protecao.

Requisitos:

- Autenticacao por token interno via `Authorization: Bearer`.
- Variavel `CIFRACLUB_IMPORTER_TOKEN` no Next.js e no microservico.
- Validacao de host para impedir SSRF. Aceitar apenas `cifraclub.com.br` e `www.cifraclub.com.br`.
- Bloquear URLs internas, IPs privados e redirects para hosts nao permitidos.
- Logs sem dados sensiveis.

## Observabilidade

Registrar eventos importantes:

- Origem da importacao: CifraClub direto, microservico, Cifralize ou upload.
- Tempo total de importacao.
- Codigo de erro quando falhar.
- Quantidade de linhas extraidas.
- Usuario que solicitou, se o log estiver no Next.js e respeitando privacidade.

Metricas desejadas:

- Taxa de sucesso por fonte.
- Latencia media por fonte.
- Principais motivos de falha.
- Quantidade de chamadas ao microservico por dia.

## UX Esperada

Na aba Musicas:

- Trocar texto de `Cole o link do Cifralize` para `Cole o link do CifraClub ou Cifralize`.
- Mostrar carregamento com origem: `Importando cifra do CifraClub...`.
- Ao importar com sucesso, preencher titulo, artista, tom, cifra, capo e YouTube quando disponivel.
- Permitir trocar tom usando chips quando `available_tones` existir.
- Se CifraClub falhar, mostrar erro claro e oferecer fallback: tentar de novo, usar Cifralize ou enviar PDF/foto.

## Fases De Implementacao

### Fase 1: Integracao CifraClub No Endpoint Atual

- Aceitar links do CifraClub em `/api/cifra/import`.
- Usar `parseCifraClubUrl` existente.
- Chamar o microservico CifraClub Importer para links do CifraClub.
- Normalizar resposta para o formato `ImportedCifra`.
- Atualizar UI para aceitar CifraClub e Cifralize.

### Fase 2: Microservico Com Navegador Real

- Criar `services/cifraclub-importer`.
- Implementar endpoint `/import`.
- Usar Playwright ou Selenium em Docker.
- Retornar JSON normalizado.
- Proteger com token interno.
- Adicionar timeouts e tratamento de erro.

### Fase 3: Integracao Do Microservico

- Quando o link for CifraClub, usar sempre o microservico.
- Se microservico falhar, orientar fallback PDF/foto ou Cifralize.
- Padronizar mensagens de erro no frontend.

### Fase 4: Cache E Auditoria

- Criar cache de importacoes.
- Registrar origem e status das importacoes.
- Medir sucesso/falha por fonte.
- Avaliar backfill de musicas antigas.

## Criterios De Aceite

- Usuario consegue colar link valido do CifraClub no cadastro de musica.
- App importa a cifra e exibe preview de `Cifra pronta`.
- Cifra salva em `songs.cifra_content` e continua disponivel sem nova consulta ao CifraClub.
- Link original do CifraClub fica salvo em `songs.cipher_url`.
- Cifralize continua funcionando como antes.
- PDF/foto continua funcionando como fallback.
- Falhas retornam mensagens claras e nao bloqueiam o formulario permanentemente.
- Microservico nao aceita chamadas sem token interno.
- Microservico nao navega para hosts fora do CifraClub.

## Riscos

- CifraClub pode alterar HTML e quebrar extracao.
- CifraClub pode bloquear automacao ou exigir CAPTCHA.
- Navegador headless aumenta custo de infraestrutura.
- Importacoes em massa podem causar bloqueio se nao houver rate limit.
- Pode haver implicacoes legais ou de termos de uso relacionadas a scraping e armazenamento de cifras.

## Recomendacao Final

Seguir com a implementacao baseada no microservico com navegador real. O produto deve sempre salvar a cifra localmente depois da importacao, porque a visualizacao do repertorio e da escala nao pode depender de uma fonte externa estar disponivel no momento do culto ou ensaio.
