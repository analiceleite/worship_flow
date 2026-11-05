# WF-07 — Validação e preparação da entrega

**Data:** 2026-11-05

**Branch:** `fix/wf-07-repertorio-completo`

**SPEC:** [SPEC-WF-07-repertorio-completo.md](../spec/SPEC-WF-07-repertorio-completo.md)

**Estado:** Implementado e validado automaticamente em ambiente local; revisão humana e implantação pendentes.

## Resultados

| Verificação | Resultado |
|---|---|
| Unitários, contratos de API e regressões existentes | 65 testes aprovados, incluindo a novidade de WF-07 |
| Integração real com Auth/PostgreSQL/Mailpit | 23 testes aprovados, incluindo recuperação de senha e WF-07 |
| Navegador Edge headless, desktop e viewport mobile | 12 testes aprovados |
| `pnpm exec tsc --noEmit --incremental false` | Aprovado |
| `pnpm build` com configuração local, dentro do container | Aprovado; 45 páginas geradas |
| `pnpm lint` | Bloqueado: comando `eslint` não instalado no projeto |

As contagens seguem o resumo TAP e incluem os testes agrupadores. O build existente usa `ignoreBuildErrors`; por isso TypeScript foi validado separadamente, sem ignorar erros. Avisos preexistentes de `middleware` e PDF.js apareceram no build, sem impedir sua conclusão.

## Evidências por critério

| Critério | Cobertura |
|---|---|
| CA-01 — Inclusão global | Banco com 25 músicas; navegador adiciona a 26ª a partir da página 3. |
| CA-02 — Movimento global | Banco testa fronteiras 10/11 e 20/21; navegador usa Enter e acompanha o item na página de destino. |
| CA-03 — Exportação completa | Mensagens das páginas 1 e 3 são idênticas, completas e numeradas; mobile também exporta o conjunto inteiro. |
| CA-04 — Contexto | Navegador troca evento/semana e atrasa resposta do evento anterior; banco/API validam isolamento por igreja. Troca de igreja pela navegação administrativa ainda merece smoke check humano. |
| CA-05 — Exclusão | Navegador remove os seis itens finais da página 3 e retorna à página 2 sem falso vazio. |
| CA-06 — Duplicidade | Formulário oferece somente a música ainda não incluída; banco recusa duplicatas globais e inclusões simultâneas em evento vazio. |
| CA-07 — Atomicidade | Falha injetada após alterações de posição, antes de salvar revisão, confirma rollback de toda a transação. |
| CA-08 — Concorrência | Conexões PostgreSQL independentes testam mover/mover, mover/incluir e mover/excluir; navegador exibe conflito e atualiza a lista. |
| CA-09 — Falha de exportação | Resposta HTTP 500 simulada não abre WhatsApp com conteúdo parcial. |
| CA-10 — Permissões | Admin/voz/mídia, ator inválido, IDs fora do contexto, grants, leitura RLS e impersonação legítima/forjada. |
| CA-11 — Legados | Migração executada em esquema descartável dentro de transação: preserva IDs, desempata posições, normaliza nulos/lacunas e aborta diante de duplicatas. |
| CA-12 — Mobile/acessibilidade | Viewport 390×844 sem overflow horizontal, ações móveis e setas com nomes acessíveis; interação de ordenação por teclado. Leitor de tela e aparelho físico não foram validados. |

Também foram verificados: revisão persistente após esvaziamento, perda simulada do resultado após commit sem repetição da inclusão, exclusão transacional de evento, limpeza de repertório ao excluir ministro, catálogo com mais de mil linhas em teste de contrato e ausência do texto pesado de cifras no snapshot. Cifras sob demanda foram abertas tanto na listagem quanto no player no navegador.

Nenhum WhatsApp ou e-mail externo foi enviado. O navegador intercepta o destino WhatsApp e bloqueia serviços externos; e-mails de integração ficam no Mailpit local. Todos os registros usados são fictícios e os testes removem somente seus próprios registros.

## Preparação da release 1.1.1

