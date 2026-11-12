# WF-41: Auditoria de RLS e consultas que assumem um perfil por usuário

Data: 2026-11-12. Escopo: `app/`, `lib/`, `components/` e políticas RLS aplicadas no banco local (migrações 001–042).

## Resumo

- **60 ocorrências** de `.single()` / `.maybeSingle()` em **29 arquivos**.
- **Políticas RLS vivas não usam mais os helpers antigos** (`get_current_church_id`, `get_current_minister_id`, `is_admin`, `is_church_admin`, `has_lead_voice_role`), que ainda têm `LIMIT 1`. Verificado em `pg_policies` no banco local. As políticas atuais usam os helpers por membership (`wf04_*`).
- **O maior risco não é o RLS, e sim o service role.** 37 arquivos usam `createAdminClient()`, que ignora RLS. Nessas rotas, o isolamento depende só do filtro `church_id` escrito no código. Por isso o WF-39 precisa testar as rotas de API, não só o banco.

## Achados (ordenados por risco)

| # | Local | O que acontece | Risco |
|---|-------|----------------|-------|
| 1 | `lib/schedule/calendar-events.ts:52` | `buildMinisterCalendarEvents` busca `ministers` só por `id`, com service role, sem `church_id`. Os chamadores atuais passam ids vindos do banco (`lib/google-calendar/reconcile.ts:193`), mas a função não valida a igreja. | Médio |
| 2 | `lib/google-calendar/reconcile.ts:356` | `reconcileMinistersForQuarter` busca `schedule_quarters` só por `id`. Quatro rotas chamam com `quarter_id`. `event-control` e `rehearsal` validam a escala antes (a RPC `wf32_mutate_schedule` só grava se a escala pertence à igreja). Ainda assim, a função devia receber `churchId`. | Baixo a médio |
| 3 | `lib/google-calendar/client.ts:125`, `lib/google-calendar/reconcile.ts:168`, `:465` | `ministers` lido só por `id` (sem `church_id`) para obter `user_id`. Chamadores internos. | Baixo |
| 4 | `app/api/profile/avatar/route.ts:25`, `:69` | `.single()` em `user_profiles` falha com erro 500 se não houver perfil. Não é vazamento. | Robustez |
| 5 | `app/api/schedule/assignment/route.ts:41`, `app/api/church/settings/route.ts:41`, `app/api/platform/churches/*` | `.single()` após escrita. Falha se a linha não voltar. Filtros de igreja presentes. | Robustez |

## Consultas por usuário que são globais por desenho (sem mudança)

- `user_profiles` (`user_id`) e `google_calendar_credentials` (`user_id`): uma linha por usuário, por desenho.
- `platform_admins` e `lib/auth-context.ts`: consultas de plataforma, já tratadas.
- `lib/auth-context.ts` (memberships): usa a lista de vínculos, não um único perfil.

## Políticas RLS

- `songs`, `repertoire`, `special_events`, `schedule_quarters`, `schedule_assignments`, `schedule_rehearsals`, `ministers`, `churches`: políticas vivas usam `wf04_has_active_membership`, `wf04_is_active_church_admin`, `wf04_current_membership_id` e `wf04_has_lead_voice_role`. Todas verificam `church_id` da linha.
- Helpers legados continuam definidos no banco, sem uso em políticas. Remover é seguro depois de confirmar que nenhuma função ou trigger os chama. Proposta: migração nova, separada.

## Próximos passos

1. Passar `churchId` explicitamente nas funções internas dos achados 1–3 (mudança pequena, sem alterar comportamento).
2. Cobrir com teste de API as rotas que usam service role (próximo passo do WF-39).
3. Remover helpers legados em migração própria, depois de verificar dependências.

## Verificação

- `tests/wf39-isolation.local.test.cjs`: isolamento por RLS entre duas igrejas e um usuário com vínculo em ambas. Passou no banco local.
- `tests/wf39-api.local.test.cjs` (`pnpm test:wf39:api`): 35 cenários contra as rotas com service role e as rotas de usuário. Cobre: quarters (leitura, remoção, publicação, assignments, import preview e apply, criação com church_id forjado), ministers (acesso e remoção), songs/transfer, repertoire (cifra, adição, leitura e catálogo), rehearsal (leitura e alteração), assignment (por id e por quarter), event-control, admin analytics, current, ministers/search, notifications (sem segredo), platform (churches GET e PATCH, impersonation), church/settings, google-calendar (connect e sync-selection), preferences, profile, youtube/search, e troca de igreja por header. Inclui controles positivos (o dono da igreja B lê os próprios dados) e uma verificação final: o estado completo da igreja B (incluindo perfil e sincronização de calendário) fica igual ao inicial. Exige o Next em `127.0.0.1:3002` com o Supabase local, sem `SUPABASE_INTERNAL_URL`. Resultado: 35/35, sem sobras no banco após a execução.
- Limites: o cenário de repertório usa `expectedRevision: '0'`; a recusa pode vir da validação de revisão e não só do isolamento. A verificação de estado cobre o efeito, não a causa.
- Fora do escopo de cross-church (sem id de igreja na entrada): `profile/avatar` (upload), `google-calendar/status`, `google-calendar/sync` e `disconnect` (dados do próprio usuário), `context` POST, `notifications/schedule/process-queue` (cron), `platform/impersonation` GET/DELETE e `platform/churches` POST (criação). Invitations têm teste próprio em `invitations.local.test.cjs`.
- Rodar com `pnpm test:wf39:local` contra o banco local (credenciais do `compose.yaml`, perfil de teste).
- Outros testes locais executados no mesmo banco: `invitations` (9/9), `onboarding` (7/7) e `wf32` (2/2) passaram. `password-recovery`, `repertoire` e `schedule-media` exigem o perfil `test` do Compose (variáveis de ambiente do runtime) e não rodam fora dele.
