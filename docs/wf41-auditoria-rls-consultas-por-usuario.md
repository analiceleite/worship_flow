# WF-41: Auditoria de RLS e consultas que assumem um perfil por usuário

Data: 2026-11-12. Escopo: `app/`, `lib/`, `components/`, políticas RLS e buckets de storage aplicados no banco local (migrações 001–044).

## Resumo

- **60 ocorrências** de `.single()` / `.maybeSingle()` em **29 arquivos**.
- **Políticas RLS vivas não usam mais os helpers antigos** (`get_current_church_id`, `get_current_minister_id`, `is_admin`, `is_church_admin`, `has_lead_voice_role`), que ainda têm `LIMIT 1`. Verificado em `pg_policies` no banco local. As políticas atuais usam os helpers por membership (`wf04_*`).
- **O maior risco é o service role.** 37 arquivos usam `createAdminClient()`, que ignora RLS. Nessas rotas, o isolamento depende do filtro `church_id` escrito no código. Por isso o WF-39 testa as rotas de API, não só o banco.
- **Achado novo, crítico (corrigido na migração 044):** o bucket `cifras` (migração 022) permitia a qualquer usuário autenticado ler, criar, alterar e apagar PDFs de **qualquer igreja**. A auditoria inicial não cobria storage.
- **Achado novo, alto (corrigido na migração 044):** `youtube_search_cache` não tinha RLS e ficava acessível diretamente a `anon`/`authenticated`. Um usuário de uma igreja poderia gravar resultados que outra igreja leria. A rota usa só o cliente admin, então fechar o acesso direto não quebra nada.

## Achados

| # | Local | O que acontecia | Status |
|---|-------|-----------------|--------|
| 1 | `lib/schedule/calendar-events.ts` (`buildMinisterCalendarEvents`) | Buscava `ministers` só por `id`, com service role. | **Corrigido:** recebe `churchId` e filtra por `church_id`. Único chamador: `reconcileMinisterCalendar`, que já passa a igreja da linha. |
| 2 | `lib/google-calendar/reconcile.ts` (`reconcileMinistersForQuarter`) | Buscava `schedule_quarters` só por `id`. | **Corrigido:** recebe `churchId` e filtra. Quatro chamadores passam `context.churchId`: `church/settings`, `schedule/event-control`, `schedule/quarters/[id]/publish`, `schedule/rehearsal`. |
| 3 | `lib/google-calendar/client.ts` (`getUserIdForMinister`), `reconcile.ts` (`markConnectionBroken`, `disconnectChurchSync`) | `ministers` lido por `id` para obter `user_id`. | **Aceito, com justificativa:** `ministers.id` é chave primária e a consulta só mapeia uma linha para o `user_id` dela. Os ids vêm de contexto autenticado ou de linha já validada. Passar `churchId` aqui exigiria mudar o cron, que itera sem igreja. Revisar se o cron passar a carregar a igreja. |
| 4 | `app/api/profile/avatar/route.ts` | `.single()` em `user_profiles` vira erro 500 se não houver perfil. Não é vazamento. | Pendente (robustez). |
| 5 | `app/api/schedule/assignment/route.ts`, `app/api/church/settings/route.ts`, `app/api/platform/churches/*` | `.single()` após escrita. Filtros de igreja presentes. | Pendente (robustez). |
| 6 | Storage, bucket `cifras` (migração 022) | Políticas `TO authenticated USING (bucket_id = 'cifras')`: qualquer usuário lia, criava, alterava e apagava PDFs de qualquer igreja. | **Corrigido na migração 044.** Acesso só para membros ativos da igreja dona do objeto. Caminhos atuais `{churchId}/{songId}/cifra.pdf` e legados `{songId}/cifra.pdf` (dona = igreja da música). Demais caminhos negados. |
| 7 | `youtube_search_cache` (migração 023) | Sem RLS; acesso direto para `anon`/`authenticated`. Cache global por design, sem `church_id`, mas gravável por qualquer usuário logado. | **Corrigido na migração 044:** RLS ativado sem políticas e privilégios revogados. Só o service role acessa. |

## Consultas por usuário que são globais por desenho (sem mudança)