Após a validação inicial, foi solicitada a inclusão da mudança na central de novidades e a publicação de commit/PR. O catálogo inclui `wf-07-complete-repertoire`, com link para `/repertoire` e indicador de não lida independente das notas anteriores. O pacote identifica `1.1.1`, uma correção compatível; a nota acompanha o mesmo deploy da implementação. Os testes da central foram atualizados e o conjunto de 65 testes unitários/regressão passou novamente, assim como a checagem independente de TypeScript.

O relato de correção do dado duplicado foi recebido, mas não houve acesso deste agente ao banco de produção. Confirmar a conclusão da migração 036 e os smoke checks no processo de implantação; não inferir disponibilidade da aplicação apenas pela atualização do catálogo ou pacote.

## Ambiente e reprodução

Foi usado o projeto Compose separado `worship-flow-wf07-test`, preservando o banco local anterior. O projeto anterior estava parado antes da execução e foi mantido com seus volumes; nenhuma migração antiga/checksum foi alterada para forçar sua inicialização.

O bootstrap em banco novo precisou executar como `supabase_admin`, pois a imagem Postgres reserva os papéis de Auth/Storage. `compose.yaml` foi corrigido apenas nesse ponto; o serviço Auth continua sem superusuário, conforme teste de regressão.

### Preparar um ambiente exclusivo

Não iniciar dois projetos usando as mesmas portas simultaneamente. Não usar `down -v` para solucionar divergências de migração de um banco existente.

```powershell
docker compose -p worship-flow-wf07-test build app
docker compose -p worship-flow-wf07-test up -d --wait app
```

### Unitários e banco

```powershell
pnpm test:repertoire
pnpm exec tsc --noEmit --incremental false
docker compose -p worship-flow-wf07-test run --rm --no-deps test
```

O executor `pnpm local:test` também inclui o teste de banco de WF-07 para o ambiente local gerenciado pela CLI. Não executar arquivos `.local.test.cjs` com credenciais remotas; eles recusam destinos fora do runtime local.

### Navegador

O teste usa `playwright-core` com Edge instalado, sem baixar navegadores automaticamente. Outro canal instalado pode ser informado por `PLAYWRIGHT_CHANNEL`. O teste exige um marcador explícito no banco exclusivo antes de criar fixtures:

```powershell
docker compose -p worship-flow-wf07-test exec -T db psql -U supabase_admin -d postgres -c "ALTER DATABASE postgres SET wf07.browser_test='on';"
$env:WF07_BROWSER_TEST = 'true'
pnpm test:repertoire:browser
```

O teste de navegador utiliza somente as credenciais públicas de teste do Compose e os endereços locais fixos das portas 3001, 54321 e 54322; não lê `.env` de produção. Sem a variável de opt-in, o teste é ignorado. As suítes de banco/navegador devem rodar sem outro operador modificando suas fixtures.

## Pendências antes de produção

- Revisão do código/SQL e aprovação do PR vinculado ao PBI; commit e abertura da PR solicitados após a validação inicial.
- Diagnóstico autorizado dos dados reais: a migração 036 aborta diante de músicas duplicadas ou vínculos entre igrejas. Não remover registros automaticamente para contornar a pré-verificação.
- Planejar janela coordenada de migração + aplicação: clientes antigos perdem escrita direta e precisam recarregar; não reativar DML antigo para contornar um erro.
- Aplicar `scripts/036_repertoire_sequences.sql` somente após aprovação e backup/processo de recuperação revisados.
- Validar aparelho físico, leitor de tela, bloqueador real de pop-up e troca de igreja pela área administrativa.
- Fazer smoke check após implantação, incluindo playlist/cifra, inclusão, reordenação, exclusão, exportação e perfis.
- Restaurar capacidade de lint em refinamento próprio ou na revisão, sem confundir a ausência preexistente de ESLint com aprovação de lint.

O ambiente exclusivo pode ser parado com `docker compose -p worship-flow-wf07-test stop`; seus volumes permanecem preservados. Nenhuma migração, publicação de versão ou alteração de dados de produção foi realizada.
