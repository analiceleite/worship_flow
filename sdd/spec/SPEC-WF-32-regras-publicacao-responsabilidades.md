# SPEC — WF-32: Regras de publicação, responsabilidades e ciclo de eventos

**Status:** Decisões aprovadas; implementação local parcial; revisão conjunta de cenários pendente  
**PBI:** [WF-32 — Definir regras de publicação, responsabilidades e ciclo de eventos](https://github.com/analiceleite/worship_flow/issues/28)  
**Prioridade:** P1 — Alta  
**Área:** Produto e pesquisa  
**Natureza:** Descoberta  
**Data:** 2026-11-07

## 1. Contexto e problema

Os conceitos de publicação, liderança, aprendizagem, período e alteração podem produzir efeitos diferentes entre módulos. Sem regras de negócio explícitas, mudanças de interface correm o risco de apenas expor comportamentos divergentes.

Esta SPEC organiza as decisões a serem alinhadas com a pessoa responsável pelo produto. As referências de código são pontos de investigação, não evidência de problema em produção nem confirmação de comportamento esperado.

**Pessoas impactadas:** liderança, organizadores, administradores e equipe.

## 2. Objetivos

- Definir estados e transições para períodos e eventos, incluindo primeiro acesso.
- Distinguir função musical, papel administrativo e responsabilidade pelo culto.
- Estabelecer efeitos e permissões para publicar, despublicar, alterar e cancelar eventos.
- Resolver regras de calendário, conflitos, ensaios, aprendizes e saída de integrantes.
- Registrar decisões aprovadas, evidências e questões ainda sem resposta, com responsáveis.

## 3. Escopo e limites

**Incluído nesta descoberta:** alinhamento de produto e documentação das regras, matriz de responsabilidades e efeitos nos módulos afetados.

**Fora de escopo:** alterar código ou dados, escolher soluções técnicas antes das decisões de negócio, e tratar hipóteses da auditoria estática como problemas confirmados. A descoberta termina com decisões e evidências; não inicia implementação automaticamente.

## 4. Referências para inspeção

Conferir a implementação atual antes de formular ou validar decisões:

- `app/api/schedule/quarters/[id]/publish/route.ts`
- `lib/schedule/calendar-events.ts`
- `lib/permissions.ts`
- `components/schedule/BimesterForm.tsx`
- `app/api/schedule/rehearsal/route.ts`

## 5. Decisões de produto a registrar

As matrizes abaixo registram as regras aprovadas e orientam a revisão dos cenários. Comportamentos técnicos atuais devem ser verificados separadamente; não são prova de que a regra já está implementada.

### 5.1 Estados e transições

| Entidade/contexto | Estado | Ação/transição | Quem pode executar | Efeito esperado | Decisão/evidência |
|---|---|---|---|---|---|
| Período | Rascunho privado | Criar / primeiro acesso | Admin cria; somente admins veem | Continua privado até publicação explícita | Aprovada; detalhar cenários na revisão |
| Período | Publicado | Publicar / despublicar | Somente admin | Publicar libera para perfis já autorizados; despublicar avisa afetados e remove eventos do calendário | Aprovada; conferir efeitos reais nas integrações |
| Evento/ensaio | Publicado | Alterar / cancelar / reativar | Admin cancela ou reativa; admin ou líder designado altera ensaio | Cancelamento preserva histórico, remove do calendário e avisa escalados; reativação reinclui no calendário e avisa novamente | Aprovada; revisar cenário |

Registrar estados válidos, pré-condições, reversibilidade e o que ocorre quando uma transição falha ou é repetida.

### 5.2 Papéis e responsabilidades

| Contexto | Função musical | Papel administrativo | Responsável pelo culto | Permissões/limites | Decisão |
|---|---|---|---|---|---|
| Planejamento de período | Separada da liderança | Admin | Líder designado por evento, integrante ativo | Não confundir instrumento/função musical com papel admin ou liderança | Aprovada |
| Publicação e comunicação | Não concede publicação | Somente admin | Líder recebe avisos se afetado | Notificações aos escalados do evento e ao líder designado | Aprovada |
| Edição de ensaio | Não concede edição por si só | Admin | Líder designado do evento | Se não houver líder designado, somente admin edita | Aprovada |

Não presumir que liderança musical, administração do sistema e responsabilidade pelo culto sejam a mesma função.

### 5.3 Regras transversais

| Tema | Pergunta a decidir | Decisão aprovada | Responsável/evidência |
|---|---|---|---|
| Publicação e despublicação | Quem publica/retira e quais são os efeitos? | Aprovado na seção 5.4 | Produto; revisão conjunta pendente |
| Alterações | O que notificar e para quem? | Aprovado na seção 5.4 | Produto; revisão conjunta pendente |
| Datas e períodos | Como tratar limites, sobreposição e eventos fora do período? | Aprovado na seção 5.4 | Produto; revisão conjunta pendente |
| Conflitos | O que bloqueia e como tratar exceções? | Aprovado na seção 5.4 | Produto; revisão conjunta pendente |
| Aprendiz | Qual condição e quem pode atribuí-la? | Aprovado na seção 5.4 | Produto; revisão conjunta pendente |
| Ensaio | Quem edita e o que ocorre se não houver líder? | Aprovado na seção 5.4 | Produto; revisão conjunta pendente |
| Saída de integrante | Como revogar acesso e preservar/transferir acervo? | Aprovado na seção 5.4 | Produto; revisão conjunta pendente |
| Primeiro acesso | Estado inicial do período/evento | Aprovado na seção 5.4 | Produto; revisão conjunta pendente |

### 5.4 Decisões aprovadas

| Tema | Decisão | Efeito esperado |
|---|---|---|
| Publicação | Somente admin publica ou despublica um período. | Mantém publicação como ação administrativa explícita. |
| Estado inicial | Período/evento recém-criado fica em rascunho privado até publicação explícita. | Apenas admins veem o rascunho; publicar torna a escala visível aos perfis já autorizados. |
| Alterações publicadas | Notificar por e-mail mudanças relevantes; sincronizar mudanças e retiradas no calendário. | Mudanças cosméticas não geram e-mail. Na despublicação, avisar afetados e remover eventos dos calendários. |
| Mudanças relevantes e destinatários | Notificar publicação inicial e mudanças de data, horário, escala ou dados de ensaio. | Enviar às pessoas escaladas no evento afetado e ao líder designado; mudanças de nome/descrição não notificam. |
| Falha de integração | Não desfazer publicação por falha de e-mail ou calendário. | Manter a alteração, permitir novas tentativas e informar admins sobre falhas; retries não devem duplicar e-mails. |
| Períodos | Bloquear sobreposição de datas entre períodos da mesma igreja. | Limites inicial e final são inclusivos. |
| Datas de eventos | Eventos devem ficar dentro dos limites inclusivos do período. | Validar horários no fuso local da igreja. |
| Conflitos | Bloquear conflito objetivo de horário para a mesma pessoa. | Não bloquear automaticamente designações múltiplas em horários diferentes ou múltiplas funções no mesmo evento. |
| Janela de conflito | Comparar os intervalos dos eventos, da chegada/ensaio ao término previsto do culto. | Interseção bloqueia; admin pode abrir exceção com justificativa registrada. |
| Responsabilidades | Função musical, papel administrativo e responsabilidade pelo culto são dimensões distintas. | Designar um líder/responsável por evento; não inferir liderança a partir de instrumento ou papel admin. |
| Edição de ensaio | Admin ou líder designado daquele evento pode editar seus dados de ensaio. | A condição atual de qualquer perfil minister não é a regra pretendida. |
| Cancelamento individual | Somente admin cancela ou reativa evento individual. | Cancelamento preserva atribuições/histórico, retira evento do calendário e avisa escalados; reativação reinclui no calendário e avisa novamente. |
| Aprendiz | Admin marca/remover a condição por atribuição/evento. | Participante sem autoridade administrativa; não altera permissões da conta nem é inferido automaticamente. |
| Designação de liderança | Líder é designado por evento entre integrantes ativos. | Não criar autoridade por instrumento ou perfil minister; aprendiz também não recebe autoridade. |
| Saída da equipe | Desativar acesso e preservar acervo/histórico. | Avaliar transferência de propriedade de conteúdo, se necessária, sem apagar atribuições históricas. |
| Transferência de acervo | Manter músicas/acervo associados à pessoa desativada até transferência explícita. | Somente admin transfere para integrante ativo; registrar a transferência e nunca excluir/transferir automaticamente. |
| Eventos fora de período | Não permitir; criar primeiro um período. | Novo período começa privado e segue publicação explícita. |
| Fuso horário | Usar fuso configurado para a igreja; padrão inicial `America/Sao_Paulo`. | Datas e horários não devem depender do fuso do dispositivo do usuário. |

**Aprovadas pela pessoa solicitante em 2026-11-07**, incluindo as recomendações complementares de e-mail, conflitos, representação de liderança/aprendiz, transferência do acervo, eventos fora de período, fuso e falhas de integração. A implementação local foi posteriormente autorizada; a migração não foi aplicada e ainda falta revisão conjunta dos cenários.

### 5.5 Detalhes ainda a validar

- Revisar conjuntamente os cenários da seção 8 e registrar quais foram aprovados; não há usuários reais disponíveis e não se deve caracterizar esta revisão como pesquisa com usuários.
- Na etapa técnica futura, confirmar como representar o fuso por igreja (com padrão `America/Sao_Paulo`), retries idempotentes de notificações/calendário e designação de líder/aprendiz; a SPEC define o resultado esperado, não a solução de implementação.
- Revisar conjuntamente o cancelamento/reativação de evento individual, distinguindo-o da despublicação de um período inteiro.

## 6. Requisitos da descoberta

- RD-01: Conduzir alinhamento curto com a pessoa responsável pelo produto antes de fechar regras.
- RD-02: Registrar a tabela de estados/transições e a matriz de papéis por contexto.
- RD-03: Definir efeitos de publicação, despublicação e alteração na interface, e-mail e calendário.
- RD-04: Registrar decisões sobre datas, períodos sobrepostos, conflitos, aprendiz e edição de ensaio.
- RD-05: Definir como a saída de integrante afeta acesso, acervo e histórico.
- RD-06: Atualizar dependências do backlog após aprovação; toda dúvida remanescente deve ter responsável.
- RD-07: Não realizar alterações de código como consequência automática desta descoberta.

## 7. Critérios de aceite

- [ ] Existe tabela aprovada de estados e transições para período/evento e primeiro acesso.
- [ ] A matriz distingue função musical, papel administrativo e responsabilidade pelo culto.
- [ ] Publicação, despublicação e alteração têm efeitos definidos na interface, e-mail e calendário.
- [ ] Há decisão sobre datas, períodos sobrepostos, conflitos, aprendiz e permissão para editar ensaio.
- [ ] A saída de integrante e a preservação de acervo/histórico têm regra explícita.
- [ ] Decisões foram aprovadas e dependências do backlog atualizadas; dúvidas restantes têm responsável.
- [ ] Evidências e validação estão registradas sem dados reais ou detalhes sensíveis.
- [ ] Nenhuma implementação foi iniciada sem escopo e decisão explícitos.

## 8. Validação e evidências

Como não há usuários reais disponíveis, validar as regras por revisão conjunta entre a solicitante e o agente, percorrendo cenários de caminho principal, falhas e permissões. Registrar explicitamente que é revisão de produto, não pesquisa ou validação com usuários. Conferir a implementação atual para separar comportamento existente de decisão futura. Anexar ao card ou comentário as decisões, cenários revisados e pendências com responsáveis. Considerar mobile e acessibilidade se a validação envolver interface.

## 9. Dependências e relações

- [WF-31 — Validar jornadas principais com usuários reais e testes de usabilidade](https://github.com/analiceleite/worship_flow/issues/27): consultar descobertas disponíveis, sem bloquear correções inequívocas.
- [WF-34 — Versões e comunicação de melhorias](SPEC-WF-34-release-notes.md): relacionada às responsabilidades de publicação das notas de release; não altera o escopo desta descoberta sobre o ciclo de eventos.

## 10. Registro de decisões

- **2026-11-07 — Criação:** SPEC elaborada a partir da issue WF-32. As tabelas são propostas para coleta de decisões; nenhuma regra de produto foi presumida como aprovada e nenhuma alteração funcional foi realizada.
- **2026-11-07 — Decisões de produto:** pessoa solicitante aprovou publicação somente por admin; rascunho privado até publicação; aviso por e-mail para mudanças relevantes e sincronização do calendário; bloqueio de sobreposição de períodos e de conflitos objetivos de horário; datas inclusivas e eventos dentro do período; responsabilidade separada por evento; edição de ensaio por admin ou líder designado; aprendiz como participante sem autoridade; e desativação de acesso preservando acervo/histórico. Detalhamentos operacionais permanecem listados na seção 5.5.
- **2026-11-07 — Recomendações complementares aprovadas:** notificar publicação inicial e mudanças de data/horário/escala/ensaio às pessoas escaladas e ao líder; não notificar mudanças cosméticas; na falha de e-mail/calendário, preservar a publicação, informar admins e permitir retries sem duplicação; conflito usa intervalo de chegada/ensaio até término previsto e exceção admin justificada; líder é designado por evento entre integrantes ativos; aprendiz é condição da participação por evento; transferência de acervo deve ser explícita, sem exclusão/transferência automática; eventos fora de período não são permitidos; fuso por igreja com padrão `America/Sao_Paulo`. Revisão conjunta sem usuários reais ainda pendente; nenhuma implementação foi iniciada.
- **2026-11-07 — Fechamento das regras de cancelamento e saída:** somente admin cancela/reativa evento individual; cancelamento preserva histórico, remove do calendário e avisa escalados; reativação restaura calendário e notifica novamente. Somente admin transfere acervo, explicitamente e para integrante ativo, com registro. Admin marca a condição de aprendiz por atribuição/evento, sem alterar permissões. Revisão conjunta de cenários ainda pendente.
- **2026-11-07 — Implementação local iniciada:** adicionados migration 042, validações server-side e UI de líder/cancelamento, integração de notificações/calendário, configuração de fuso e transferência explícita de músicas. Typecheck e testes focados passaram; lint indisponível por falta do executável ESLint. Migração ainda não aplicada em banco.
