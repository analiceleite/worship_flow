# Plano de implementação — WF-15

**SPEC:** [SPEC-WF-15-estados-feedback.md](../spec/SPEC-WF-15-estados-feedback.md)

**PBI:** [WF-15 — Padronizar estados de erro, vazio, carregamento e salvamento](https://github.com/analiceleite/worship_flow/issues/11)

**Branch:** `fix/wf-15-estados-feedback`

**Estado:** Implementação inicial concluída; validação manual pendente

**Data:** 2026-11-10

## 1. Decisões e limites

- Centralizar o bloco de erro em `components/ui/error-state.tsx` em vez de repetir `Alert` + `Button` em cada tela.
- Manter o botão de recuperação **fora** do `Alert`: o grid do componente reserva `0` para a primeira coluna quando não há ícone, o que torna botões aninhados invisíveis.
- Não alterar APIs, RLS, regras de negócio ou adicionar dependências.
- Usar o `sonner` já adotado pelos componentes, montando um único `Toaster` no layout raiz.
- Mensagens de erro de baixo nível ficam no console; a interface recebe texto acionável em português.
- Não criar nota de release nesta etapa: a publicação depende da confirmação do deploy.

## 2. Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `app/layout.tsx` | Monta `<Toaster />` dentro do `ThemeProvider`. |
| `components/ui/sonner.tsx` | Tipagem local de `CSSProperties`, sem depender do namespace global `React`. |
| `components/ui/error-state.tsx` | Novo bloco de erro com título, detalhe, `role="alert"` e tentativa novamente. |
| `components/delete-dialog.tsx` | Erro inline, diálogo não fecha em falha, trava de clique repetido e rótulo de progresso. |
| `app/songs/page.tsx` | `songsError` separado do vazio, recuperação da consulta e confirmação real antes do toast de exclusão. |
| `app/repertoire/page.tsx` | `loadError` separado de `reorderError`, recuperação de carregamento e erro inline nas exclusões. |
| `app/users/page.tsx` | Erro de convites informado sem esconder integrantes; toasts de sucesso após resposta confirmada. |
| `app/profile/page.tsx` | `loadProfile` reutilizável sem recarregar a página, `saveError` inline e ordem correta de sucesso do Google Calendar. |
| `tests/wf15-feedback.test.cjs` | Novos testes unitários e estruturais. |
| `package.json` | Script `test:wf15`. |

## 3. Estratégia técnica

### 3.1. Feedback global

- `Toaster` único no layout, com `position="top-right"` e `closeButton`.
- O componente já fornece região viva; não adicionar `aria-live` duplicado.

### 3.2. Componente de erro

- `ErrorState` recebe `title`, `message`, `onRetry`, `retrying` e `retryLabel`.
- `role="alert"` para anúncio; ícone decorativo com `aria-hidden`.
- Botão com `aria-busy` e texto “Tentando…”, evitando cliques repetidos.
- Quando não há recuperação, nenhum botão é renderizado.

### 3.3. Telas

- **Biblioteca:** limpar a lista ao iniciar consulta para não apresentar resultados antigos sob novos filtros; descartar respostas antigas e garantir saída de processamento em exceções. O vazio só aparece sem erro. Filtro de ministros tem erro e recuperação próprios.
- **Repertório:** `loadError` controla carregamento; `reorderError` continua cobrindo mutações. Exclusões usam `deleteError`/`deleteSaving` locais e só fecham após sucesso.
- **Equipe:** a falha de convites é independente da lista de integrantes e oferece recarregar.
- **Perfil:** `loadProfile` centraliza a consulta; pausa global tem recuperação independente sem perder edições locais e não é enviada se não carregou. Calendar distingue carregando, erro e desconectado.
- **Toasts:** convite só confirma envio quando `delivery.status` é `sent`. No Google Calendar, a mutação confirmada e a recarga de status são resultados separados: falha de consulta não é apresentada como falha da mutação concluída.

## 4. Etapas executadas

### Fase 0 — Confirmação das evidências

- [x] Confirmar ausência de `Toaster` no layout raiz.
- [x] Confirmar erro silencioso em `delete-dialog` e no carregamento de músicas.
- [x] Confirmar que botões dentro de `Alert` caem na coluna de largura zero.
- [x] Confirmar falso sucesso na remoção de item do repertório.

### Fase 1 — Feedback e estados

- [x] Montar `Toaster` global.
- [x] Criar `ErrorState` acessível e reutilizável.
- [x] Aplicar erro + recuperação em Biblioteca, Repertório, Equipe e Perfil.
- [x] Separar erro de carregamento de erro de mutação no Repertório.
- [x] Bloquear submissão repetida em exclusões e salvamento de preferências.

### Fase 2 — Testes e evidências

- [x] `pnpm test:wf15` — 15 testes aprovados, incluindo callbacks reais de perfil/exclusão com hooks e I/O controlados, resultado de envio e respostas de busca atrasadas.
- [x] `pnpm exec tsc --noEmit --incremental false` — aprovado.
- [x] `pnpm build` — aprovado.
- [x] `pnpm test:repertoire` — 8 testes aprovados.
- [x] `pnpm test:schedule-media` — 14 testes aprovados.
- [x] `pnpm test:notifications` — 7 testes aprovados.
- [ ] `pnpm test:onboarding` — 3 testes falham por módulo `@/lib/notifications/schedule-email` não mapeado no carregador do teste; os arquivos envolvidos não foram alterados nesta entrega.
- [ ] `pnpm lint` — indisponível neste ambiente (ESLint não instalado).
- [ ] Validação manual em navegador, mobile e leitor de tela.
- [ ] Atualizar checklist da SPEC e anexar evidências no PR.

## 5. Matriz de validação

| Cobertura | Verificação | Critério |
|---|---|---|
| Feedback global | Toast de preferências e foto aparece no layout autenticado. | CA-01 |
| Biblioteca | Falha simulada de consulta mostra erro e mantém filtros ao repetir. | CA-02 |
| Repertório | Falha de carga não exibe vazio; falha de remoção mantém diálogo. | CA-03 |
| Equipe | Falha de convites não esconde integrantes. | CA-04 |
| Perfil | Recarga e falha de salvamento ocorrem sem reload e com nova tentativa. | CA-05 |
| Falso sucesso | Nenhum toast de sucesso antes de `response.ok`. | CA-06 |
| Clique repetido | Botões desabilitados e `aria-busy` durante operação. | CA-07 |
| Acessibilidade | Erro e toast são anunciados por leitor de tela. | CA-08 |
| Regressão | Fluxos funcionam em desktop e mobile. | CA-09 |

## 6. Riscos e limitações

- Erros retornados por Supabase/APIs podem variar; as telas usam mensagens próprias para evitar vazamento de SQL.
- O `ErrorState` é novo e substitui padrões locais apenas nas telas citadas; telas fora do escopo continuam com `Alert` + botão e podem precisar da mesma correção depois.
- Testes de navegador e leitor de tela exigem ambiente local com dados sintéticos e não foram executados nesta sessão.
- A falha observada em `test:onboarding` envolve um import não mockado em arquivos não alterados por esta entrega. Não foi executada comparação isolada com a branch base; não tratar a preexistência como comprovada por execução.

## 6.1. Revisão e correções

- Reenvio usa o status real de entrega, inclusive HTTP 200 com entrega falha.
- Exclusões com resposta incerta orientam conferir o estado persistido; não prometem que nada foi removido.
- Catálogo e eventos especiais têm retry específico, independente do snapshot do repertório.
- Criar/renomear evento usam trava síncrona e feedback de processamento; exclusão compartilhada e preferências também têm trava síncrona.
- Consulta da Biblioteca usa geração de requisição; filtros não exibem resultados de buscas antigas após falha.
- Testes novos não são testes E2E: navegador, mobile, foco e leitor de tela continuam pendentes.

## 7. Conclusão

A implementação cobre os critérios automatizáveis da SPEC e mantém as regras de negócio existentes. A entrega fica pronta para revisão humana quando CA-08 e CA-09 tiverem evidência ou limitação registrada. Commit, PR, release e deploy são passos separados e não foram executados.
