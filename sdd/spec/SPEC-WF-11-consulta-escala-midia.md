# SPEC — WF-11: Consulta da escala pelo perfil Mídia

**Status:** Implementado e validado automaticamente em ambiente local; revisão humana e implantação pendentes

**PBI:** [WF-11 — Permitir que mídia consulte seus compromissos na escala](https://github.com/analiceleite/worship_flow/issues/7)

**Branch:** `fix/wf-11-consulta-escala-midia`

**Prioridade:** P1 — Alta

**Área:** Escalas · Correção

**Data:** 2026-11-06

**Implementação:** [PLAN](../plan/PLAN-WF-11-implementation.md) · [Evidências e pendências](../plan/WF-11-validation.md). O checklist de aceite permanece sujeito à revisão humana; resultados automatizados não equivalem a aprovação de implantação.

## 1. Contexto e problema

O sistema permite atribuir usuários do perfil `midia` à função de Sonoplasta, mas impede que esse perfil abra a página da escala. O menu também oculta esse destino. Assim, uma pessoa pode receber uma atribuição e um aviso com link para uma tela que não consegue consultar.

**Pessoas impactadas:** sonoplastas, demais integrantes de mídia e administradores responsáveis pela escala.

As evidências são de inspeção estática do repositório. Não comprovam ocorrência em produção nem frequência medida de reclamações.

## 2. Evidências na implementação atual

| Local | Comportamento observado |
|---|---|
| `app/api/schedule/assignment/route.ts:70–83` | Atribuições de categoria `midia` aceitam apenas integrantes desse perfil. |
| `middleware.ts:144–169` | Rotas administrativas exigem administrador; a lista permitida para mídia não inclui `/schedule`. |
| `components/header.tsx:181–182` | Navegação principal de mídia fica restrita ao repertório. |
| `app/api/schedule/current/route.ts:27–75` | Consulta usa contexto autenticado e igreja efetiva, retornando a escala publicada e o perfil do usuário. Não exige papel administrativo nessa leitura. |
| `app/schedule/page.tsx:176–182,227–234` | A tela já identifica atribuições pessoais; edição de ensaio é condicionada aos perfis administrador ou ministro. |
| `app/schedule/page.tsx:148–170,378–399` | Falha na consulta de ensaios é tratada como ausência; falha da consulta principal pode coexistir com mensagem de nenhuma escala publicada. |
| `lib/notifications/schedule-email.ts:426` | Avisos usam `ROUTES.SCHEDULE` como destino. |

As linhas são referências da revisão inicial e podem mudar. Autorizações das APIs de escrita e políticas de banco devem ser conferidas no plano técnico; ocultar controles não garante segurança.

## 3. Objetivos

- Permitir que mídia consulte a escala publicada e identifique suas atribuições sem intermediação do administrador.
- Tornar menu, acesso direto e links dos avisos coerentes com essa permissão de leitura.
- Disponibilizar data, função, horários e informações de preparação já existentes no sistema.
- Preservar restrições de edição e isolamento entre igrejas.
- Distinguir ausência de publicação, ausência de atribuição e falha de carregamento.

## 4. Escopo e limites

**Incluído:** permissão de consulta de `/schedule`, navegação desktop e móvel, identificação de atribuições pessoais, leitura dos dados de preparação disponíveis, estados da tela e validação de autorização dos recursos utilizados nessa jornada.

**Fora de escopo:** edição por mídia, publicação de escalas, confirmação ou recusa de participação, trocas de integrantes, novas notificações, redesenho geral, calendário Google, consulta de rascunhos e unificação definitiva de evento/equipe/repertório.

Não alterar o destino inicial de login de mídia, atualmente repertório, apenas para introduzir essa consulta. Não criar uma nova identidade de evento ou uma nova rota de detalhe neste card.

## 5. Regras funcionais

### 5.1. Acesso e navegação

- Usuário autenticado com perfil `midia` deve encontrar a opção de escala no menu, tanto em desktop quanto em celular.
- Acesso direto a `/schedule`, inclusive pelo destino usado nos avisos, deve abrir a consulta sem redirecionar para repertório por causa do perfil.
- Não liberar genericamente `/schedule/*`: rotas de `/schedule/admin` continuam exclusivas de administrador, inclusive por URL direta.
- Preservar autenticação e fluxo vigente de login. Não incluir persistência de destino após login sem refinamento específico; testar o link autenticado e a proteção quando a sessão estiver ausente ou expirada.
- Preservar acesso existente a repertório e perfil, sem ampliar outras permissões do papel.

### 5.2. Conteúdo consultável

- Exibir somente a escala publicada elegível conforme o comportamento vigente da consulta, dentro da igreja efetiva.
- Identificar atribuições pessoais pelo ID do integrante autenticado, não por nome nem por valores enviados pelo navegador.
- Para cada compromisso pessoal apresentado, permitir identificar data e função; exibir horários e informações de ensaio/local quando cadastrados e pertinentes à ocorrência.
- Não inventar horários nem apresentar informação ausente como confirmada. O plano deve verificar as fontes atuais de horário e limitar eventuais ajustes ao necessário para essa consulta.
- Não transformar ensaio em data distinta em horário de chegada no dia do culto.
- Mídia pode consultar toda a escala publicada da própria igreja, incluindo equipe e atribuições dos demais integrantes, e acessar a visão pessoal. Não incluir dados administrativos adicionais nem rascunhos.
- Ao entrar em `/schedule` com perfil `midia`, abrir a visão “Meus compromissos”, mantendo a visão geral disponível por seleção explícita. Não alterar a visão inicial dos demais perfis nesta entrega.
- Se não houver atribuições pessoais, manter a visão pessoal com mensagem clara e acesso à visão geral; não trocar de visão silenciosamente.

### 5.3. Somente leitura e isolamento

- Mídia não recebe controles de criação, edição, importação, exclusão, publicação ou alteração de ensaios e atribuições. A regra de somente leitura aplica-se à gestão da escala e dos ensaios; não remove ações já permitidas em outros módulos, como atualização do próprio perfil.
- Chamadas diretas de escrita de gestão da escala e dos ensaios feitas por mídia devem ser recusadas também no servidor/banco, sem efeitos persistidos. Consultar a visão geral não concede permissão de escrita.
- Consultas principal e auxiliares devem respeitar a igreja efetiva; IDs de outra igreja não podem ampliar o acesso.
- Usar o contexto de igreja/impersonação já existente, sem criar mecanismo paralelo de seleção de tenant.
- Preservar as permissões vigentes dos perfis administrador e ministro.

### 5.4. Estados e recuperação

- **Carregando:** informar que a escala está sendo obtida, sem antecipar estado vazio.
- **Sem escala publicada:** comunicar ausência de publicação, sem sugerir uma ação administrativa para mídia.
- **Sem atribuição pessoal:** com publicação existente, informar que não há atribuições para a pessoa no período consultado; isso não significa ausência de escala da igreja.
- **Sem próximos compromissos:** se a visão pessoal filtrar datas passadas, distinguir ausência de compromissos futuros de ausência de qualquer atribuição no período.
- **Erro de consulta:** apresentar falha e permitir tentar novamente; não mostrar como ausência de publicação ou de atribuição confirmada.
- **Falha em dados auxiliares:** manter a escala consultável quando possível e indicar que informações de preparação não puderam ser carregadas, sem afirmar que não foram cadastradas.

## 6. Decisões de produto aprovadas

| ID | Decisão | Regra aprovada | Estado |
|---|---|---|---|
| D-01 | Abrangência da consulta por mídia | Toda a escala publicada da própria igreja, incluindo equipe e atribuições, com visão geral e pessoal; sem rascunhos, dados administrativos adicionais ou edição. | Aprovada |
| D-02 | Visão inicial da página de escala para mídia | Abrir “Meus compromissos”, com acesso à visão geral. Sem atribuições, manter mensagem na visão pessoal, sem troca automática. O destino inicial após login continua sendo repertório. | Aprovada |

Decisões aprovadas pelo usuário em 2026-11-06. Não há decisões de produto bloqueadoras restantes nem dependência técnica obrigatória declarada na issue. O WF-32 permanece relacionado para manter a matriz de responsabilidades coerente, sem exigir sua conclusão para esta entrega.

## 7. Critérios de aceite e validação

Usar dados fictícios de duas igrejas, com usuários administrador, ministro e mídia. Preparar publicação com atribuição de Sonoplasta, usuário de mídia sem atribuições, igreja sem publicação e informações de preparação presentes e ausentes.

- [ ] **CA-01 — Menu e URL:** mídia acessa a escala pelo menu desktop, menu móvel e URL direta, sem redirecionamento indevido.
- [ ] **CA-02 — Link do aviso:** o destino usado pelo e-mail abre a consulta para mídia autenticada; acesso sem sessão continua protegido. Não exigir disparo de e-mails reais para validar o link.
- [ ] **CA-03 — Compromisso:** a pessoa identifica sua data, função e informações de horário/preparação disponíveis, sem atribuições de homônimos ou confusão entre ensaio e culto.
- [ ] **CA-04 — Visibilidade e entrada:** mídia abre a escala em “Meus compromissos” e pode alternar para toda a escala publicada da própria igreja. Sem atribuições pessoais, vê mensagem clara e acesso à visão geral, sem troca automática. Administrador e ministro mantêm a visão inicial vigente.
- [ ] **CA-05 — Sem publicação:** ausência de escala publicada tem mensagem própria e não exibe rascunhos.
- [ ] **CA-06 — Sem atribuição:** publicação sem atribuição pessoal não é apresentada como ausência de escala; o recorte de compromissos futuros fica claro.
- [ ] **CA-07 — Falhas:** erro da consulta principal permite nova tentativa e não produz falso vazio; falha de preparação é distinguida de dado não cadastrado.
- [ ] **CA-08 — Somente leitura:** mídia não vê controles de gestão da escala ou dos ensaios; acesso direto a rotas administrativas e requisições de escrita desses recursos são recusados sem alteração de dados. Ações já autorizadas em outros módulos são preservadas.
- [ ] **CA-09 — Isolamento:** consultas principal e auxiliares não expõem dados de outra igreja, inclusive com IDs manipulados.
- [ ] **CA-10 — Regressão:** administrador e ministro mantêm suas permissões; mídia mantém acesso a repertório/perfil e seu destino inicial de login.
- [ ] **CA-11 — Mobile e acessibilidade:** validar em largura de 360px e desktop; menu e consulta funcionam por teclado, com nomes acessíveis, foco visível e mensagens perceptíveis.

Cobrir regras de acesso/navegação com testes automatizados, autorização e isolamento com testes de integração e a jornada com validação no navegador. Registrar evidências e limitações no PR sem dados reais. Nenhum critério está validado pela simples criação desta SPEC.

## 8. Diretrizes para o plano técnico

- Revisar middleware e filtro de navegação de forma coordenada, liberando a rota de consulta sem liberar a árvore administrativa.
- Inventariar chamadas usadas por `/schedule`, incluindo ensaios e fontes de horários, conferindo autorização e isolamento de cada uma.
- Avaliar reaproveitamento da consulta existente antes de propor endpoints, tabelas ou migrações; qualquer necessidade deve ser justificada no plano.
- Aplicar D-01 na leitura do servidor: permitir a escala publicada completa da igreja efetiva, sem ampliar acesso a outras igrejas, rascunhos ou dados administrativos.
- Verificar APIs de escrita relacionadas e manter sua autorização independente dos controles visuais.
- Limitar correções de estados à jornada da escala; a padronização transversal pertence ao WF-15.
- Não alterar envio, fila ou conteúdo dos e-mails além de eventual compatibilidade necessária do destino existente.

## 9. Dependências e relações

- [WF-32 — Regras de publicação e responsabilidades](https://github.com/analiceleite/worship_flow/issues/28): validar abrangência da consulta por mídia, sem ampliar o card para redefinir o ciclo de publicação.
- [WF-15 — Estados de erro, vazio e carregamento](https://github.com/analiceleite/worship_flow/issues/11): coordenar padrões; correções locais não dependem da entrega completa.
- [WF-17 — Contexto único de culto, equipe, ensaio e repertório](https://github.com/analiceleite/worship_flow/issues/13): evolução futura, não dependência desta correção.

## 10. Registro de decisões

- **2026-11-06 — Criação:** SPEC elaborada a partir da issue #7 e inspeção do código. D-01 e D-02 permanecem como propostas pendentes de validação. Nenhuma alteração funcional, migração ou implantação foi realizada nesta etapa.
- **2026-11-06 — D-01 aprovada:** Usuário autorizou consulta de toda a escala publicada da própria igreja, incluindo equipe e atribuições, preservando restrições de edição e isolamento.
- **2026-11-06 — D-02 aprovada:** Usuário escolheu “Meus compromissos” como visão inicial da página de escala para mídia, com visão geral disponível. O destino após login permanece repertório.
- **2026-11-06 — Revisão de consistência:** Explicitado que a ausência de atribuições não provoca troca automática de visão e que somente leitura se aplica à escala e aos ensaios, sem retirar permissões existentes de outros módulos. Critérios de aceite atualizados; implementação não iniciada.
- **Implementação e validação local:** Entregues consulta por mídia, estados recuperáveis, horários por período e proteção em APIs/RLS. Evidências automatizadas, divergência do histórico local de migrações e pendências manuais registradas no relatório; sem migração remota, commit ou deploy.
