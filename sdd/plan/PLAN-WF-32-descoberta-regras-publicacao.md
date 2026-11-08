# Plano de descoberta — WF-32

**SPEC:** [SPEC-WF-32-regras-publicacao-responsabilidades.md](../spec/SPEC-WF-32-regras-publicacao-responsabilidades.md)  
**PBI:** [WF-32 — Definir regras de publicação, responsabilidades e ciclo de eventos](https://github.com/analiceleite/worship_flow/issues/28)  
**Estado:** Implementação e correções validadas localmente; revisão conjunta de cenários pendente
**Data:** 2026-11-07

## 1. Objetivo e limite

Consolidar as decisões de produto e orientar a implementação WF-32 autorizada pela solicitante. A revisão conjunta dos cenários e a aplicação da migração permanecem pendentes.

Implementação local autorizada. Não aplicar migrações remotas, não fazer deploy/publicação e não criar commit/push sem autorização.

## 2. Decisões aprovadas como baseline

- Somente admin publica ou despublica período.
- Períodos/eventos começam como rascunhos privados; publicação é explícita.
- Mudanças relevantes após publicação comunicam por e-mail; mudanças e despublicações sincronizam o calendário. Despublicação avisa as pessoas afetadas e remove os eventos dos calendários.
- Períodos não podem ter datas sobrepostas na mesma igreja; início e fim são inclusivos, e eventos devem estar dentro desse intervalo.
- Bloquear conflitos objetivos de horário para a mesma pessoa, sem bloquear múltiplas funções no mesmo evento ou atribuições em horários distintos.
- Função musical, perfil administrativo e responsabilidade pelo culto são dimensões distintas; há responsável designado por evento.
- Admin ou responsável designado pelo evento pode editar os dados do ensaio.
- Aprendiz pode participar da escala, mas não recebe autoridade administrativa por essa condição.
- Na saída da equipe, desativar acesso e preservar acervo/histórico.

As recomendações complementares também foram aprovadas: e-mails por mudança relevante aos escalados e ao líder; janela de conflito da chegada/ensaio ao fim previsto, com exceção administrativa justificada; líder designado por evento; admin marca aprendiz por atribuição/evento; transferência explícita de acervo somente por admin; eventos somente dentro de períodos; fuso por igreja com padrão `America/Sao_Paulo`; falha de integração não desfaz publicação e deve permitir retry sem duplicação. Admin cancela/reativa evento individual, preservando histórico, sincronizando calendário e avisando escalados. A revisão de cenários será feita conjuntamente com a solicitante, sem usuários reais, e não deve ser descrita como pesquisa com usuários.

## 3. Inspeção inicial e pontos a confirmar

As observações abaixo descrevem o código atual e não substituem decisões de produto:

| Referência | Estado observado / verificação necessária |
|---|---|
| `app/api/schedule/quarters/[id]/publish/route.ts` | A rota exige admin, alterna `is_published`, despublicar não enfileira e-mail de retirada e toda publicação tenta enviar notificações; confirmar semântica e efeitos no produto. |
| `components/schedule/BimesterForm.tsx` | O formulário sugere continuidade entre bimestres e calcula datas a partir do período existente; verificar validações de intervalo e sobreposição também no servidor. |
| `app/api/schedule/rehearsal/route.ts` | A rota permite edição a `admin` e `minister`, sem verificar designação como responsável pelo evento. |
| `lib/schedule/calendar-events.ts` | A lista de calendário agrupa funções por evento e consulta períodos da igreja; verificar como publicação/despublicação filtra ou reconcilia eventos em cada integração. |
| `lib/permissions.ts` e `lib/types.ts` | Confirmar o modelo atual de papéis, instrumentos, aprendiz e identidade de membro. Não presumir que uma string de instrumento represente liderança. |

Antes de encerrar, conferir também rotas de criação/edição de períodos, atribuições, comunicação por e-mail e integração de calendário para mapear efeitos reais sem ampliar o escopo da descoberta.

## 4. Etapas

### Fase 0 — Consolidar baseline e participantes

- [x] Registrar as decisões principais aprovadas na SPEC.
- [x] Identificar a solicitante como responsável por aprovar as regras; não há usuários reais disponíveis para validação externa.
- [ ] Conferir WF-31 e recolher evidências relevantes, sem tratar ausência de pesquisa como bloqueio automático.

**Saída:** participantes, baseline aprovado e perguntas residuais claramente separadas.

### Fase 1 — Mapear o fluxo atual

- [ ] Inspecionar criação/edição de período, atribuições, publicação/despublicação, ensaio, e-mail e calendário.
- [ ] Desenhar o fluxo atual do rascunho até a retirada, distinguindo comportamento observado de comportamento desejado.
- [ ] Registrar onde há validação no cliente, API e banco; apontar lacunas sem corrigi-las neste card.
- [ ] Confirmar como membros são desativados e como acervo/atribuições históricas permanecem associados.

**Saída:** mapa atual dos estados, transições, efeitos e permissões por igreja.

### Fase 2 — Fechar detalhes operacionais

- [x] Definir campos relevantes (publicação inicial, data, horário, escala e ensaio), destinatários (escalados e líder) e exclusão de mudanças cosméticas.
- [x] Definir despublicação, falhas de integração e retries sem duplicação; publicação permanece salva e admins recebem indicação da falha.
- [x] Definir janela de conflito como chegada/ensaio até término previsto; admin pode autorizar exceção com justificativa.
- [x] Definir líder designado por evento, entre integrantes ativos, e sua permissão para editar ensaio; sem líder, somente admin.
- [x] Definir que admin marca aprendiz por atribuição/evento, sem autoridade administrativa ou permissão adicional.
- [x] Definir transferência explícita de acervo somente por admin para integrante ativo, sem exclusão ou transferência automática.
- [x] Definir cancelamento/reativação individual por admin, preservando histórico, sincronizando calendário e avisando escalados.
- [x] Definir que eventos pertencem a período e que período inicia privado até publicação.
- [x] Definir fuso da igreja com padrão `America/Sao_Paulo`.
- [ ] Na futura inspeção técnica, confirmar suporte/configuração de fuso por igreja e tratamento de horários ambíguos.
- [ ] Revisar cenários de cancelamento/reativação individual separadamente da despublicação do período.

**Saída:** regras de produto aprovadas; detalhes técnicos e o fluxo de cancelamento individual ficam registrados para validação antes de qualquer implementação.

### Fase 3 — Validar cenários e permissões

- [ ] Percorrer cenários: criação privada, primeira publicação, alteração relevante, alteração cosmética, despublicação, re-publicação, cancelamento/reativação de evento e falha de notificação/sincronização.
- [ ] Validar datas: limites inclusivos, período sobreposto, evento fora do período e mudança de datas após publicação.
- [ ] Validar conflitos: mesma pessoa em eventos simultâneos, múltiplas funções no mesmo evento e eventos em horários diferentes.
- [ ] Validar matriz por admin, ministro escalado, ministro não escalado, mídia e aprendiz; conferir isolamento entre igrejas.
- [ ] Validar saída da equipe, revogação de acesso e preservação/transferência de histórico.
- [ ] Fazer revisão conjunta dos cenários com a solicitante; registrar explicitamente que não houve pesquisa/validação com usuários reais. Não usar dados reais ou sensíveis.

**Saída:** evidências de que as regras são compreensíveis e cobrem caminho principal, falhas e permissões relevantes.

### Fase 4 — Registrar resultado e atualizar backlog

- [x] Atualizar a SPEC com decisões aprovadas, data, aprovador e questões de revisão/implementação restantes.
- [x] Atualizar os critérios e a abordagem de validação da SPEC; não marcar aceite concluído sem evidência.
- [ ] Registrar evidências e resumo da decisão no card WF-32.
- [ ] Atualizar relações/dependências do backlog: separar bloqueios reais de cards apenas relacionados.
- [ ] Se houver implementação necessária, decompor em escopo técnico e obter aprovação antes de abrir execução.

## 8. Execução local autorizada (2026-11-07)

- [x] Adicionada migração `scripts/042_wf32_schedule_business_rules.sql` para fuso IANA por igreja, controles/cancelamento de evento, auditoria de exceções e transferência, proteção RLS de rascunhos e bloqueio de sobreposição.
- [x] Implementadas validações de período/evento, conflitos de horário com exceção justificada, designação de líder e autorização de ensaio.
- [x] Implementadas notificações de publicação/alteração/despublicação/cancelamento e reconciliação de calendário sem desfazer a operação principal.
- [x] Implementados cancelamento/reativação de evento, fuso configurável e transferência explícita de músicas via admin.
- [x] Testes focados de regras e de acesso à escala; typecheck aprovado.
- [x] Rever idempotência de outbox/notificações e testar correções no Postgres local (043, fila transacional, claim exclusivo, snapshot e chave de idempotência no provedor).
- [ ] Revisar conjuntamente cenários com a solicitante; não houve pesquisa com usuários reais.
- [x] Migração 042 aplicada somente ao banco local; implementação inicial registrada em `242a01f`. Correções 043 locais sem commit/push/deploy.

**Validação executada:** `pnpm exec tsc --noEmit --incremental false`, `pnpm test:schedule-media`, `pnpm test:notifications`, `pnpm test:repertoire` e `node --test tests/wf32.test.cjs` passaram. `pnpm lint` não executou porque o binário `eslint` não está instalado/disponível no ambiente.

### Correções após revisão (2026-11-08)

- Migração incremental `043_wf32_atomic_rules_and_notifications.sql`, preservando 042.
- Mutações de atribuição, importação, ensaio, controles e publicação via RPC server-only; identidade da célula é derivada do ID e divergências do payload são rejeitadas.
- Importação é atômica e valida igreja, atividade, função e conflitos; auditoria de exceção participa da mesma transação.
- Escrita direta de ensaio bloqueada por RLS restritiva; líder precisa estar ativo e escalado, inclusive quando tem perfil mídia. Remoção da última atribuição e suspensão revogam liderança no banco.
- Janela de conflito inclui ensaio candidato; edição de horário e reativação revalidam escalados. Lock transacional antes de leituras/escritas impede corridas entre mutações.
- Fila de e-mail gravada na mesma transação da mudança, inclusive despublicações; tentativas sem alteração voltam a processar pendências. Cron usa a revisão correta e nunca reinicia tentativas já gravadas.
- Claim exclusivo de e-mail, snapshot de entrega persistido e `Idempotency-Key` estável no provedor. Após 23h de entrega incerta ou mudança de destinatário após tentativa, bloquear reenvio automático e exigir conferência administrativa (limite do provedor: 24h).
- Exceção com justificativa disponível também para importação, ensaio e reativação na UI administrativa.
- `pnpm test:wf32:local`: regressões SQL com rollback e teste real com conexões concorrentes, mais claim único. Fixtures concorrentes removidas por UUID, sem reset ou alteração de dados preexistentes.
- Build de produção e typecheck separados aprovados. Entrega real por Resend/Google e navegação em browser não foram exercitadas nesta etapa; não há credenciais de integrações no ambiente de testes.

**Saída:** descoberta pronta para encerramento, ou lista explícita de pendências com responsáveis e próximo passo.

## 5. Matriz de validação

| Tema | Cenário mínimo | Critério da SPEC |
|---|---|---|
| Estados e primeiro acesso | Criar período, manter privado e publicar; observar o que cada perfil pode ver. | CA-01 |
| Responsabilidades | Distinguir função musical, admin e líder designado em cenários reais de decisão. | CA-02 |
| Comunicação | Publicação, mudança relevante, mudança cosmética e despublicação; conferir e-mail e calendário pretendidos. | CA-03 |
| Datas/conflitos | Limites inclusivos, sobreposição entre períodos e conflito simultâneo da mesma pessoa. | CA-04 |
| Aprendiz/ensaio | Aprendiz escalado sem autoridade; admin, líder designado e ministro não designado editando ensaio. | CA-04 |
| Saída da equipe | Desativar uma pessoa e conferir revogação de acesso sem perda do histórico/acervo definido. | CA-05 |
| Aprovação/evidência | Decisões aprovadas; pendências com responsáveis; backlog consistente. | CA-06, CA-07 |

## 6. Riscos e cuidados

- O modelo atual pode não representar líder de evento, aprendiz ou estado privado com a granularidade aprovada; não escolher desenho técnico durante esta descoberta.
- Publicar/despublicar já tem efeitos de e-mail e calendário. Mudanças de regra podem afetar integrações externas e precisam de tratamento de falha e idempotência antes de implementação.
- Sobreposição e conflito precisam de validação no servidor para não depender apenas da interface; registrar esse requisito técnico para o futuro card.
- Preservar histórico não significa manter acesso de quem saiu; validar separadamente retenção, propriedade e transferência de conteúdo.
- Regras precisam respeitar igreja/tenant e não revelar rascunhos ou dados de outra igreja.
- Não enviar e-mails reais nem alterar calendários de produção durante a descoberta.

## 7. Conclusão

### Evolução mobile-first do builder (2026-11-08)

- Agenda cronológica compacta com filtros de pendências, tipo e cancelamento; contagens consideram as células existentes e excluem cancelados do resumo ativo.
- Editor de um culto por vez no celular, com equipe, responsável e ensaio; agenda e editor lado a lado no desktop, preservando a visualização de grade.
- Contexto de período/evento/filtros na URL, usando histórico nativo integrado ao Next para evitar navegações de servidor a cada seleção. Voltar/recarregar preservam contexto.
- Seleção em painel amplo no celular, busca com debounce/cancelamento, estados de erro/vazio separados e tentativa de salvamento preservada. Não há indicação inventada de disponibilidade.
- Revisão explícita dos efeitos antes de publicar/despublicar; cancelamento confirmado no menu do culto. Funções vazias e ausência de líder continuam sendo avisos, não novas regras de bloqueio.
- Falhas e salvamentos pendentes impedem a revisão de publicação até resolução; opção de tentar novamente ou carregar os dados confirmados no servidor.
- Configurações de fuso e exclusão fora do fluxo principal; importação preservada com prévia; diálogo acessível substitui `window.prompt` nas exceções administrativas.
- Validação: testes de modelo/fluxo de conflito, typecheck e build; browser real a 360/390/430 px e desktop, com dados sintéticos e sem entrega externa. Cobertura de busca com erro/vazio, salvamento com retry, liderança, ensaio, conflito com justificativa, publicação, cancelamento, navegação por histórico e grade.
- Sem novas migrações ou mudanças nas permissões/regras WF-32. Alterações locais sem commit/push/deploy.

Concluir a WF-32 como descoberta quando a matriz de estados e transições, a matriz de responsabilidades e os efeitos de publicação/alteração estiverem aprovados, as regras de datas/conflitos/aprendiz/ensaio/saída estiverem explícitas, e evidências e dependências do backlog estiverem registradas. Questões sem consenso podem permanecer abertas apenas com responsável e próximo passo. Implementação, release e deploy são trabalhos separados e exigem autorização própria.
