# SPEC — WF-04: Onboarding e identidade multigreja no SaaS

**Status:** Fundação inicial validada e commitada; entrada/seleção de igreja e consumidores iniciais de contexto explícito implementados em segundo incremento. Fluxo de convites, integração multigreja completa e validação humana pendentes. Não pronto para implantação.

**PBI principal:** [WF-04 — Concluir onboarding e definir estados de acesso do integrante](https://github.com/analiceleite/worship_flow/issues/1)

**Relacionados:** [WF-26 — Provisionamento de igrejas](https://github.com/analiceleite/worship_flow/issues/22) · [WF-32 — Regras e responsabilidades](https://github.com/analiceleite/worship_flow/issues/28) · [WF-12 — Desativação e preservação de histórico](https://github.com/analiceleite/worship_flow/issues/8)

**Prioridade:** P1 — Alta

**Área:** Acesso · Plataforma · Onboarding

**Data:** 2026-11-07

## 1. Visão e propósito

O Worship Flow é um SaaS centrado na igreja, com identidade centrada na pessoa. Cada igreja organiza sua equipe e seu acervo em ambiente isolado; uma pessoa pode servir em várias igrejas com a mesma conta.

O objetivo do onboarding não é ensinar a configurar um SaaS: é levar a equipe a saber **quando vai servir, com quem e quais músicas precisa preparar**.

Princípios:

1. Uma conta identifica a pessoa; um vínculo define sua participação e suas permissões em cada igreja.
2. Um convite autoriza a entrada em uma igreja específica, não privilégios globais.
3. Criar uma igreja e participar de uma igreja são jornadas diferentes.
4. Configuração mínima para começar; preparação progressiva, opcional e retomável.
5. Segurança do contexto é fundação; painéis consolidados, cobrança e hierarquias complexas não são requisitos iniciais.

## 2. Contexto atual e problema

| Referência | Evidência estática |
|---|---|
| `lib/types.ts:1–24` | Igreja possui identificador, slug, status, ambiente, modo de e-mail e plano; ministro possui igreja, usuário e `is_active`. |
| `scripts/030_simple_multitenancy_base.sql:6–19` | Existe estrutura de igrejas no banco compartilhado. |
| `app/api/platform/churches/route.ts:38–73` | Só administrador da plataforma cria igreja; a operação não provisiona seu primeiro ADMIN. |
| `app/api/ministers/create/route.ts:34–94` | Criação de integrante gera conta Auth, senha temporária e perfil inativo. |
| `app/auth/login/page.tsx:33–45` | Login resolve um perfil por usuário e envia inativos para definir senha. |
| `app/auth/set-password/page.tsx:83–102` | O fluxo atualiza senha e encerra sessão, sem concluir ativação nessa operação. |
| `lib/auth-context.ts:45–71` | Contexto busca um perfil por usuário; não consulta o estado de acesso do vínculo. |

Essas observações não comprovam ocorrência em produção. Antes da implementação, auditar constraints, triggers, RLS, storage, middleware e dados legados. Referências de linha podem mudar.

## 3. Escopo e divisão de entregas

Esta SPEC conecta a visão do produto, mas não transforma toda a expansão SaaS em uma única issue.

| Entrega | Escopo |
|---|---|
| Fundação multigreja, pré-requisito da WF-04 | Identidade global, vínculo local, resolução de contexto, seletor, estados de acesso e autorização consistente. Refinar subtarefas antes de implementar. |
| WF-04 | Convite individual, primeiro acesso, aceite por conta nova/existente, reenvio, revogação e acompanhamento pelo ADMIN. |
| WF-26 | Provisionamento assistido de igreja e primeiro ADMIN, reutilizando o fluxo de ativação; checklist de primeiros passos. |
| Extensão SaaS, issue própria | Cadastro público, confirmação de e-mail, criação autônoma, limites e proteção contra abuso. |

Fora do MVP: cobrança/cartão, SSO, WhatsApp automático, importação em massa, domínio próprio, múltiplas unidades, painel agregado entre igrejas, compartilhamento automático de acervo, permissões herdadas e faturamento conjunto.

Exclusão definitiva, transferência de acervo e mudanças da matriz editorial musical seguem refinamentos próprios. A experiência completa de suporte da WF-26 também não está detalhada neste card.

## 4. Modelo de identidade e multitenancy

### 4.1. Isolamento por igreja

- Manter inicialmente um banco compartilhado com `church_id` e RLS. Não criar banco/schema separado por igreja nesta entrega.
- Equipe, músicas, repertórios, escalas e configurações pertencem à igreja.
- Recursos auxiliares, storage, filas, integrações e caches precisam preservar o mesmo limite.
- API valida contexto, vínculo ativo e permissão; RLS impede acesso indevido inclusive em consultas diretas.
- O seletor de igreja escolhe contexto, mas nunca concede autorização.
- Acervo não se torna global por ter sido cadastrado pela mesma pessoa em duas igrejas.

### 4.2. Conta global e vínculo local

| Global da pessoa | Local da igreja |
|---|---|
| Identidade Auth e e-mail de login | Papel de acesso |
| Nome e foto básicos | Funções musicais |
| Recuperação da conta | Estado ativo/suspenso |
| Preferências pessoais de interface | Responsabilidades, atribuições e histórico |

- Uma identidade Auth por pessoa; conta existente recebe novo vínculo, não outra senha ou conta.
- Um vínculo por `(church_id, user_id)`, com unicidade no banco para identidades associadas.
- Uma pessoa pode ser ADMIN em uma igreja e integrante ou Mídia em outra.
- Convites pendentes podem existir antes de conta ou vínculo; definir isso no plano técnico sem duplicar a fonte de autorização.
- Preservar IDs de perfis existentes e referências históricas. Avaliar uso de `ministers` como vínculo antes de introduzir tabela adicional.
- Nome/foto globais são editados pela própria pessoa. Nome informado pelo ADMIN no convite é provisório e não sobrescreve perfil global existente.
- ADMIN local edita somente função musical, papel e estado do vínculo; não altera nome/foto globais da pessoa.
- E-mail de contato eventualmente mantido no perfil local não é fonte de autenticação. Alterar e-mail global exige fluxo verificado e tratamento explícito de convites pendentes.
- Preferências de notificações são configuradas pela pessoa por igreja. Uma pausa global de comunicações opcionais prevalece sobre as preferências locais; convites, recuperação de conta e avisos essenciais de segurança são tratados separadamente dos lembretes opcionais.
- ADMIN não pode contornar preferências pessoais para disparar lembretes opcionais. O envio revalida preferências, vínculo e situação da igreja antes de executar.
- A conexão Google pertence à pessoa, que escolhe quais igrejas elegíveis sincronizar. Credenciais não pertencem ao ADMIN nem à igreja e não são expostas a eles.
- Eventos do calendário preservam identificação da igreja e vínculo de origem. Sincronizar ou remover uma seleção de igreja não pode alterar eventos das outras. Desconexão global e remoção da seleção de uma igreja são ações distintas, com impacto informado.

### 4.3. Papéis e continuidade

- Manter inicialmente `admin`, `minister` e `midia`; distinguir perfil de acesso de função musical.
- Não criar papel de proprietário nem hierarquia de gestores/coordenadores nesta entrega.
- Proteger contra remoção, suspensão ou rebaixamento do último ADMIN ativo, inclusive sob concorrência.
- Incentivar um segundo ADMIN, sem bloquear o início do uso.
- ADMIN local não bloqueia conta global nem administra vínculos em outras igrejas.
- Administrador da plataforma é autoridade distinta. Suporte excepcional deve ser identificado, limitado e auditado, nunca habilitado pelo seletor comum.

## 5. Entrada e troca de igreja

- Uma igreja acessível: entrada direta.
- Várias: retomar a última igreja acessível escolhida pela pessoa; sem preferência válida, mostrar “Escolha sua igreja”. Nunca escolher a primeira linha arbitrariamente.
- Nenhuma: mostrar situação segura e caminhos autorizados para convites, recuperação ou criação de ambiente. Não inventar igreja padrão.
- Nome da igreja atual permanece visível; “Trocar igreja” lista somente vínculos autorizados.
- Igreja suspensa/inativa não é acessível, mas sua indisponibilidade deve ser explicada sem bloquear outras igrejas.
- Aceitar convite direciona à igreja correspondente e informa a mudança de contexto.
- Links diretos identificam o ambiente de destino. Após autenticação, validar vínculo e recurso; não reinterpretar IDs no ambiente anteriormente selecionado.
- Destino após login deve ser interno e permitido; não aceitar redirecionamento arbitrário.
- Se houver alterações não salvas, confirmar descarte antes de trocar igreja.
- Troca invalida/segrega caches e dados em voo. Respostas atrasadas da igreja anterior não aparecem no ambiente atual.
- Cada gravação captura a igreja alvo original. Troca de contexto em outra aba não pode redirecionar essa gravação.
- Preferência de contexto, em cookie ou parâmetro, é apenas uma seleção; servidor revalida vínculo, papel e estado em cada operação.

## 6. Jornada A — responsável cria uma igreja

### 6.1. Conta e verificação

1. Escolher “Criar ambiente da minha igreja”. “Já tenho conta” permite autenticar sem duplicar identidade.
2. Informar nome, e-mail e senha. Não exigir telefone, documento, endereço ou instrumento.
3. Confirmar e-mail antes de provisionar ambiente de produção.

Mostrar finalidade do cadastro e políticas aplicáveis; texto jurídico depende de validação. Respostas públicas não devem expor existência de contas/vínculos. Confirmação expirada permite reenvio com limite; não criar igreja ao abrir um link automaticamente.

### 6.2. Igreja e provisionamento

1. Informar nome da igreja e fuso horário, sugerido pelo navegador e confirmado pela pessoa.
2. Mostrar resumo: igreja e pessoa que será seu primeiro ADMIN.
3. Executar “Criar ambiente da igreja”.

- Slug gerado no servidor; colisões técnicas não bloqueiam nomes legítimos. Igrejas homônimas não são associadas automaticamente.
- Criar igreja, vínculo do primeiro ADMIN ativo e configuração essencial em transação Postgres quando possível.
- Auth já deve estar verificado; não presumir transação distribuída entre Auth, banco e e-mail.
- Chave idempotente vinculada ao usuário e à intenção, com unicidade no banco. Timeout permite retomar/consultar resultado sem criar outra igreja.
- Plano, ambiente, modo de e-mail e status seguem defaults do servidor; o navegador não escolhe privilégios.
- Criador nunca recebe privilégios de administrador da plataforma.
- Falha não apresenta ambiente incompleto como pronto; manter caminho recuperável.
- Criação pública exige conta com e-mail confirmado e permite criar **1 igreja por pessoa/identidade**, independente da quantidade de igrejas das quais a pessoa participa. Ampliação somente por exceção autorizada e auditada pela plataforma.
- Aplicar a cota no servidor e no banco com controle de concorrência. Retry da mesma intenção não consome nova cota; falha sem ambiente provisionado não consome cota definitiva.
- Registrar criador original para contabilização independente do papel atual. Sair da igreja, transferir administração ou inativá-la não deve liberar cota automaticamente. Exceções exigem autorização auditada da plataforma.
- Ao atingir o limite, explicar a restrição e oferecer contato com suporte; não bloquear participação em outras igrejas por convite.

### 6.3. Primeiros passos

Mensagem: “O ambiente da [igreja] está pronto”. Exibir checklist persistente:

1. Convidar equipe.
2. Cadastrar primeira música.
3. Configurar primeira escala usando o fluxo existente.

- Tudo pode ser feito depois. Não obrigar tour nem convites para usar sozinho.
- Progresso real é calculado pelos dados; dispensar uma sugestão não marca tarefa como realizada.
- Retomar por “Primeiros passos”, sem repetir wizard em cada login.
- Configuração essencial termina quando igreja e ADMIN estão prontos; ativação do produto é medida separadamente.
- Não inserir dados fictícios em produção para simular progresso.

### 6.4. Provisionamento assistido

Antes de abrir cadastro público, o administrador da plataforma pode criar ambiente e convidar seu primeiro ADMIN pelo mesmo mecanismo de entrada.

Esse caminho exige estado recuperável de provisionamento e reenvio. Não mostrar igreja como pronta sem responsável válido; não exigir ajuste manual no banco. Checklist começa após a ativação do primeiro ADMIN.

## 7. Jornada B — ADMIN convida integrante

1. Abrir “Equipe” → “Convidar integrante”.
2. Informar nome, e-mail, perfil de acesso e função musical quando aplicável.
3. Confirmar envio e acompanhar situação na equipe.

Regras:

- Perfil padrão é integrante; ADMIN e Mídia dependem de escolha explícita. Função musical não concede papel administrativo.
- Servidor deriva/valida igreja alvo a partir do contexto autorizado.
- Não gerar nem compartilhar senha temporária.
- Mesmo e-mail na mesma igreja não duplica perfil/convite pendente. Vínculo ativo é informado como existente.
- Mesmo e-mail em outra igreja permite novo convite independente, sem expor vínculos externos ao ADMIN.
- Reenviar e revogar são ações limitadas ao ADMIN da igreja.
- Alterar destinatário ou privilégios de convite pendente revoga autorização anterior e emite nova.
- Suspensão exige reativação administrativa própria; reenvio não reativa.
- Convite aceito não é reenviado como primeiro acesso.
- Distinguir “Convite registrado”, “Envio pendente”, “Enviado ao provedor”, “Falha no envio” e “Aceito”. Entrega só é afirmada com evidência do provedor.

## 8. Jornada C — integrante aceita convite

1. Abrir link e ver igreja e papel proposto: “Você foi convidado para participar da [igreja]”.
2. Conta nova: comprovar controle do e-mail e definir senha com mecanismo validado do Supabase. Conta existente: autenticar sem redefinir senha.
3. Conferir identidade, igreja e papel; clicar em “Aceitar convite e entrar”.
4. Ativar vínculo e consumir convite atomicamente; manter sessão válida e abrir igreja do convite.

- Não consumir convite por GET: scanners e pré-carregamento não podem aceitá-lo.
- Convite é credencial sensível; não registrar tokens em logs/analytics e limitar exposição a referrers/terceiros.
- Evitar dois links independentes obrigatórios para a mesma verificação; escolher mecanismo coerente entre aplicação e Supabase no plano técnico.
- Sessão com e-mail diferente pede troca de conta preservando convite. Não aceitar associação por nome nem editar destinatário no aceite.
- Aceite não precisa de segunda aprovação: ADMIN já autorizou pelo convite.
- Nome pode ser confirmado pelo novo usuário; foto e preferências ficam para depois. Conta existente não perde seus dados globais.
- Convidado não vê CTA para criar igreja durante o aceite.
- Reabrir convite aceito pela mesma identidade oferece acesso, sem duplicação; respeitar estado atual do vínculo.
- Ausência de escala é estado vazio orientado, não falha de cadastro.
- ADMIN segue para primeiros passos/equipe; demais perfis para área autorizada existente. Não prometer detalhe unificado de compromisso ainda não implementado.

## 9. Estados e transições

| Entidade | Estados | Regra |
|---|---|---|
| Vínculo | `pending`, `active`, `suspended` | Papel e estado são locais; pendente nunca acessa operação. |
| Convite | `pending`, `accepted`, `revoked`, `expired` | Credencial e situação de aceite são distintas do envio. |
| Configuração essencial | `not_started`, `in_progress`, `completed` | Não confundir com checklist opcional ou autorização. |

- `pending → active`: aceite autorizado pela identidade destinatária.
- `active → suspended` e `suspended → active`: decisão administrativa explícita da igreja, protegendo último ADMIN.
- Revogar/expirar convite não concede acesso nem remove histórico. Vínculo pendente, se materializado, continua sem autorização.
- Recuperar senha não altera estado de vínculo.
- Suspender vínculo não afeta outras igrejas; inativar igreja impede acesso operacional a ela.
- Reenvio rotaciona credencial e invalida anterior, preservando histórico.
- Proposta operacional, ainda a validar: validade de 7 dias e cooldown de 60 segundos, configuráveis no servidor.
- Aceite concorrente com revogação, suspensão ou mudança de papel revalida estado/versão e produz resultado determinístico; não sobrescreve decisão administrativa.
- Repetição após timeout não duplica identidade, vínculo, igreja ou efeito externo.

## 10. Dados e contratos para o plano técnico

Nomes de tabelas, endpoints e estratégia de migração serão definidos no plano de implementação, preservando estas invariantes:

- Identidade global, vínculo local único e perfil musical com referências históricas preservadas.
- Convite com igreja, destinatário normalizado, remetente, papel autorizado, alvo, expiração, consumo, revogação e versão. Se aplicação emitir segredo, guardar somente hash.
- Perfil global com nome/foto e política de edição pela própria pessoa; não usar metadados editáveis de Auth como fonte de papel administrativo.
- Provisionamento com usuário verificado, intenção idempotente, estado e resultado recuperável.
- Igreja com fuso próprio, hoje ausente do tipo `Church`; consumidores precisam de política de uso explícita.
- Última igreja é preferência pessoal validada; não é vínculo nem permissão.
- Auditoria com ator, igreja, ação e data; sem senha, token ou conteúdo excessivo de e-mail.

Contratos devem cobrir: consultar vínculos próprios, selecionar contexto, convidar/reenviar/revogar, consultar convite com contexto mínimo, aceitar, suspender/reativar, provisionar/consultar resultado e retomar configuração.

Respostas distinguem validação, autenticação, autorização, conflito, expiração e erro recuperável, sem enumerar contas em endpoints públicos.

## 11. Segurança e efeitos externos

- Service role permanece no servidor. Autorização valida sessão, igreja, vínculo ativo, papel e estado da igreja, inclusive com sessão antiga.
- Revisar RLS e todas as resoluções `.single()`/`.maybeSingle()` por usuário. Ajustar apenas o helper de contexto não atende à SPEC.
- Vínculo ativo deve ser validado na igreja de cada registro; cookie/contexto de cliente não substitui essa verificação.
- Consultas diretas do cliente filtram igreja selecionada além de respeitar RLS. Ter acesso a duas igrejas não autoriza misturar suas telas/dados.
- Onboarding restrito só expõe contexto necessário, nunca dados operacionais de igreja pendente.
- Aplicar limites por identidade, IP e destinatário para criação e envio; CAPTCHA adaptativo se necessário.
- E-mails são efeitos após commit via outbox/fila ou equivalente com deduplicação, tentativas limitadas e recuperação. Reuso da fila WF-09 depende de revisão.
- Falha de envio não apaga conta, igreja ou convite persistidos; oferecer reenvio sem duplicação.
- Ambientes demo/teste respeitam modo de e-mail configurado, sem envio real acidental.
- Novas atribuições e notificações usam vínculos elegíveis. Suspensão/pêndencia não apaga músicas, escalas ou referências históricas.
- Integração Google deve separar credencial da pessoa e eventos por vínculo/igreja; sincronizar uma igreja não pode apagar eventos de outra.
- Isolamento abrange storage, caches, jobs, notificações, exportações e suporte, não somente tabelas principais.

## 12. Experiência e acessibilidade

- Uma tarefa principal por tela; textos orientados à igreja e à participação, sem exigir entendimento de tenant ou provisionamento.
- Formulários curtos; diálogo para convite individual, páginas para criação e aceite.
- Estados explícitos: carregamento, vazio, erro recuperável, sucesso, identidade incorreta, sessão expirada, convite expirado/revogado/aceito e acesso suspenso.
- Erros persistentes inline com recuperação; toast não é única evidência.
- Bloquear submissão repetida durante processamento, sem depender disso para integridade.
- Preservar dados não sensíveis após falha; nunca guardar senha/token em storage para retomada.
- Funcionar em 360px, zoom 200%, teclado e leitor de tela, com foco visível, labels associados e alvos de toque de pelo menos 44px.

## 13. Migração e implantação gradual

1. Auditar banco, RLS, constraints, storage, middleware e consumidores que presumem um perfil por usuário.
2. Preservar IDs e migrar perfis existentes para vínculos com estado explícito; ajustar unicidade global que impeça múltiplas igrejas, se existir.
3. Por decisão do usuário, migrar os integrantes existentes no marco de implantação para vínculos `active` em suas igrejas atuais, inclusive quando o booleano legado `is_active` estiver falso. Não exigir novo convite, aceite ou onboarding desses integrantes.
4. Definir e registrar o marco de corte e o conjunto de registros legados, tornando a migração auditável e idempotente. A exceção vale somente para vínculos existentes nesse conjunto: novas entradas, inclusive de uma conta antiga em outra igreja, seguem o novo fluxo de convites. Não executar ativação em massa a cada deploy nem sobrescrever suspensões aplicadas após a migração. Não remover bloqueios globais de Auth, reativar igrejas inativas ou criar identidades Auth ausentes; inconsistências de identidade exigem recuperação própria.
5. Se houver coexistência temporária de `is_active` e estado novo, definir fonte única e sincronização no banco; não permitir escrita independente.
6. Migrar login, contexto, APIs, RLS, consultas diretas, seletores, importação, notificações e integrações antes de habilitar múltiplos vínculos.
7. Testar em ambiente isolado com duas igrejas e e-mails interceptados.
8. Liberar por etapas: fundação multigreja → WF-04 → provisionamento assistido → SaaS público.
9. Rollback desabilita entradas novas sem reativar suspensos, apagar ambientes ou invalidar vínculos já aceitos. Mudanças de schema precisam de compatibilidade planejada.

## 14. Critérios de aceite

### Fundação multigreja e WF-04

- [ ] Uma identidade participa de duas igrejas sem duplicar conta Auth nem sobrescrever vínculos.
- [ ] Papel, estado e proteção ao último ADMIN são avaliados por igreja.
- [ ] Uma igreja permite entrada direta; várias permitem escolha e retomada válida.
- [ ] Nome do ambiente fica visível e a troca não mistura caches, respostas em voo ou gravações entre abas.
- [ ] ADMIN convida sem senha temporária e acompanha acesso separado do envio.
- [ ] Conta nova conclui aceite e login seguinte normalmente; conta existente não redefine senha para aceitar.
- [ ] Identidade incorreta não aceita convite; reenvio, expiração e revogação têm recuperação clara.
- [ ] Retries e concorrência não duplicam vínculos nem anulam suspensão/revogação.
- [ ] APIs e RLS bloqueiam pendentes/suspensos, inclusive com sessões anteriores.
- [ ] Recuperação de senha não reativa vínculo; suspensão em uma igreja preserva acesso às demais.
- [ ] Integrantes legados são migrados para vínculos ativos na igreja atual sem convite ou onboarding obrigatório, preservando IDs e histórico.
- [ ] Marco de corte é registrado; repetir migração não reativa suspensões posteriores nem inclui novos vínculos na exceção.
- [ ] Novas entradas seguem convites, inclusive quando uma conta legada ingressa em outra igreja.
- [ ] Isolamento é validado entre duas igrejas em APIs, consultas diretas e storage.

### Provisionamento e abertura SaaS

- [ ] Igreja e primeiro ADMIN são provisionados sem ajuste manual no banco.
- [ ] Cadastro público exige e-mail verificado e não concede privilégio de plataforma.
- [ ] Timeout/retry da mesma intenção não cria duas igrejas.
- [ ] Falha de envio permite recuperação sem recriar ambiente ou conta.
- [ ] Checklist é opcional e retomável, sem dados fictícios ou bloqueio de uso.
- [ ] Limites de criação pública, políticas aplicáveis e controles antiabuso são definidos antes da abertura.
- [ ] Sem exceção autorizada, uma identidade cria no máximo 1 igreja, inclusive sob concorrência; retries não duplicam consumo e participação por convite não consome cota de criação.
- [ ] ADMIN não altera nome/foto globais; mudanças feitas pela pessoa se refletem consistentemente em seus ambientes.
- [ ] Preferências por igreja e pausa global são respeitadas para notificações opcionais, sem impedir recuperação de conta e mensagens essenciais de segurança.
- [ ] Uma conexão Google da pessoa sincroniza somente igrejas selecionadas, com eventos identificados e sem remoção cruzada.

## 15. Validação e sucesso do produto

- Unitários: transições, expiração, normalização, destinos permitidos e elegibilidade.
- Integração: RLS, último ADMIN concorrente, aceite/revogação concorrentes, idempotência e acesso cruzado entre igrejas.
- Auth: contas novas/existentes, troca de identidade, recuperação sem ativação, callbacks e mobile/webview.
- Contexto: links diretos, múltiplas abas, troca com formulário aberto, respostas atrasadas e acesso revogado durante sessão.
- Falhas injetadas: indisponibilidade Auth, falha de banco/envio e timeout após commit.
- E2E: criador até ambiente pronto; ADMIN até aceite; integrante em duas igrejas; suspensão local com sessão aberta.
- Usabilidade: protótipo com responsáveis e integrantes de diferentes familiaridades digitais. Validação humana permanece pendente até realizada.
- Medir etapas concluídas, abandono, erros, tempo até ambiente pronto, aceite e primeiro valor real, sem PII em analytics.
- Não confundir criação de conta com ativação. Metas dependem de baseline; não inventar prazos ou taxas.

## 16. Decisões alinhadas e pendências

### Visão alinhada com o usuário

- Igreja como ambiente isolado em banco compartilhado com RLS.
- Conta global, múltiplos vínculos locais e seletor simples.
- Papéis iniciais ADMIN, integrante e Mídia; função musical separada.
- Convite autorizado sem senha temporária ou segunda aprovação.
- Onboarding distinto para criador e convidado; configuração progressiva e opcional.
- Entrega gradual: fundação, convites, provisionamento assistido e cadastro público.
- Sem dashboard consolidado nem compartilhamento automático de acervo no MVP.
- Integrantes legados ficam ativos nos vínculos existentes, sem novo onboarding; convites passam a valer para novas entradas após o marco de corte.
- Nome/foto são globais e editados pela própria pessoa; ADMIN gerencia apenas atributos locais do vínculo.
- Notificações têm preferências por igreja e pausa global para comunicações opcionais; comunicações de acesso/segurança são separadas.
- Conexão Google pertence à pessoa, com escolha de igrejas sincronizadas e identificação da origem dos eventos.
- Criação pública exige e-mail confirmado e permite criar 1 igreja por pessoa/identidade, com ampliação somente por exceção autorizada da plataforma; participação por convite é independente da cota.

### Pendências antes de implementar/liberar cada etapa

| Tema | Definição necessária |
|---|---|
| Modelagem física | Reutilização de `ministers`, perfil global, constraints e migração compatível. |
| Fluxo Auth | Mecanismo Supabase de verificação/convite e callbacks seguros, compatíveis com mobile/webview. |
| Validade e reenvio | Validar proposta de 7 dias/60 segundos e limites globais de envio. |
| Criação pública | Definir limites de frequência e procedimento de exceção auditada à cota aprovada de 1 igreja por pessoa/identidade. |
| Comercial/jurídico | Plano inicial no servidor, ausência de cartão no MVP e textos aplicáveis. |
| Preferências/Google | Definir contratos técnicos, categorias de comunicação e migração das preferências/credenciais existentes para o modelo aprovado. |
| Operação da migração legada | Definir marco de corte e execução auditável/idempotente da ativação aprovada, preservando bloqueios globais e suspensões posteriores. |
| Extensão SaaS | Criar/refinar issue própria sem publicar detalhes sensíveis de isolamento. |

## 17. Ordem de execução futura

1. Refinar plano técnico e protótipos a partir desta SPEC; inventariar pontos de contexto único.
2. Implementar fundação multigreja, migração, autorização e seleção de ambiente com testes de isolamento.
3. Entregar WF-04: convites, aceite, estados de acesso e acompanhamento pela equipe.
4. Entregar provisionamento assistido e primeiros passos na WF-26.
5. Habilitar cadastro público somente após validar recuperação, isolamento e proteção contra abuso.
6. Acompanhar funil e uso real; evoluir cobrança, permissões específicas ou visão consolidada em escopos próprios.
