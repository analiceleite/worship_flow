# SPEC — WF-16: Corrigir barreiras de acessibilidade e operação por toque

**Status:** Implementação inicial em andamento; validação manual e revisão completa de contraste pendentes

**PBI:** [WF-16 — Corrigir barreiras de acessibilidade e operação por toque](https://github.com/analiceleite/worship_flow/issues/12)

**Branch:** `fix/wf-16-acessibilidade-toque`

**Prioridade:** P1 — Alta

**Área:** UX e acessibilidade · Correção

**Data:** 2026-11-07

**Plano:** [PLAN-WF-16-implementation.md](../plan/PLAN-WF-16-implementation.md)

## 1. Contexto e problema

A auditoria estática identificou possíveis barreiras nas tarefas principais: botões somente com ícones sem nome acessível, rótulos sem associação explícita, seleções sem estado semântico, alvos de toque pequenos e visualização de PDFs em canvas sem camada textual. Contraste e comportamento real precisam ser verificados antes de confirmar cada ocorrência.

**Pessoas impactadas:** usuários em dispositivos móveis, pessoas que navegam por teclado e usuários de tecnologias assistivas.

As evidências abaixo vêm de inspeção estática e não demonstram ocorrência em produção nem frequência medida.

## 2. Evidências iniciais

| Local | Ponto a verificar |
|---|---|
| `components/ui/button.tsx:24–29` | Variantes e dimensões dos botões, inclusive alvos de toque. |
| `app/repertoire/page.tsx:952–958,1001–1005` | Ações por ícone e estados de seleção na jornada de repertório. |
| `app/users/page.tsx:209–226` | Associação de rótulos e controles na gestão de usuários. |
| `app/profile/page.tsx:249–261` | Associação de rótulos e controles no perfil. |
| `components/minister-form.tsx:254–289` | Associação de rótulos, erros e campos do formulário. |
| `components/pdf-scroll-viewer.tsx:181–250` | Conteúdo do PDF renderizado em canvas e alternativas acessíveis. |

As referências são pontos de partida e devem ser confirmadas no código e na interface renderizada antes da implementação.

## 3. Objetivos

- Tornar as ações frequentes identificáveis e operáveis sem mouse.
- Melhorar foco, associação de rótulos/erros e comunicação semântica de estados.
- Tornar os alvos de toque frequentes confortáveis, buscando 44 × 44 CSS pixels quando viável.
- Verificar contraste nos temas disponíveis e documentar limites da acessibilidade de PDFs.
- Preservar o comportamento funcional existente, corrigindo as barreiras identificadas sem redesenho amplo.

## 4. Escopo e limites

**Incluído:** auditoria e correções nas jornadas principais de repertório, formulários de perfil/usuários e controles reutilizáveis afetados; nomes acessíveis; rótulos e mensagens de erro; estados de seleção; foco de teclado e retorno de foco em diálogos; dimensões efetivas dos alvos de toque; medição e correção de contraste renderizado nos temas. Para PDFs, esta SPEC cobre apenas a confirmação e documentação da limitação atual e o encaminhamento para investigação separada.

**Fora de escopo:** redesenho geral da aplicação, mudanças funcionais de repertório ou permissões, promessa de suporte offline a PDFs, substituição integral do visualizador sem avaliação técnica, e remediação de documentos PDF de origem que não estejam sob controle do sistema.

## 5. Requisitos de experiência e acessibilidade

### 5.1. Ações, teclado e foco

- Toda ação frequente deve possuir nome acessível que descreva sua finalidade; ícones decorativos não devem ser anunciados como conteúdo redundante.
- Ações disponíveis por ponteiro devem ser operáveis por teclado, com ordem de navegação coerente.
- O indicador de foco deve permanecer visível nos temas suportados e não pode depender apenas de mudança sutil de cor.
- Ao fechar diálogo ou sobreposição, o foco deve retornar ao controle que a abriu, salvo quando esse controle deixou de existir; nesse caso, mover o foco para um destino lógico.
- Não remover contorno de foco sem substituição equivalente.

### 5.2. Formulários e estados

- Associar programaticamente cada rótulo ao controle correspondente.
- Associar instruções e erros ao campo afetado; erros devem ser perceptíveis sem depender apenas de cor.
- Comunicar semanticamente o estado de seleção, expansão, alternância e desabilitação dos controles interativos.
- Preservar valores e contexto do formulário quando uma validação falhar, conforme o comportamento vigente.

### 5.3. Toque e layout

- Alvos de ações frequentes devem buscar pelo menos 44 × 44 CSS pixels de área efetiva, sem exigir precisão fina.
- Quando o tamanho visual do ícone for menor, a área interativa pode ser ampliada sem distorcer o layout ou sobrepor ações vizinhas.
- A interface deve continuar utilizável em largura de 360px, com zoom de 200% e teclado virtual aberto, sem perda de ações essenciais ou rolagem horizontal indevida.

### 5.4. Contraste

- Medir contraste de texto, ícones funcionais, foco e componentes nos temas disponíveis usando cores efetivamente renderizadas.
- Corrigir nesta entrega as combinações que não atingirem os critérios aplicáveis, limitando as mudanças às telas e componentes afetados e preservando os temas existentes.
- Registrar método, estados e temas verificados, além de exceções que não puderem ser resolvidas sem decisão de produto ou mudança de escopo.

### 5.5. PDFs

- Confirmar e documentar se o visualizador atual fornece camada textual acessível; não implementar OCR nem uma alternativa de conversão nesta SPEC.
- Encaminhar a avaliação de extração textual/OCR, precisão musical e alternativas para [WF-35 — Avaliar alternativa acessível por texto/OCR para cifras em PDF](https://github.com/analiceleite/worship_flow/issues/39).
- A pendência de PDF não bloqueia as correções de interface, teclado, toque ou contraste desta SPEC.

## 6. Critérios de aceite

- [ ] **CA-01 — Nomes acessíveis:** ações frequentes, inclusive botões somente com ícone, têm nome acessível compreensível.
- [ ] **CA-02 — Teclado:** tarefas principais podem ser concluídas por teclado, com ordem coerente e sem armadilhas de foco.
- [ ] **CA-03 — Foco e diálogos:** foco visível durante a navegação e retorno ao local esperado ao fechar diálogos.
- [ ] **CA-04 — Formulários:** rótulos, instruções e erros estão associados aos controles; estados de seleção são expostos semanticamente.
- [ ] **CA-05 — Toque:** alvos frequentes têm área efetiva confortável, buscando 44 × 44 CSS pixels, sem depender de precisão fina.
- [ ] **CA-06 — Responsividade:** validar tarefas principais em 360px, zoom de 200% e com teclado virtual aberto.
- [ ] **CA-07 — Leitor de tela:** validar nomes, funções, estados e mensagens relevantes com tecnologia assistiva; registrar combinação de navegador/leitor usada.
- [ ] **CA-08 — Contraste:** contraste foi medido nos temas e estados disponíveis; falhas confirmadas foram corrigidas nesta entrega ou justificadas como pendência com evidência.
- [ ] **CA-09 — PDF:** limitação textual do visualizador foi confirmada/documentada e encaminhada à WF-35; OCR ou conversão não fazem parte desta entrega.
- [ ] **CA-10 — Regressão:** fluxos existentes continuam funcionais em desktop e mobile e não há regressão visual que oculte controles.

## 7. Validação

Validar com dados não sensíveis e percorrer, no mínimo, seleção/abertura de repertório, ações por ícone, envio de formulários e abertura/fechamento de diálogo. Executar navegação por teclado e leitor de tela, além das verificações de dimensão, zoom e contraste descritas nos critérios. Registrar navegador/dispositivo, evidências e limitações no relatório de validação ou PR. Inspeção automatizada isolada não equivale à validação manual.

## 8. Diretrizes para o plano técnico

- Conferir os componentes compartilhados antes de adicionar correções locais; evitar alterações globais de dimensão que quebrem densidade ou layout sem verificação das telas afetadas.
- Priorizar semântica nativa e atributos acessíveis suportados, sem duplicar anúncios para leitores de tela.
- Manter as mensagens de erro junto ao campo e assegurar que sejam anunciadas quando necessário.
- Medir as cores finais após aplicação dos temas e estados (hover, selecionado, foco e desabilitado), não apenas os tokens em isolamento.
- Não tratar canvas como texto acessível; confirmar capacidades do visualizador e a viabilidade da alternativa antes de escolher implementação.
- Limitar mudanças às barreiras confirmadas e documentar problemas que exijam decisões de produto ou infraestrutura.

## 9. Dependências e relações

- [WF-31 — Validar jornadas principais com usuários reais e testes de usabilidade](https://github.com/analiceleite/worship_flow/issues/27): relacionada; correções semânticas evidentes podem iniciar sem pesquisa, conforme a issue.
- [WF-15 — Padronizar estados de erro, vazio, carregamento e salvamento](https://github.com/analiceleite/worship_flow/issues/11): coordenar mensagens e estados, sem ampliar esta entrega para uma padronização transversal.
- [WF-35 — Avaliar alternativa acessível por texto/OCR para cifras em PDF](https://github.com/analiceleite/worship_flow/issues/39): investigação separada; não bloqueia a entrega da WF-16.

## 10. Registro de decisões

- **2026-11-07 — Criação:** SPEC inicial elaborada a partir da issue #12 e das evidências estáticas nela listadas. Nenhuma alteração funcional foi realizada nesta etapa.
- **2026-11-07 — Ajuste de escopo:** contraste passa a ser medido e corrigido nesta SPEC. A investigação de alternativa textual/OCR para cifras em PDF foi separada na WF-35 e não bloqueia as demais correções de acessibilidade.
- **2026-11-07 — Implementação inicial:** adicionados nomes/estados semânticos, alvos de toque ampliados, associações de controles e foco mais visível nos componentes e jornadas identificados. TypeScript, build e testes existentes de repertório passaram; lint indisponível. Validação manual, inspeção do PDF e medição completa de contraste permanecem pendentes; consultar o [plano de implementação](../plan/PLAN-WF-16-implementation.md).
