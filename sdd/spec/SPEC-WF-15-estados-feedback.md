# SPEC — WF-15: Padronizar estados de erro, vazio, carregamento e salvamento

**Status:** Implementação inicial concluída; validação manual de leitor de tela e navegador pendente

**PBI:** [WF-15 — Padronizar estados de erro, vazio, carregamento e salvamento](https://github.com/analiceleite/worship_flow/issues/11)

**Branch:** `fix/wf-15-estados-feedback`

**Prioridade:** P1 — Alta

**Área:** UX e acessibilidade · Correção

**Data:** 2026-11-10

**Plano:** [PLAN-WF-15-implementation.md](../plan/PLAN-WF-15-implementation.md)

## 1. Contexto e problema

A auditoria estática apontou que falhas de consulta e exclusão podiam terminar apenas no console, sem feedback para a pessoa usuária. Uma falha de carregamento podia ser lida como lista vazia, e ações destrutivas podiam parecer concluídas mesmo sem sucesso. As preferências usavam toasts, mas o provedor global não estava montado.

**Pessoas impactadas:** todos os perfis que consultam biblioteca, repertório, equipe ou perfil.

As evidências abaixo vêm de inspeção de código; não indicam frequência medida em produção.

## 2. Evidências confirmadas

| Local | Problema confirmado |
|---|---|
| `app/layout.tsx` | Nenhum `Toaster` era renderizado. Todos os `toast.*` de `sonner` não apareciam. |
| `app/profile/page.tsx:183–218` | Salvamento de preferências só anunciado por toast inexistente; falha sem recuperação inline. |
| `app/profile/page.tsx:225` | Recuperação de contexto recarregava a página inteira. |
| `components/delete-dialog.tsx:32–40` | Falha de exclusão apenas em `console.error`, sem mensagem no diálogo (ele já permanecia aberto). |
| `app/songs/page.tsx:121–128` | Erro de consulta era ignorado; a tela caía no estado vazio. |
| `app/repertoire/page.tsx:386–391` | Falha de carregamento usava o mesmo canal de erros de mutação e a lista caía em “aguardando carregamento”. |
| `app/repertoire/page.tsx:489–507` | Remoção de música fechava o diálogo mesmo quando a mutação falhava. |
| `app/users/page.tsx:55–72` | Falha ao carregar convites era convertida em lista vazia. |
| `components/ui/alert.tsx` | Botões aninhados no `Alert` caem na coluna de largura zero do grid e ficam inacessíveis. |

## 3. Objetivos

- Montar feedback global e garantir que mensagens de sucesso reflitam resposta confirmada do servidor.
- Distinguir erro recuperável de ausência real de dados em Biblioteca, Repertório, Equipe e Perfil.
- Oferecer tentativa novamente sem perder filtros, seleção de evento, página ou dados já carregados.
- Impedir submissão repetida e deixar processamento visível em salvar e excluir.
- Padronizar o bloco de erro em um componente reutilizável e acessível.

## 4. Escopo e limites

**Incluído:** `components/ui/error-state.tsx`, `components/delete-dialog.tsx`, `app/layout.tsx`, `app/songs/page.tsx`, `app/repertoire/page.tsx`, `app/users/page.tsx`, `app/profile/page.tsx` e `components/ui/sonner.tsx`; mensagens e estados das jornadas citadas.

**Fora de escopo:** redesenho visual amplo, alteração de regras de negócio/RLS, mudanças de API, padronização de telas não citadas, teste real de leitura de tela e publicação de release.

## 5. Requisitos de experiência

### 5.1. Erro versus vazio

- Falha de consulta deve exibir mensagem explícita e ação de recuperação; nunca ser apresentada como “nenhum registro”.
- Estado vazio só aparece após carregamento bem-sucedido.
- Erros de páginas independentes (por exemplo, convites na Equipe) não devem esconder conteúdo que carregou corretamente.

### 5.2. Recuperação e contexto

- “Tentar novamente” deve refazer a operação sem recarregar a página nem perder filtros, evento selecionado ou página.
- O botão deve indicar tentativa em andamento e bloquear cliques repetidos.
- Erros de mutação continuam separados dos erros de carregamento.

### 5.3. Salvamento e exclusão

- Enquanto a operação estiver em andamento, o controle deve ficar desabilitado e com rótulo de progresso.
- Falha deve manter o diálogo aberto, mostrar a mensagem e permitir nova tentativa.
- Sucesso só pode ser anunciado depois da confirmação do servidor.

### 5.4. Acessibilidade

- Blocos de erro usam `role="alert"` e texto não dependente apenas de cor.
- Toasts usam a região viva do `sonner`; o provedor é montado uma única vez no layout raiz.
- Botões de recuperação ficam fora do grid do `Alert`, evitando área clicável de largura zero.

## 6. Critérios de aceite

As marcações abaixo indicam cobertura de implementação, não aceite final. Os testes incluem renderização estática, contratos estruturais e execução de callbacks com hooks/I/O controlados; não substituem navegador ou leitor de tela.

- [x] **CA-01 — Feedback global:** `Toaster` montado; toasts de perfil e foto passam a ser exibidos.
- [x] **CA-02 — Biblioteca:** erro de consulta tem mensagem e “Tentar novamente”; estado vazio não aparece em caso de falha.
- [x] **CA-03 — Repertório:** falha de carregamento tem estado próprio e recuperação; remoção falha mantém o diálogo aberto com mensagem.
- [x] **CA-04 — Equipe:** falha de convites é informada sem esconder a lista de integrantes; carregamento da equipe mantém recuperação.
- [x] **CA-05 — Perfil:** recarga de contexto não usa `window.location.reload`; falha ao salvar preferências fica visível e repetível.
- [x] **CA-06 — Sem falso sucesso:** mensagens de sucesso são emitidas somente após resposta confirmada.
- [x] **CA-07 — Submissão única:** salvar e excluir bloqueiam clique repetido e exibem progresso.
- [ ] **CA-08 — Leitor de tela:** validar anúncio de erro e de toast com tecnologia assistiva.
- [ ] **CA-09 — Navegador/dispositivo:** percorrer as jornadas afetadas em desktop e mobile com dados sintéticos.

## 7. Validação

Executar `pnpm test:wf15` (unitário/estrutural), `pnpm exec tsc --noEmit --incremental false`, `pnpm build` e as suítes de regressão de repertório e navegação. A validação manual em navegador e leitor de tela permanece pendente e deve usar dados não sensíveis.

## 8. Dependências e relações

- [WF-04 — Onboarding](https://github.com/analiceleite/worship_flow/issues/1), [WF-07 — Repertório completo](https://github.com/analiceleite/worship_flow/issues/3) e [WF-14 — Salvar música com PDF](https://github.com/analiceleite/worship_flow/issues/10): fluxos revisados por esta padronização, sem alterar suas regras.
- [WF-16 — Acessibilidade e toque](https://github.com/analiceleite/worship_flow/issues/12): estados de erro usam semântica de alerta e não reabrem barreiras já corrigidas.

## 9. Registro de decisões

- **2026-11-10 — Criação e implementação inicial:** `Toaster` global, componente `ErrorState`, estados de erro separados e bloqueio de submissão repetida nas jornadas citadas. Nenhuma migração de banco, release ou deploy executado.
- **2026-11-10 — Correções após revisão:** pausa global só é enviada se carregada com sucesso; erros de Calendar, catálogo e eventos possuem recuperação específica; envio de convite respeita o resultado de entrega; mensagens de exclusão não garantem rollback quando a resposta é incerta; buscas descartam respostas antigas e criação/edição de eventos bloqueiam submissões repetidas. Aceite manual permanece pendente.
