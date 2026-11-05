# Plano de implementação — WF-07

**SPEC:** [SPEC-WF-07-repertorio-completo.md](../spec/SPEC-WF-07-repertorio-completo.md)

**PBI:** [WF-07 — Ordenação e compartilhamento do repertório completo](https://github.com/analiceleite/worship_flow/issues/3)

**Estado:** Implementado na branch `fix/wf-07-repertorio-completo`; validação automatizada realizada, revisão e implantação pendentes.

**Data:** 2026-11-05

## 1. Decisões aprovadas e limites

- D-01: impedir o mesmo `song_id` no evento, independentemente do ministro; não deduplicar por título.
- D-02: setas operam sobre a sequência global; a página acompanha o item movido; arraste limitado aos itens visíveis.
- D-03: recusar operações desatualizadas, atualizar a lista e solicitar nova tentativa, sem combinação automática.
- D-04: posições únicas e contíguas de 1 a N; normalizar legados por `order_index ASC, id ASC`, preservando itens e revisando duplicatas antes de restrições.
- Manter dez itens por página, permissões existentes e isolamento por igreja.
- Não implementar novo modelo definitivo de evento: coordenar com WF-06 e usar a identidade atual de igreja + data + nome.

Este arquivo planeja a implementação; não autoriza aplicar migração em produção nem remover dados legados.

### Progresso da entrega

- Banco: `scripts/036_repertoire_sequences.sql`, com controle de revisão, RPCs internas, normalização e proteção contra escritas fora do protocolo.
- API: `app/api/repertoire/route.ts`, `catalog/route.ts` e `cifra/route.ts`. O adaptador servidor ficou nas rotas; as transações e a autorização do ator são revalidadas nas funções SQL.
- Interface: snapshot completo, paginação local, movimentos globais, tratamento de conflitos/respostas atrasadas e exportação completa. Catálogo em lotes; cifras carregadas sob demanda na listagem e no player.
- Escritores adicionais: exclusão de evento, limpeza do repertório na exclusão de ministro e seed demonstrativo integrados ao protocolo.
- Testes e limites da validação: [WF-07-validation.md](WF-07-validation.md).
- Após a validação inicial, foi solicitada a preparação da release `1.1.1` com nota na central, commit e PR. Nenhuma migração remota ou deploy foi executado pelo agente.

## 2. Inspeção inicial e implicações

- `app/repertoire/page.tsx` concentra consulta paginada e mutações diretas no Supabase. Inclusão, ordenação, filtro de duplicatas e WhatsApp usam a página atual.
- `app/repertoire/player/page.tsx` consulta repertório separadamente e ordena apenas por `order_index`; alinhar leitura sem redesenhar o player.
- `lib/auth-context.ts` fornece `getCurrentMinisterContext()`, incluindo igreja efetiva e impersonação validada de administrador da plataforma. O cookie sozinho não autoriza a igreja.
- `scripts/031_simple_multitenancy_rls.sql` permite leitura na própria igreja, inclusão por admin/voz e atualização/exclusão por admin/voz. Conferir também políticas e grants posteriores.
- `scripts/032_simple_multitenancy_hardening.sql` contém índice de ordem com `id`, insuficiente para garantir posição única por evento.
- A última migração encontrada é `scripts/035_profile_avatars.sql`. Reservar a próxima numeração livre na implementação, sem presumir que 036 continuará disponível.
- Há testes com `node:test` e infraestrutura local via `pnpm local:test`; não há necessidade inicial de adotar outro framework para testes unitários e de banco.
- `scripts/001_create_tables.sql` é referência de esquema, explicitamente não executável. Integrar a nova migração ao fluxo local real, sem reconstruir banco a partir desse arquivo.

## 3. Arquitetura proposta

### 3.1. Estado autoritativo e concorrência

Criar uma tabela técnica de controle de sequência, provisoriamente `repertoire_sequences`, com chave única por igreja/data/nome canônico e revisão monotônica. Não é um cadastro de eventos nem substitui WF-06.

- Representar a revisão como string no contrato HTTP, evitando problemas de precisão de `bigint` no JavaScript.
- Centralizar a canonização de nome, incluindo tratamento de `NULL`/vazio legado; não aplicar `trim`, mudança de caixa ou outra fusão de eventos silenciosamente.
- Criar o controle sob demanda de forma segura, inclusive para eventos vazios. Uma linha de controle permanece após excluir o último item, evitando reutilizar revisão antiga.
- Cada mutação recebe `expectedRevision`, bloqueia a linha de controle com `FOR UPDATE`, compara a revisão, valida os dados, altera a sequência e incrementa a revisão na mesma transação.
- Em revisão divergente, não aplicar nenhum efeito e retornar conflito. Não repetir automaticamente com a revisão nova.
- Para leitura, retornar itens ordenados, total e revisão de um mesmo snapshot de banco. Evitar consultas independentes que associem uma revisão nova a itens antigos.
- Implementar a leitura completa como uma RPC que retorna um objeto JSON com a sequência e a revisão. Assim, o conjunto não depende do limite de linhas de uma consulta REST comum. Medir o tamanho do payload e não incluir conteúdo pesado de cifras desnecessariamente.

### 3.2. Escrita transacional e integridade

Propor RPCs de leitura e mutação, com nomes finais definidos na implementação. O comando de mutação admite `add`, `remove` e `move`:

1. Resolver a chave do evento e bloquear seu controle de sequência.
2. Comparar a revisão esperada e validar autorização/pertencimento.
3. Para `add`, validar música/ministro e ausência do `song_id`; inserir ao final global.
4. Para `remove`, validar pertencimento do item e removê-lo.
5. Para `move`, receber ID do item e posição global de destino, validar limites e calcular a nova sequência completa.
6. Renumerar a sequência afetada de 1 a N, incrementar revisão e retornar o novo snapshot.

Usar unicidade por evento/posição e evento/`song_id`, com tratamento explícito da chave de nome. A troca de posições precisa de restrição adiável ou estratégia transacional equivalente para não colidir durante atualizações intermediárias. Não usar `upsert` por música como substituto de detecção de duplicidade.

**Fechar todos os caminhos de escrita:** inventariar mutações de repertório no repositório, inclusive exclusão de evento e scripts. Escritas normais não podem continuar contornando revisão/bloqueio. Revogar DML direto dos papéis expostos após adoção das RPCs; não considerar apenas ocultar botões uma proteção.

### 3.3. Autorização e impersonação

- Entrada HTTP autenticada via `getCurrentMinisterContext()`; validar dados com Zod e derivar igreja, usuário e privilégios no servidor, nunca do corpo.
- Proposta: RPCs internas acessíveis somente a `service_role`, chamadas exclusivamente pelo módulo servidor após autenticação/autorização. Isso acomoda o contexto de impersonação existente sem fingir que o JWT comum tem acesso à igreja impersonada.
- Revogar execução de `PUBLIC`, `anon` e `authenticated` nessas RPCs; fixar `search_path` e qualificar tabelas nas funções. Nunca expor credenciais administrativas ao cliente.
- Revalidar na transação identidade/igreja/papel do ator; para impersonação, verificar administrador da plataforma. Não aceitar apenas um booleano de privilégio como prova.
- Para voz, obter instrumento e usar a regra de voz principal existente: inclusão em seu nome e de música própria, conforme o fluxo atual; admin escolhe música/ministro da igreja. Conferir paridade entre `lib/permissions.ts`, RLS e a regra efetiva antes de codificar.
- Leitura segue os perfis já autorizados; atualização/exclusão exigem admin ou voz. Validar todos os IDs contra igreja e evento, inclusive quando forem UUIDs válidos.
- Esse uso de cliente administrativo é excepcional e exige testes reais de acesso negativo, inclusive chamadas diretas às tabelas/RPCs. Service role não substitui autorização.

### 3.4. Contrato HTTP proposto

| Endpoint | Entrada | Saída |
|---|---|---|
| `GET /api/repertoire` | Data e nome do evento | Snapshot completo: `items`, `total`, `revision`. Sem cache compartilhado. |
| `POST /api/repertoire` | Evento, `expectedRevision`, comando e campos específicos | Snapshot confirmado após a mutação. |

- `items` contém os campos necessários para listagem, exportação e player; buscar conteúdo pesado de cifra sob demanda, preservando a experiência atual.
- Respostas de erro: `400` para entrada inválida, `401` sem sessão, `403` sem permissão, `409` para revisão divergente/duplicidade, `404` para recurso inexistente ou indisponível no contexto e `500` para falha inesperada. Não revelar existência de dados de outra igreja.
- Usar códigos estáveis, como `REPERTOIRE_CONFLICT` e `SONG_ALREADY_ADDED`, sem enviar erros SQL crus ao navegador.
- Separar rota, serviço de acesso e funções puras de sequência/formatação. Nomes sugeridos: `lib/repertoire/server.ts`, `lib/repertoire/types.ts`, `lib/repertoire/order.ts` e `lib/repertoire/whatsapp.ts`.

## 4. Etapas de execução

### Fase 0 — Confirmar compatibilidade e inventariar dados

- [x] Identificar todos os leitores/escritores de `repertoire`, incluindo exclusão de evento, scripts e eventuais dependências de outros cards.
- [x] Conferir esquema/grants efetivos, contexto de impersonação e regras de voz/propriedade de músicas.
- [x] Implementar pré-verificação de duplicatas/vínculos inválidos e normalização de posições na migração, validadas com fixtures locais.
- [ ] Revisar duplicatas encontradas sem publicar dados reais no PR. Aprovar tratamento individual antes de qualquer remoção ou restrição incompatível.
- [x] Documentar chave canônica e integração mínima com WF-06; `NULL` legado é normalizado para vazio, sem alterar caixa ou espaços de nomes.

**Saída:** pré-condições de migração claras e nenhum caminho de escrita desconhecido identificado na revisão.

### Fase 1 — Banco e protocolo transacional

- [x] Criar migração na próxima numeração livre: controle de sequência, normalização preservadora, restrições, RPCs e grants.
- [x] Abortar a migração com diagnóstico seguro se duplicatas/vínculos inválidos não resolvidos impedirem integridade; não aplicar saneamento parcial.
- [x] Normalizar posições por evento em transação, com `order_index ASC NULLS LAST, id ASC` para dados legados.
- [x] Implementar comparação de revisão sob bloqueio, mutações atômicas e snapshot consistente de leitura/retorno.
- [x] Garantir que toda mutação relevante atualize revisão, inclusive exclusões de evento; coordenar somente essa integração com WF-06, sem implementar sua política de ciclo de vida.
- [x] Restringir caminhos diretos de escrita. Testar que clientes antigos são recusados com segurança em vez de corromper a ordem.
- [x] Integrar migração às ferramentas locais e testar reexecução conforme as convenções existentes.

**Saída:** integridade demonstrada no Postgres local, incluindo evento vazio, falha e duas transações concorrentes.

### Fase 2 — Serviço e API

- [x] Implementar schemas de entrada e contratos tipados; validar data real, nome e posição global.
- [x] Implementar adaptação servidor com autorização explícita e chamadas às RPCs internas.
- [x] Criar rotas autenticadas, mapeamento de erros de domínio e respostas sem cache compartilhado.
- [x] Reaproveitar consultas de catálogo/ministros fora do snapshot; não recarregá-los ao trocar apenas a página.
- [x] Testar igreja efetiva, admin/voz/mídia e impersonação com dados fictícios.

**Saída:** API capaz de ler/mutar a sequência sem depender da página e sem aceitar contexto de autorização do cliente.

### Fase 3 — Listagem e edição

- [x] Em `app/repertoire/page.tsx`, manter snapshot completo e derivar a página visível com `slice`; usar total global e `Set` global de `song_id` para opções.
- [x] Remover cálculo local de `maxOrder` e atualizações individuais via `Promise.all`; enviar comandos com revisão confirmada.
- [x] Adotar inicialmente atualização confirmada pelo servidor, com controles de mutação desabilitados durante gravação, evitando complexidade otimista desnecessária.
- [x] Converter índices visíveis em posições globais; implementar setas entre páginas, acompanhamento do item e arraste na página.
- [x] Reiniciar página na mudança de evento/data, semana ou igreja; limitar página após redução de itens; limpar seleção de arraste e erros obsoletos.
- [x] Cancelar/ignorar respostas atrasadas por chave de contexto e geração da requisição; impedir que uma mutação iniciada no evento anterior altere a nova tela.
- [x] Em conflito, recarregar e apresentar a mensagem aprovada. Em perda de rede com resultado incerto, reconciliar antes de permitir repetir.
- [x] Exibir erros de leitura/exclusão além de ordenação; manter nomes acessíveis nas setas, estado ocupado e anúncio de erros.

**Saída:** navegação de três páginas íntegra e edição global pelo fluxo existente em desktop/mobile.

### Fase 4 — WhatsApp e compatibilidade do player

- [x] Extrair formatador puro preservando cabeçalho, data, artista, tom, capo e textos substitutos.
- [x] Na exportação, obter snapshot completo atualizado e capturar contexto do clique; se o contexto mudar, cancelar o compartilhamento.
- [x] Numerar todos os itens uma vez, pela ordem do snapshot, sem deduplicação silenciosa na formatação.
- [x] Bloquear exportação repetida, informar vazio/erro e nunca compartilhar um resultado parcial.
- [x] Reservar janela durante o gesto, remover `opener`, fechar em erro e avisar quando pop-up for bloqueado. Abertura desktop/mobile validada em navegador automatizado.
- [x] Alinhar o player ao mesmo serviço de leitura/ordem, sem alterar metronômo, reprodução ou cifras além da compatibilidade necessária.

**Saída:** mensagem idêntica a partir de qualquer página e sequência do player coerente com a listagem.

### Fase 5 — Testes, revisão e entrega

- [x] Criar testes unitários com `node:test`: limites/páginas, metadados, exportação completa e contratos de API; movimento/opções/normalização cobertos adicionalmente em banco e navegador.
- [x] Criar testes locais de integração com Auth/Postgres reais: revisão, atomicidade, restrições, grants, RLS aplicável e impersonação. Adaptar o executor local se selecionar apenas os testes atuais.
- [x] Concorrência com conexões independentes: mover/mover, mover/incluir, mover/excluir, incluir a mesma música e duas primeiras inclusões em evento vazio. Confirmar somente uma operação por revisão e ausência de alterações parciais.
- [x] Injetar falha dentro da transação e simular perda do resultado após commit; verificar rollback no primeiro caso e reconciliação sem duplicação no segundo.
- [ ] Cobrir os CA-01 a CA-12 da SPEC, incluindo respostas fora de ordem, exclusão do último item da página, dados legados e acessos negados diretos.
- [ ] Validar manualmente mobile/desktop, teclado, leitor de tela básico, WhatsApp e playlist; registrar evidências sem dados pessoais.
- [x] Executar testes novos, regressões relevantes, TypeScript e build; tentar `pnpm lint` e registrar bloqueio preexistente de ESLint ausente.
- [ ] Atualizar o progresso deste PLAN, relacionar PR ao PBI e registrar smoke check pós-deploy.

## 5. Migração, implantação e recuperação

1. Validar migração em banco local com fixtures legadas e revisar diagnóstico em ambiente autorizado antes de produção.
2. Coordenar janela de implantação: a revogação de escritas diretas é incompatível com clientes antigos. Bloquear temporariamente edição e orientar recarregamento; não deixar um período de escrita mista sem protocolo.
3. Aplicar a migração aprovada, publicar aplicação compatível e executar smoke check com inclusão, movimento entre páginas, exclusão, exportação e permissões.
4. Liberar edição após validação. Em falha, manter edição bloqueada e investigar; não reabilitar escritas antigas automaticamente nem apagar controles/revisões para voltar à versão anterior.
5. Plano de recuperação deve preservar os itens e a ordem confirmada. Restaurar backup ou desfazer alterações de esquema/dados exige revisão operacional específica, não um rollback destrutivo automático.

## 6. Riscos e condições de conclusão

- **WF-06:** mudanças futuras de identidade precisam migrar chave e revisão juntas; exclusão/renomeação não podem contornar o protocolo.
- **Payload:** leitura completa deve ser enxuta; medir com 25 e com volume maior, sem truncamento silencioso nem cifras grandes em cada snapshot.
- **Service role:** RPC interna exige autorização explícita e teste de grants. Não entregar com endpoint que confie em igreja/papel enviados pelo cliente.
- **Legados:** revisão de duplicatas é condição para restrição, não autorização de exclusão automática.
- **Clientes antigos/PWA:** considerar abas abertas e cache no rollout; recusar escrita incompatível com aviso recuperável.

Concluir a entrega somente quando todos os critérios da SPEC tiverem evidência, nenhuma mutação normal contornar o protocolo e migração/recuperação estiverem revisadas. A implementação e os testes locais estão registrados no relatório; revisão humana, validação em dispositivo/leitor de tela e implantação continuam pendentes.
