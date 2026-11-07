# Plano de implementação — WF-04: Onboarding e fundação multigreja

**SPEC:** [SPEC-WF-04-onboarding-saas.md](../spec/SPEC-WF-04-onboarding-saas.md)

**PBI:** [WF-04](https://github.com/analiceleite/worship_flow/issues/1) · **Relacionado:** [WF-26](https://github.com/analiceleite/worship_flow/issues/22)

**Estado:** Incrementos anteriores commitados em `2df13aa` e `73efc17`. Incrementos locais seguintes fixam contexto em escala/equipe, migram a credencial Google para a pessoa, mantêm seleção explícita de igrejas e revalidam notificações no envio. WF-04 completa ainda pendente (convites, políticas multigreja e demais consumidores); não pronto para implantação.

**Data:** 2026-11-07

## 1. Objetivo e limites

Implementar primeiro a fundação segura de identidade global e vínculos por igreja; depois o onboarding por convite. Provisionamento assistido e cadastro público são entregas posteriores, com critérios próprios.

Este documento não autoriza migração remota, envio real de e-mails, deploy, commit, PR ou alteração de usuários de produção. A execução local depende da autorização explícita registrada abaixo.

**Atualização de execução:** após a criação deste plano, o usuário autorizou criar branch e iniciar implementação, deixando os testes para o final. A autorização cobre trabalho local; não inclui operações remotas. Progresso e limites em [WF-04-validation.md](WF-04-validation.md).

**Atualização de continuidade:** o usuário autorizou o commit do incremento validado, registrado em `2df13aa`, e pediu continuidade. Alterações do segundo incremento permanecem separadas desse commit. Nenhum push foi autorizado ou executado.

**Atualização de continuidade 2:** o segundo incremento foi commitado em `73efc17`. A pedido do usuário, a execução local prosseguiu para os consumidores de escala; o terceiro incremento não foi commitado nem enviado.

**Atualização de continuidade 3:** o usuário pediu para prosseguir. A migração da escala foi ampliada aos componentes e operações de equipe; o início/callback OAuth agora usa alvo e estado vinculados à pessoa e ao vínculo. As alterações permanecem locais, sem commit/push.

**Atualização de continuidade 4:** o usuário pediu para implementar o próximo passo. A migração 039 foi aplicada somente no banco local, movendo a credencial Google para `user_id` e preservando tokens/mapas legados por backfill. Reconciliação, cron, publicação, status e desconexão agora distinguem conta pessoal de igreja sincronizada. O worker de e-mail revalida estado/preferências no envio e a pausa global é editável separadamente das preferências locais. Múltiplos vínculos por identidade continuam bloqueados intencionalmente.

Decisões de produto consolidadas:

- Uma identidade Auth pode participar de várias igrejas, com papéis, funções musicais e estados independentes.
- Nome/foto globais são editados pela pessoa; ADMIN só gerencia atributos locais.
- Integrantes legados ficam ativos nos vínculos existentes, sem novo convite/onboarding. Registrar corte e não reativar suspensões futuras.
- Notificações por igreja com pausa global para comunicações opcionais; acesso/segurança são categorias separadas.
- Conexão Google pessoal, com escolha das igrejas sincronizadas.
- Criação pública limitada a **1 igreja por pessoa/identidade**, com exceção auditada da plataforma; participação por convite não consome cota.
- Sem compartilhamento automático de acervo, painel agregado, cobrança ou novos papéis hierárquicos.

## 2. Inspeção inicial e consequências técnicas

| Local | Constatação e ação planejada |
|---|---|
| `scripts/032_simple_multitenancy_hardening.sql:84–86` | Índice único de `ministers.user_id`; substituir por unicidade `(church_id, user_id)` após inventário de constraints e duplicidades. |
| `scripts/001_create_tables.sql` | E-mail de ministro originalmente único globalmente; auditar estado efetivo e remover a restrição global que impede vínculos multigreja. |
| `scripts/031_simple_multitenancy_rls.sql:5–69` | Helpers escolhem igreja/ministro com `LIMIT 1`; substituir por autorização com igreja explícita. Conferir definições posteriores e dependências antes de migrar. |
| `lib/auth-context.ts` | Resolve um perfil por usuário; separar identidade autenticada, vínculos e contexto operacional validado. |
| `middleware.ts` | Usa `.single()` por usuário, pressupõe vínculo e redireciona sem seletor. Não expulsar contas válidas sem igreja ou em aceite. |
| `app/api/context/route.ts` | Já fornece `{ context, church }`; preservar compatibilidade e acrescentar resolução explícita/listagem em contratos separados. |
| `app/api/ministers/create/route.ts` | Cria Auth e senha temporária; substituir entrada normal por convite sem duplicar conta existente. |
| `app/api/ministers/[id]/route.ts` | DELETE remove músicas, perfil e Auth global. Bloquear esse caminho destrutivo na nova experiência antes de habilitar múltiplos vínculos. |
| `app/api/profile/avatar/route.ts` | Foto vinculada ao ministro e caminho `churchId/userId`; migrar propriedade para pessoa, preservando objetos antigos até concluir substituição segura. |
| `app/api/preferences/route.ts` | Preferências locais em `ministers`; manter semântica local e adicionar pausa global, sem replicar estado global por igreja. |
| `app/api/google-calendar/*` e `lib/google-calendar/` | Integração precisa deixar de presumir uma identidade de ministro por pessoa; migrar credencial e preservar mapas de eventos. |
| `lib/auth/password-recovery-server.ts` | Já há geração/validação de prova Supabase, limitação e captura local de e-mails; reutilizar princípios, sem confundir recovery com aceite. |
| `lib/supabase/client.ts` | Auth usa fluxo implicit para mobile/webview. Não trocar todo o mecanismo de sessão sem teste e refinamento específico. |
| `tests/` e `package.json` | Há `node:test`, testes locais Supabase e browser com `playwright-core`; ampliar estrutura existente, sem framework novo. |

Inspeção é estática. Confirmar schema real, grants, triggers, RPCs, policies permissivas/restritivas e migrações posteriores antes de escrever SQL. Próxima numeração observada é após 037; confirmar no momento da implementação, sem editar migrações históricas.

## 3. Arquitetura técnica proposta

### 3.1. Identidade e vínculo

- Manter `ministers.id` como identificador do vínculo musical/local, preservando FKs de músicas, escalas e repertório.
- Criar perfil global, conceitualmente `user_profiles`, com `user_id` único, nome, foto, pausa global opcional e preferência de última igreja. Auth continua fonte do e-mail verificado.
- Acrescentar estado explícito e metadados de ativação/suspensão a `ministers`; tornar `(church_id, user_id)` único quando `user_id` não for nulo.
- Convite fica em entidade própria; nova conta não é criada no simples ato administrativo de convidar. Perfil local pode ser materializado no aceite, sem exigir usuário Auth antecipadamente.
- Para legados sem `user_id`, preservar perfil e histórico; não fabricar identidade. A migração de estado não dispensa autenticação nem comprovação de e-mail.
- Nome/foto locais legados viram projeções de compatibilidade, nunca fonte de autorização ou escrita administrativa. Definir adaptação de joins existentes para não quebrar cards e escalas.
- RLS do perfil global permite escrita apenas pelo titular. Leitura por colegas expõe somente nome/foto necessários e exige vínculo compartilhado ativo; não publicar preferências ou a lista de igrejas de outra pessoa.
- Backfill escolhe dados existentes de forma determinística e registra conflitos para revisão, sem sobrescrever perfil global já editado pela pessoa.

### 3.2. Autorização no banco

- Introduzir helpers com igreja explícita, como `has_active_membership(church_id)`, `is_active_church_admin(church_id)` e resolução de ministro por `(auth.uid(), church_id)`.
- Substituir dependências de `get_current_church_id()`/`get_current_minister_id()` sem parâmetro. Nenhum `LIMIT 1` pode escolher ambiente arbitrário.
- Policies operacionais avaliam vínculo ativo e igreja ativa para o `church_id` da linha, com regras editoriais vigentes preservadas por vínculo.
- O usuário pode ter permissão em duas igrejas; RLS permite os registros autorizados e o cliente deve filtrar o ambiente selecionado. Cookie não é contexto confiável para PostgREST.
- Escritas e relações verificam que song/ministro/período/atribuição pertencem à mesma igreja. `WITH CHECK` também impede mover registros entre igrejas alterando `church_id`.
- Policies de autoedição não permitem mudar `role`, `state`, `church_id` ou `user_id`. Convite/reativação são operações dedicadas.
- Revisar conjunto efetivo de policies: uma policy permissiva antiga pode anular a restrição nova em intenção.
- RPCs privilegiadas usam grants mínimos, `search_path` seguro e ator derivado de Auth ou passado somente por backend autorizado. Nunca confiar em `p_actor` livre numa função executável pelo cliente.
- Último ADMIN: serializar mudanças por igreja (lock transacional), contar administradores ativos e rejeitar transição sem sucessor. Testar duas mudanças simultâneas.

### 3.3. Contexto na aplicação

- Separar `getAuthenticatedIdentity()` de `getCurrentMinisterContext()`. Perfil global, convites e seletor devem funcionar sem vínculo operacional selecionado.
- Contexto operacional contém `userId`, `ministerId`, `churchId`, papel e identificação explícita de suporte quando aplicável.
- Requisição operacional captura igreja alvo explicitamente, por contrato centralizado (por exemplo header `X-WF-Church-Id`); validar formato, vínculo, estado e recursos no servidor. Escolher uma convenção única antes de migrar consumidores.
- Preferência em cookie HttpOnly serve ao SSR/retomada, não autoriza e não substitui alvo explícito de uma escrita iniciada antes da troca em outra aba.
- APIs sem alvo só podem resolver vínculo único de forma não ambígua; múltiplos sem seleção retornam erro de seleção necessária, não primeira igreja.
- Preservar campos atuais de `/api/context` enquanto consumidores migram. APIs autenticadas usam `no-store` e erros estruturados, não redirects HTML.
- Middleware trata somente navegação e renovação de sessão; acesso final é validado por APIs/RLS. Não deslogar conta válida por falta de igreja.
- Exceções de onboarding têm rotas exatas e limites de prefixo; sessão/`?code` não podem virar bypass genérico.
- Suporte/impersonação permanece caminho separado, validado por `platform_admins`, auditado e visível. Não fabricar vínculo de ministro para ADMIN da plataforma.

### 3.4. Estado do frontend

- Centralizar contexto e fetch operacional, evitando adicionar headers/filtros de maneira divergente em cada tela.
- Contexto/keys de cache incluem `churchId`; ao trocar, cancelar consultas, limpar dados incompatíveis e ignorar resultados com geração/contexto antigo.
- Consultas diretas Supabase filtram `church_id`, mesmo com RLS correta. Escritas capturam igreja original, inclusive uploads e operações em lote.
- Nome da igreja visível no cabeçalho e seletor acessível; uma igreja entra direto, várias retomam preferência válida, nenhuma recebe estado próprio.
- Proteger formulários não salvos e exibir mudança causada por link/convite. Tratar expiração de sessão e suspensão sem loops de redirect.
- Revisar service worker/PWA para não reutilizar respostas autenticadas de outro usuário/ambiente.

## 4. Convites e primeiro acesso

### 4.1. Persistência e transições

- Entidade de convite: igreja, e-mail normalizado, papel/função autorizados, remetente, hash do token, versão, validade, estado e datas de aceite/revogação.
- Garantir somente um convite pendente por destinatário/igreja, sem impedir convites da mesma pessoa para outras igrejas.
- Segredo aleatório criptográfico; somente hash persistido no convite. Rotação invalida link anterior e mantém auditoria.
- Expiração é validada por relógio do servidor mesmo sem job marcar `expired`.
- Novo convite verifica vínculo existente na igreja sem revelar participação externa ao ADMIN.
- Aceite transacional: lock do convite, validar estado/versão/expiração, igreja e identidade com e-mail comprovado; criar/associar vínculo único, ativar e consumir autorização.
- Replay pela mesma identidade retorna resultado idempotente, respeitando suspensão atual; replay por outra identidade não revela dados.
- Revogação, suspensão e alteração de papel concorrentes não podem ser sobrescritas por aceite atrasado.

### 4.2. Prova de identidade no Supabase

- Conta existente: login normal e aceite, sem redefinir senha.
- Conta nova: confirmação verificada e definição de senha usando Supabase, preservando o contexto do convite.
- Executar spike local antes de fechar implementação para escolher entre signup verificado e mecanismo invite/OTP compatível com a versão instalada. Registrar contrato escolhido e atualizar o plano antes de codificar a jornada final.
- O convite da aplicação autoriza o vínculo; a prova Auth autoriza a identidade. Não presumir que possuir token de convite equivale a sessão verificada.
- Não usar prova `recovery` como autorização de ativação; não consumir prova Auth por GET. Evitar scanners invalidando links.
- Contexto de retorno não inclui token em analytics; página sensível sem tracking de terceiros, com `no-store`, `no-referrer` e `noindex`.
- No cenário conta nova, evitar dois e-mails/links obrigatórios se o mecanismo Supabase permitir prova única segura; comprovar comportamento em desktop/mobile/webview.
- Nunca associar por nome, aceitar destinatário editável ou usar metadados de Auth editáveis como papel.

### 4.3. Envio e limites

- Gravar convite e intenção de envio no mesmo commit; enviar depois com worker/outbox, identificador de tentativa e deduplicação no provedor quando disponível.
- Caso outbox precise manter segredo para envio posterior, usar payload protegido/criptografado com retenção curta; nunca token em texto livre em logs ou auditoria. A chave é configuração somente do servidor.
- Claim/lease, retries limitados e backoff; revalidar versão/revogação antes do envio. Reenvio explícito rotaciona token; retry técnico não gera novo convite.
- Não declarar exactly-once externo: documentar janela de falha após envio e usar idempotência do provedor quando suportada.
- Reaproveitar captura local Mailpit e configuração de e-mail por igreja; reuso da fila de escala exige auditoria, não dependência automática.
- Validade de 7 dias e cooldown de 60 segundos continuam propostas até confirmação operacional. Rate limit é persistente e não depende da memória de uma instância.
- Falha de envio fica visível e recuperável, sem apagar convite nem mostrar aceite/sucesso inexistente.

## 5. Contratos propostos

Nomes abaixo são proposta técnica; conservar rotas existentes quando seguro e documentar transição, sem duplicar comportamentos incompatíveis.

| Contrato | Responsabilidade |
|---|---|
| `GET /api/me/memberships` | Listar somente vínculos próprios e estados mínimos para seleção. |
| `POST /api/context` | Validar escolha e persistir preferência; responder contexto autorizado. GET atual preserva compatibilidade. |
| `PATCH /api/profile` | Nome e preferências globais do titular; nenhuma alteração de papel. |
| `/api/profile/avatar` | Manter contrato de upload/remoção, trocando propriedade de vínculo para identidade. |
| `POST /api/invitations` | ADMIN cria/reutiliza convite na igreja alvo, com validação Zod. |
| `POST /api/invitations/:id/resend` e `/revoke` | Operações locais autorizadas, com versão e limites. |
| `POST /api/invitations/inspect` | Token no corpo, contexto mínimo e erro genérico de indisponibilidade; não consumir. |
| `POST /api/invitations/accept` | Sessão verificada + token; transação e idempotência. |
| `PATCH /api/ministers/:id/access` | Função/papel/estado local; lock de último ADMIN e auditoria. |
| `PATCH /api/preferences` | Preferências locais atuais, com igreja alvo explícita. |
| `POST /api/onboarding/church` | Etapa SaaS posterior: provisionamento idempotente com cota. |
| `GET /api/onboarding` | Configuração/checklist real do ambiente autorizado. |

Erros: 401 sem sessão; 403 sem permissão; 404 recurso indisponível sem revelar igreja alheia; 409 conflito/seleção necessária; 429 limite; 503 dependência indisponível. Convite expirado/revogado tem resultado recuperável seguro, sem enumeração pública.

Operações autenticadas com cookies precisam de validação de origem/CSRF, allowlist de retorno e ausência de cache compartilhado. Não usar GET para mudar vínculo, aceitar convite ou provisionar igreja.

## 6. Superfícies que precisam acompanhar a fundação

### 6.1. Remoção e conta global — bloqueador de liberação

- Retirar a exclusão definitiva da experiência comum e impedir ADMIN local de executar `auth.admin.deleteUser` por gestão de integrante.
- Substituir ação habitual por suspensão local, preservando músicas/histórico. Endpoint DELETE antigo deve ser desabilitado/rejeitado de forma segura, não silenciosamente manter o comportamento destrutivo.
- Não implementar todo o fluxo de exclusão/transferência da WF-12 aqui; registrar a compatibilidade obrigatória e o trabalho restante.

### 6.2. Perfil e avatar

- Migrar foto para propriedade `userId`; manter leitura segura de URLs antigas durante transição.
- Substituição de arquivo preserva foto válida até persistência da nova; limpeza só remove objetos comprovadamente pertencentes ao titular.
- ADMIN não edita nome/foto global por formulário local ou API direta. Convite só fornece nome provisório para identidade ainda sem perfil.
- Leituras de músicas/equipe/escala projetam nome/foto globais sem expor atributos privados do perfil.

### 6.3. Preferências, notificações e calendário

- Manter offsets e preferências locais existentes no vínculo; adicionar pausa opcional global com precedência e categorias claras.
- Worker revalida estado, igreja e preferências antes do envio; eventos de acesso/segurança não são suprimidos como lembretes opcionais.
- Migrar credencial Google para `user_id`, mantendo seleção de igrejas e mapeamento de eventos por identidade/igreja/ocorrência.
- OAuth state deve estar vinculado à identidade que iniciou a conexão; callback não depende de igreja corrente nem aceita troca de identidade.
- Backfill da conexão existente preserva seleção da igreja original. Duplicidades de credenciais exigem resolução sem revogação arbitrária.
- Não recriar/apagar eventos em massa ao migrar; preservar IDs/dedupe e limitar reconciliação aos namespaces autorizados.
- Diferenciar desconectar conta Google de deixar de sincronizar uma igreja; efeito externo e falhas precisam de feedback/retomada.
- Cadastro de segundo vínculo fica bloqueado enquanto consumidores críticos ainda presumirem credencial ou ministro único.

## 7. Provisionamento e cota — etapas posteriores

- Igreja recebe fuso IANA validado, slug único gerado e defaults comerciais/ambiente definidos no servidor.
- Provisionamento assistido cria intenção recuperável e primeiro convite ADMIN; ambiente não é apresentado como pronto antes de responsável ativo.
- Cadastro público exige identidade verificada; transação cria igreja, ADMIN, configuração e consumo de cota.
- Ledger/campo de criador original registra igreja criada independentemente do papel atual. Participação por convite não consome cota.
- Serializar criação por identidade, garantir idempotência por intenção e cota padrão 1. Falha sem criação não consome cota definitiva.
- Sair, inativar ou transferir administração não libera cota automaticamente. Exceção só por autorização auditada da plataforma.
- Não atribuir criador a igrejas legadas por inferência sobre quem é ADMIN. Definir tratamento explícito de proveniência legada antes de abrir cadastro público.
- Checklist deriva progresso real; dispensar sugestão não marca conclusão. Não inserir acervo fictício.
- Extensão SaaS precisa de issue própria, políticas comerciais/jurídicas e controles antiabuso antes de habilitação pública.

## 8. Fases de execução e critérios de passagem

As fases abaixo ainda não estão integralmente concluídas. O primeiro incremento entrega partes das fases 1/2; não equivale à conclusão dos gates. Separar PRs incrementais sem liberar múltiplos vínculos antes da compatibilidade completa.

### Fase 0 — Inventário, spike Auth e fixtures

- [ ] Mapear todas as consultas por `user_id`, helpers SQL, grants, políticas, RPCs, storage, serviços, jobs e cache/PWA.
- [ ] Conferir schema efetivo e fixtures de migrações; não ignorar divergências de checksum nem reescrever histórico.
- [ ] Fechar contrato técnico Auth e de contexto explícito; registrar validade/reenvio e diferenças por fluxo.
- [ ] Prototipar seletor, convite, aceite e estado sem igreja; validar com responsáveis/integrantes.
- [ ] Preparar banco local isolado, Mailpit e duas igrejas fictícias com identidades compartilhadas e papéis distintos.

**Passagem:** inventário registrado, Auth reproduzível e plano de migração revisado.

### Fase 1 — Expandir schema e migrar legado

- [ ] Criar migrações novas para perfil global, estados, convite/outbox, auditoria e unicidade composta.
- [ ] Registrar snapshot/marco de corte do legado; migrar exatamente esses vínculos para ativos uma única vez.
- [ ] Não reexecutar ativação sobre suspensões posteriores; preservar bloqueios Auth e igrejas inativas.
- [ ] Backfill perfil global e compatibilidade de nome/foto sem mudar IDs/FKs.
- [ ] Preparar novas policies/helpers e testes reais antes de remover caminhos antigos.

**Passagem:** migração repetível no ambiente de teste e histórico íntegro; feature multigreja ainda desligada.

### Fase 2 — Contexto, permissões e compatibilidade transversal

- [ ] Migrar middleware, login, contexto, APIs e consultas diretas para igreja/vínculo explícitos.
- [ ] Implementar seletor, preferência validada, isolamento de cache e tratamento entre abas.
- [ ] Bloquear exclusão global por ADMIN local e garantir último ADMIN no banco.
- [ ] Migrar perfil/avatar, preferências, consumidores de notificações e calendário.
- [ ] Testar políticas reais e RPCs de repertório/escala, incluindo migrações 036/037 e grants efetivos.

**Passagem:** segunda igreja não mistura leitura/escrita ou integrações; nenhuma operação local apaga conta global.

### Fase 3 — WF-04: convites e acesso

- [ ] Implementar serviços/transações, contratos, limitação persistente e outbox de convites.
- [ ] Trocar formulário de criação por convite; listar situação de acesso e de envio separadamente.
- [ ] Implementar aceite novo/existente, troca de identidade, replay, expiração/revogação e recuperação.
- [ ] Desativar criação por senha temporária e caminhos antigos de autoativação por senha.
- [ ] Concluir regressão, acessibilidade e evidências de validação.

**Passagem:** critérios de aceite da fundação e WF-04 atendidos em ambiente isolado e revisados humanamente.

### Fase 4 — WF-26: provisionamento assistido

- [ ] Integrar criação de igreja, convite do primeiro ADMIN e retomada após falha.
- [ ] Adicionar fuso, configuração essencial e checklist opcional persistente.
- [ ] Validar suporte sem confundir perfil global pessoal e contexto impersonado.

**Passagem:** igreja nova chega a primeiro uso sem alteração manual de banco.

### Fase 5 — Extensão SaaS pública

- [ ] Refinar issue própria e política de proveniência/cota dos criadores legados.
- [ ] Implementar signup verificado, transação idempotente e cota 1 sob concorrência.
- [ ] Implementar limites antiabuso, mensagens de limite e exceção auditada.
- [ ] Validar termos aplicáveis, comunicação, observabilidade e prontidão operacional.

**Passagem:** revisão explícita autoriza abertura pública; completar fases anteriores não habilita cadastro automaticamente.

## 9. Matriz de testes

| Camada | Casos obrigatórios |
|---|---|
| Unidade | Transições, elegibilidade, expiração, preferência global/local, destinos seguros, identidade do contexto e cálculo da cota. |
| Banco/RLS | Ativo/pendente/suspenso, igreja inativa, mesmo usuário em A/B, leitura e escrita cruzadas, mudança de `church_id`, autoelevação, grants e policies sobrepostas. |
| Concorrência | Aceite duplo, aceite versus revogação/suspensão, dois rebaixamentos de ADMIN, criação simultânea sob cota e timeout após commit. |
| Auth | Novo/existente, destinatário diferente, sessão expirada, recovery sem ativação, callbacks e mobile/webview. |
| UI/browser | Uma/várias/nenhuma igreja, troca com formulário, duas abas, resposta atrasada, link direto e entrada de Mídia preservada. |
| Perfil/storage | Edição somente pelo titular, projeção pública mínima, migração de avatar, troca com falha e limpeza sem apagar arquivo de terceiros. |
| Notificações | Pausa global, opt-out local, suspensão, igreja inativa, falha/retry, envio obsoleto, test/demo e captura sem mensagens reais. |
| Google | Identidade no OAuth, duas igrejas selecionadas, seleção removida sem apagar outra, dedupe, migração e desconexão parcial/global. |
| Migração | Legado false fica ativo; rerun preserva suspensão posterior; IDs/histórico intactos; órfãos Auth tratados sem identidade inventada. |
| Provisionamento | Primeiro ADMIN, e-mail falho, slug colidente, fuso válido, cota 1, retries e efeito de exceção auditada. |

Ampliar `node:test`, testes locais Supabase e browser existentes. Criar suítes focadas de contexto, convites, migração e provisionamento, com scripts em `package.json` somente durante implementação.

Executar regressões existentes: recovery, repertório, mídia, identidade/avatar e ferramentas locais. Rodar `pnpm build`, checagem TypeScript e `pnpm lint` se disponível; registrar falhas ambientais/preexistentes em vez de afirmar sucesso. Assertions de código-fonte não substituem teste de autorização no banco real.

## 10. Liberação, observabilidade e rollback

- Flags separadas para multigreja, convites, provisionamento assistido e signup público; flags não são barreira de autorização.
- Preparar rollout expand/backfill/compatibilidade/contração. Uma versão antiga que presume usuário único não pode voltar a atender múltiplos vínculos sem compatibilidade comprovada.
- Testar backups/restauração e ensaiar migração em cópia autorizada antes de produção. Não executar operações remotas neste plano.
- Rollback operacional desliga novas entradas e mantém vínculos já aceitos; não apaga igreja, reativa suspenso ou restaura DELETE global.
- Se schema/RLS impedir rollback de código, manter release compatível e aplicar correção para frente; registrar esse limite antes do deploy.
- Auditoria registra ator/igreja/ação/resultado, sem senha/token, credencial Google ou dados reais em evidências públicas.
- Métricas: erros por etapa, falhas de convite, retries, tempo até ambiente pronto/aceite/primeiro uso; metas após baseline.
- Operador da igreja vê somente diagnóstico próprio; plataforma tem acesso de suporte autorizado e auditado.

## 11. Arquivos e artefatos esperados

- Existentes: `lib/auth-context.ts`, `lib/types.ts`, `lib/routes.ts`, `middleware.ts`, `components/header.tsx`, páginas de login/set-password/profile/users e `components/minister-form.tsx`.
- APIs: context, ministers, profile/avatar, preferences, google-calendar e consumidores operacionais de igreja.
- Serviços novos sugeridos: identidade/contexto, transações de convites, outbox e provisionamento, separados de componentes React.
- Migrações novas em `scripts/`, sem editar histórico; adaptar migrador/fixtures locais apenas quando necessário.
- Testes em `tests/` e registro futuro `sdd/plan/WF-04-validation.md`, criado durante execução com resultados reais e pendências.
- Atualizar SPEC/PLAN conforme decisões técnicas confirmadas; changelog/release notes somente na entrega efetiva.

## 12. Definition of Done por entrega

- [ ] Critérios correspondentes da SPEC atendidos, sem marcar etapas SaaS futuras como concluídas pela WF-04.
- [ ] SQL, contratos e consumidores revisados; decisões técnicas do spike documentadas.
- [ ] Isolamento real e fluxos concorrentes testados com duas igrejas.
- [ ] Migração/rollback ensaiados e evidências sem segredos.
- [ ] UX validada em mobile, teclado e leitor de tela; falhas recuperáveis sem sucesso falso.
- [ ] Nenhum novo vínculo libera enquanto identidade/contexto/calendário/exclusão mantiverem pressuposto inseguro de usuário único.
- [ ] Revisão humana e autorização de implantação registradas separadamente da validação automatizada.
