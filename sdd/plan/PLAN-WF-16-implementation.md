# Plano de implementação — WF-16

**SPEC:** [SPEC-WF-16-acessibilidade-toque.md](../spec/SPEC-WF-16-acessibilidade-toque.md)

**PBI:** [WF-16 — Corrigir barreiras de acessibilidade e operação por toque](https://github.com/analiceleite/worship_flow/issues/12)

**Branch:** `fix/wf-16-acessibilidade-toque`

**Estado:** Correções iniciais implementadas; validação manual de acessibilidade pendente

**Data:** 2026-11-07

## 1. Decisões e limites

- Corrigir apenas barreiras confirmadas nas jornadas de repertório, perfil e gestão de usuários, incluindo controles compartilhados afetados.
- Priorizar HTML semântico e comportamento nativo; não adicionar ARIA quando a semântica nativa já comunica nome, função e estado corretamente.
- Alvos de ações frequentes devem buscar 44 × 44 CSS pixels de área efetiva, sem ampliar indiscriminadamente todos os controles da aplicação.
- Medir e corrigir contraste nesta entrega, nos temas e estados realmente usados pelas telas afetadas.
- Acessibilidade textual/OCR de PDFs será investigada separadamente na [WF-35](https://github.com/analiceleite/worship_flow/issues/39). Não implementar OCR nem conversão neste plano; a pendência não bloqueia as demais correções.
- Preservar fluxos funcionais e padrões visuais vigentes; não fazer redesenho geral nem alterar regras de negócio.

Este plano não autoriza commit, abertura de PR, release ou deploy. Nenhuma validação deve usar dados pessoais ou documentos reais sem autorização.

## 2. Inspeção inicial e implicações

As evidências abaixo foram apontadas pela SPEC e devem ser confirmadas antes de editar. A inspeção estática não comprova o comportamento renderizado nem o anúncio por tecnologia assistiva.

| Local | Verificação e ação planejada |
|---|---|
| `components/ui/button.tsx` | Conferir variantes, estados de foco e dimensões; ajustar apenas se a área interativa compartilhada causar barreira, avaliando regressões nos consumidores. |
| `app/repertoire/page.tsx` | Inspecionar os controles indicados pela SPEC; identificar botões só com ícone, seleção sem estado exposto, foco e dimensões. |
| `app/users/page.tsx` | Verificar labels, associação de instruções/erros, nomes de ações e operação por teclado. |
| `app/profile/page.tsx` | Verificar associação de labels e feedback de validação, incluindo preservação de valor em erro. |
| `components/minister-form.tsx` | Conferir IDs/`htmlFor`, mensagens de erro e estados dos campos sem duplicar ARIA existente. |
| Diálogos e componentes compartilhados usados pelas jornadas | Localizar implementação e padrão de foco/retorno ao fechar; limitar correções aos componentes efetivamente utilizados. |
| `components/pdf-scroll-viewer.tsx` | Confirmar se canvas tem camada textual alternativa. Registrar a limitação e referenciar WF-35; não implementar OCR aqui. |
| Tokens de tema e estilos afetados | Identificar cores finais de texto, ícones funcionais, foco e controles em ambos os temas e estados interativos para medição de contraste. |

Após confirmar a superfície, registrar os arquivos realmente afetados e os problemas reproduzíveis antes de iniciar correções amplas.

## 3. Estratégia técnica

### 3.1. Semântica, nomes e formulários

- Usar elemento nativo adequado à ação (`button`, `a`, input correspondente) e nome visível quando possível.
- Para ação somente com ícone, fornecer nome acessível estável e específico; manter o ícone decorativo fora da árvore acessível quando apropriado.
- Garantir associação label/campo por `htmlFor` e `id`, ou pelo aninhamento semântico existente.
- Associar ajuda e erro ao campo por mecanismos suportados (`aria-describedby` quando necessário); comunicar inválido sem depender apenas da cor.
- Expor seleção/alternância com estado nativo ou padrão semântico correto, incluindo valor atualizado e foco operável por teclado.
- Evitar anúncios duplicados e não atribuir `role`/`aria-*` conflitantes a controles nativos.

### 3.2. Teclado, foco e toque

- Percorrer as tarefas principais com teclado, verificando ordem, ativação, foco visível e ausência de armadilhas.
- Para diálogos/overlays, confirmar contenção de foco enquanto abertos e restauração ao acionador ao fechar; se o acionador desaparecer, focar um destino lógico.
- Aumentar a área clicável/toque dos controles frequentes sem sobreposição de alvos adjacentes e sem comprometer layouts compactos.
- Verificar foco e toque nos temas e breakpoints afetados; não remover estilos de foco globais sem substituição equivalente.

### 3.3. Contraste

- Medir contraste sobre cores renderizadas nos temas claro e escuro disponíveis e nos estados normal, hover, selecionado, foco e desabilitado, conforme aplicável.
- Incluir texto, ícones que comunicam ação/estado, indicadores de foco e limites visuais de componentes necessários para identificá-los.
- Aplicar correções nos tokens ou estilos locais mais estreitos que resolvam a barreira sem degradar outras telas; repetir medição após a mudança.
- Registrar ferramenta/método, pares de cores, estados, tema e resultado. Pendências devem incluir motivo e evidência, não apenas a declaração “contraste revisado”.

### 3.4. Layout e PDFs

- Verificar as jornadas em viewport de 360px, zoom de 200% e teclado virtual aberto, sem ocultar ações essenciais ou exigir precisão fina.
- Confirmar se o canvas do visualizador tem alternativa textual acessível e registrar o resultado. Qualquer avaliação de extração/OCR, precisão musical ou solução alternativa pertence à WF-35.

## 4. Etapas de execução

### Fase 0 — Confirmar barreiras e estabelecer baseline

- [x] Inspecionar os trechos da SPEC e confirmar no código associações ausentes, seleção sem estado exposto e controles de ícone com alvos inferiores a 44px.
- [x] Inventariar controles compartilhados e temas claro/escuro; confirmação renderizada em navegador continua pendente.
- [x] Identificar ações de repertório e controles de perfil com alvos menores que o mínimo planejado.
- [ ] Confirmar em leitor de PDF/browser se existe camada textual acessível; encaminhamento para WF-35 registrado, sem implementar OCR.
- [ ] Capturar baseline visual e medições completas de contraste por estado em navegador.

### Fase 1 — Semântica e operação por teclado

- [x] Corrigir nomes acessíveis de ações por ícone e os alvos de navegação, cifra e playlist no repertório.
- [x] Corrigir associações label/controle para switches de notificações no perfil e tornar rótulos clicáveis de caixas de seleção mais fáceis de atingir.
- [x] Expor seleção de dias e de opções de papel/funções com `aria-pressed`; agrupar semanticamente os campos de papel/funções.
- [x] Fortalecer foco visível de botões e do fechamento de diálogo; Radix Dialog mantém gestão/restauração de foco nativa.
- [x] Expor erros dos formulários como região de alerta.
- [ ] Validar manualmente leitor de tela, ordem de foco e retorno ao acionador.

### Fase 2 — Toque, layout e contraste

- [x] Aumentar variantes de botão com ícone e alvos identificados para buscar 44 × 44 CSS pixels; revisão visual de sobreposições pendente.
- [x] Calcular contraste das combinações-base de tokens de texto/ação contra os fundos de cada tema; nenhuma falha nessas combinações calculadas.
- [ ] Medir estados customizados renderizados e foco em navegador; substituir as verificações de token por evidência visual completa.
- [ ] Validar a interface em 360px, zoom de 200% e com teclado virtual aberto.
- [ ] Registrar limitações que exijam decisão de produto ou mudança de escopo.

### Fase 3 — Testes e evidências

- [x] Executar TypeScript (`pnpm exec tsc --noEmit`), build (`pnpm build`) e testes existentes de repertório (`pnpm test:repertoire`).
- [ ] Executar lint; `pnpm lint` não pôde iniciar porque o binário `eslint` não está instalado/disponível neste checkout.
- [ ] Testar manualmente teclado e leitor de tela em tarefas representativas; registrar navegador, leitor e sistema operacional.
- [ ] Revalidar contraste depois das correções e conferir regressões visuais/funcionais em desktop e mobile.
- [ ] Atualizar checklist de aceite e anexar evidências/limitações em relatório ou PR.
- [ ] Atualizar estado deste plano e referências da SPEC sem declarar revisão humana ou deploy concluídos automaticamente.

## 5. Matriz de validação

| Cobertura | Verificação | SPEC |
|---|---|---|
| Nomes e semântica | Ações por ícone têm nome; seleção/alternância é exposta; nomes não duplicam texto visível. | CA-01, CA-04 |
| Teclado | Percorrer repertório, formulários e diálogos sem mouse; ordem lógica, ativação e sem armadilha. | CA-02 |
| Foco | Foco visível nos estados relevantes e retorno ao acionador ao fechar diálogo; destino lógico se acionador removido. | CA-03 |
| Formulários | Label, instrução e erro associados; erro perceptível sem cor; valor mantido após falha. | CA-04 |
| Toque/layout | Medir alvos frequentes; verificar ausência de sobreposição em viewport estreito. | CA-05, CA-06 |
| Responsividade | Repetir fluxos a 360px, zoom 200% e teclado virtual aberto. | CA-06 |
| Leitor de tela | Ouvir nome, função, estado, instruções e feedback de erro em tarefas representativas. | CA-07 |
| Contraste | Medir texto, ícones funcionais, foco e controles nos temas/estados; repetir após correção. | CA-08 |
| PDF | Confirmar/documentar limite textual e encaminhamento para WF-35; nenhuma implementação OCR nesta entrega. | CA-09 |
| Regressão | Verificar fluxos e visibilidade de controles em desktop/mobile, sem alterações funcionais inesperadas. | CA-10 |

## 6. Ferramentas e comandos

- Reutilizar os scripts existentes de lint, typecheck e build disponíveis no `package.json`; confirmar nomes antes de executar.
- Inspeção automatizada pode ajudar a localizar problemas, mas não substitui teclado, leitor de tela, medição de contraste e teste visual manual.
- Registrar limitações de ambiente ou dependências ausentes; não declarar critério validado quando apenas uma análise estática foi executada.

## 7. Conclusão

Considerar a implementação pronta para revisão quando os critérios CA-01 a CA-10 da SPEC tiverem evidência ou uma limitação explicitamente justificada, os fluxos existentes passarem regressão e o registro de contraste identificar temas/estados medidos. A investigação de OCR segue na WF-35 e não é condição para concluir esta entrega. Revisão humana, merge e deploy são etapas separadas.

**Medição preliminar de tokens (cálculo a partir dos valores OKLCH em `app/globals.css`, não medição de screenshot):** texto muted/fundo em tema claro 4,85:1; muted/fundo escuro 5,48:1; primary/fundo claro 5,15:1; primary/fundo escuro 4,93:1. Essas quatro combinações passam 4,5:1, mas não cobrem todos os tokens, cores personalizadas, estados, dimensões de texto ou foco. Portanto CA-08 permanece pendente até revisão completa renderizada.