- `user_profiles` (`user_id`) e `google_calendar_credentials` (`user_id`): uma linha por usuário, por desenho.
- `platform_admins` e `lib/auth-context.ts`: consultas de plataforma, já tratadas.
- `lib/auth-context.ts` (memberships): usa a lista de vínculos, não um único perfil.
- Bucket `profile-avatars`: público por desenho (fotos de perfil). Escrita só pela rota de API, que checa o `user_id`. Nomes são UUIDs.
- `youtube_search_cache`: cache compartilhado de resultados públicos do YouTube, sem dados de igreja.

## Políticas RLS

- `songs`, `repertoire`, `special_events`, `schedule_quarters`, `schedule_assignments`, `schedule_rehearsals`, `ministers`, `churches`: políticas vivas usam `wf04_has_active_membership`, `wf04_is_active_church_admin`, `wf04_current_membership_id` e `wf04_has_lead_voice_role`. Todas verificam `church_id` da linha.
- Helpers legados continuam definidos no banco, sem uso em políticas. Remover é seguro depois de confirmar que nenhuma função ou trigger os chama. Proposta: migração nova, separada.

## Migração 044 (`scripts/044_wf39_cifras_storage_isolation.sql`)

- Nova função `public.wf39_cifra_path_allowed(text)`: aceita o caminho se a primeira pasta for um UUID e o usuário tiver membership ativa nessa igreja, ou se for o id de uma música de uma igreja em que ele é membro ativo.
- Substitui as quatro políticas antigas do bucket `cifras` por `wf39_cifras_read/insert/update/delete`.
- Revoga o acesso direto de `anon`/`authenticated` ao `youtube_search_cache` e ativa RLS nele.
- É idempotente (`CREATE OR REPLACE`, `DROP POLICY IF EXISTS`). Aplicada no banco local. **Ainda não aplicada em produção**: aplicar no SQL Editor do Supabase antes ou junto do deploy. Nenhum código novo depende dela, mas sem ela o bucket continua aberto entre igrejas.

## Próximos passos

1. Aplicar a migração 044 em produção e testar com um usuário real: uma cifra visível para a própria igreja e uma de outra igreja negada.
2. Cobrir com teste de API os achados 4 e 5 (robustez), se virarem problema.
3. Remover helpers legados em migração própria, depois de verificar dependências.
4. Integrar os testes WF-39 ao CI, depois da WF-40 (#51).

## Verificação

- `tests/wf39-isolation.local.test.cjs` (`pnpm test:wf39:local`): **1/1**. Cobre RLS entre duas igrejas, um usuário com vínculo nas duas, storage de cifras (leitura, alteração, remoção e upload nos caminhos atuais e legados, com controle positivo) e o cache do YouTube (sem leitura nem escrita por usuário).
- `tests/wf39-api.local.test.cjs` (`pnpm test:wf39:api`): **35/35** com o código atual, contra o Next em `127.0.0.1:3002` sem `SUPABASE_INTERNAL_URL`. Inclui as quatro rotas alteradas pelo achado 2 (`church/settings`, `event-control`, `rehearsal`, publicação de trimestre) e o controle positivo do dono da igreja B. Sem sobras no banco após a execução.
- Limites: o cenário de repertório usa `expectedRevision: '0'`; a recusa pode vir da validação de revisão e não só do isolamento. A verificação de estado cobre o efeito, não a causa.
- `tsc --noEmit`: único erro é o já existente em `tests/montar-escala.test.ts` (import com extensão `.ts`), fora desta mudança. `eslint` não está nas dependências do projeto, então o lint não foi executado.
- Fora do escopo de cross-church (sem id de igreja na entrada): `profile/avatar` (upload), `google-calendar/status`, `google-calendar/sync` e `disconnect` (dados do próprio usuário), `context` POST, `notifications/schedule/process-queue` (cron), `platform/impersonation` GET/DELETE e `platform/churches` POST (criação). Invitations têm teste próprio em `invitations.local.test.cjs`.
- Outros testes locais executados no mesmo banco antes desta rodada: `invitations` (9/9), `onboarding` (7/7) e `wf32` (2/2). `password-recovery`, `repertoire` e `schedule-media` exigem o perfil `test` do Compose e não rodam fora dele.
