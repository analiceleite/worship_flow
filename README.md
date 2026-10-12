# Worship Flow

Worship Flow is a multitenant web application for worship ministry management. It helps churches organize songs, repertoires, bimonthly schedules, team members, email reminders, chord sheets, YouTube references, and Google Calendar integration.

The app is built as a simple SaaS platform: one deployment can serve multiple churches, with data isolation by `church_id`, internal platform administration, tenant impersonation, and a public demo environment.

## Live Demo

Access the application here:

```txt
https://worship-flow-kappa.vercel.app/
```

Demo credentials:

```txt
Email: demo@worshipflow.app
Password: Demo@12345
```

The demo tenant contains fake data only and is isolated from production church data.

## Current State

- Multitenant application organized by church.
- Current model: `1 auth user = 1 minister = 1 church`.
- A user can also be a platform administrator through `platform_admins`.
- Core data is isolated by `church_id`.
- Platform administrators can manage tenants at `/platform/churches`.
- Platform administrators can impersonate a church for support and setup.
- The header displays the active church next to the app name.
- A public demo church is available for portfolio/demo access.

## Features

### Platform And Multitenancy

- Church/tenant management.
- Data isolation for users, songs, repertoires, schedules, special events, notifications, and integrations.
- Effective church context for client-side and server-side pages.
- Church impersonation by platform administrators.
- Impersonation audit log in `platform_impersonation_audit`.
- Church environments: `production`, `demo`, and `test`.
- Church email modes: `real`, `disabled`, and `test_recipient`.

### Song Management

- Create, edit, and delete songs.
- Main key and available keys.
- Chord sheet and YouTube links.
- Chord sheet content in text/PDF format.
- Chord sheet import/backfill utilities.
- YouTube search with cache.
- Key validation and audit scripts.

### Repertoire

- Organize songs by service date.
- Reorder repertoire items.
- Named special events.
- Repertoire player view.
- Tenant-isolated repertoire data.

### Bimonthly Schedule

- Create bimonthly schedule periods.
- Thursday and Sunday service types.
- Ministers, trainees, apprentices, and sound technician assignments.
- Rehearsal information per service.
- Schedule publishing.
- Admin schedule dashboard.

### Users And Permissions

- `admin`: manages users, songs, repertoire, and schedules for their own church.
- `minister`: manages their own songs and views repertoire/schedule data.
- `midia`: limited access to repertoire/schedule views.
- Supabase RLS reinforces tenant isolation and role-based permissions.

### Notifications And Calendar

- Email notifications through Resend.
- Configurable reminder offsets.
- Published schedule notifications.
- Async email queue.
- Test-recipient email interception.
- Google Calendar integration per minister.

### Interface

- Next.js App Router.
- Responsive desktop/mobile UI.
- Light/dark theme.
- Radix UI + Tailwind components.
- Installable PWA.

## Tech Stack

- Next.js 16
- React 19
- TypeScript 5.7
- Tailwind CSS 4
- Supabase Auth + Postgres + RLS
- Resend
- Google APIs
- pnpm 9.15

## Requirements

- Node.js 20+
- pnpm 9.15+
- Supabase project
- Resend account for real emails
- Google OAuth credentials if calendar integration is enabled

## Environment Variables

Create `.env.development.local` and `.env.production.local` as needed.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

APP_BASE_URL=http://localhost:3000

CRON_SECRET=random-secret
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@yourdomain.com
SCHEDULE_EMAIL_TEST_RECIPIENT=test-email@domain.com

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

CIFRACLUB_IMPORTER_URL=http://localhost:3010
CIFRACLUB_IMPORTER_TOKEN=internal-token
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` must never be exposed to the browser.
- `CRON_SECRET` must match the GitHub Actions secret.
- `SCHEDULE_EMAIL_TEST_RECIPIENT` intercepts emails when a church uses `test_recipient` mode.
- Demo/test churches should not use `email_mode = real`.

## Install And Run

```bash
pnpm install
pnpm dev
```

The app runs at:

```txt
http://localhost:3000
```

Production build:

```bash
pnpm build
pnpm start
```

Or:

```bash
pnpm prod
```

TypeScript validation:

```bash
pnpm exec tsc --noEmit
```

Lint:

```bash
pnpm lint
```

Note: `pnpm lint` calls `eslint .`, but the `eslint` package must be installed/declared for the command to work in the current environment.

## Database Setup

Run the SQL files in order in the Supabase SQL Editor.

```txt
scripts/001_create_tables.sql
scripts/016_consolidate_access_policies.sql
scripts/017_add_is_trainee_to_schedule_assignments.sql
scripts/018_add_apprentice_schedule_role.sql
scripts/019_add_cifra_content_to_songs.sql
scripts/020_create_password_resets.sql
scripts/021_add_schedule_rehearsals.sql
scripts/022_song_cifra_pdf_storage.sql
scripts/023_youtube_search_cache.sql
scripts/024_add_calendar_feed.sql
scripts/025_add_email_reminder_offsets.sql
scripts/026_add_google_calendar_integration.sql
scripts/027_remove_ics_calendar_subscription.sql
scripts/028_add_sound_technician_schedule_role.sql
scripts/029_add_available_tones_to_songs.sql
scripts/030_simple_multitenancy_base.sql
scripts/031_simple_multitenancy_rls.sql
scripts/032_simple_multitenancy_hardening.sql
```

Migrations `030`, `031`, and `032` add the multitenant foundation, tenant-aware RLS, final constraints, indexes, and `church_id` hardening.

## First Platform Access

The first operator must exist in Supabase Auth, have a corresponding `ministers` record, and be promoted to `platform_admins`.

Example:

```sql
insert into public.platform_admins (user_id)
select user_id
from public.ministers
where email = 'your-email@domain.com'
on conflict (user_id) do nothing;
```

Then access:

```txt
/platform/churches
```

## New Church Setup

The full operational guide is available at:

```txt
sdd/plan/new-church-setup-readme.md
```

Summary:

1. Log in as a platform administrator.
2. Open `/platform/churches`.
3. Create the church with `environment = production` and `email_mode = real`.
4. Impersonate the church.
5. Confirm the tenant starts empty.
6. Create the first church admin at `/users`.
7. Stop impersonation.
8. Ask the church admin to configure ministers, songs, repertoires, and schedules.

Minimum delivery checklist:

- Header shows the correct active church name.
- `/users` only shows users from the new church.
- `/songs` only shows songs from the new church.
- `/repertoire` does not show data from another church.
- `/schedule` does not show data from another church.
- Email mode is configured correctly.
- Impersonation can be stopped successfully.

## Demo Tenant

Populate or recreate the default demo church with:

```bash
node scripts/seed-demo-worship-flow.mjs
```

Demo credentials:

```txt
Email: demo@worshipflow.app
Password: Demo@12345
```

Use the demo tenant for public presentations and portfolio access. Consider rotating the password if you want tighter control over access.

## Email Automation

The email workflow is located at:

```txt
.github/workflows/schedule-email-reminders.yml
```

Required GitHub Actions secrets:

| Secret | Value |
| --- | --- |
| `APP_BASE_URL` | Public app URL |
| `CRON_SECRET` | Same value used in production env |

Flow:

1. Publishing a schedule enqueues notifications.
2. Cron jobs enqueue reminder emails.
3. The queue sends emails through Resend.
4. The church email mode controls real delivery, testing, or disabled delivery.

## Useful Scripts

Chord sheet backfill:

```bash
pnpm backfill:cifras
pnpm backfill:cifras:dry
```

Song key audit:

```bash
pnpm audit:tones
pnpm audit:tones:fix
pnpm audit:tones:rewrite
```

Demo seed:

```bash
node scripts/seed-demo-worship-flow.mjs
```

Original schedule XLSX export:

```bash
node scripts/generate-original-schedule-xlsx.mjs
```

## CifraClub Importer

CifraClub links can be imported through the Playwright microservice in `services/cifraclub-importer`.

Run locally:

```bash
docker build -t worship-flow-cifraclub-importer services/cifraclub-importer
docker run --rm -p 3010:3010 -e CIFRACLUB_IMPORTER_TOKEN=internal-token worship-flow-cifraclub-importer
```

Details:

```txt
services/cifraclub-importer/README.md
```

## Project Structure

```txt
app/
  api/
    context/                 # effective user/church context
    platform/                # internal platform endpoints
    schedule/                # schedules, quarters, assignments
    songs/                   # song management
    notifications/           # emails and cron endpoints
  platform/churches/         # internal tenant management
  songs/                     # song management UI
  repertoire/                # repertoire UI
  schedule/                  # schedule UI
  users/                     # church users/ministers

components/
  header.tsx                 # navigation, active church, impersonation banner
  song-form.tsx
  minister-form.tsx
  schedule/
  ui/

lib/
  auth-context.ts            # multitenant context and impersonation
  supabase/                  # server/client/admin clients
  notifications/
  google-calendar.ts
  types.ts

scripts/
  001_*.sql ... 032_*.sql    # schema and migrations
  seed-demo-worship-flow.mjs
  backfill-cifras.mjs
  audit-song-tones.mjs
```

## Security Notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY`.
- Rotate keys if they are accidentally shared.
- Grant `platform_admins` access only to trusted internal operators.
- Use impersonation only for support, setup, and demos.
- Validate tenant isolation before delivering a new church.
- Do not use real email delivery in demo/test tenants.

## Troubleshooting

### Data From Another Church Appears

Stop the setup and investigate immediately.

Check:

- Whether the page/API uses `getCurrentMinisterContext()` or `/api/context`.
- Whether the query filters by the effective `churchId`.
- Whether the table has a non-null `church_id`.
- Whether the corresponding RLS policy includes `church_id`.

### Supabase Permission Denied

Check:

- The user exists in `auth.users`.
- A corresponding row exists in `public.ministers`.
- `ministers.user_id` points to the correct auth UUID.
- `ministers.church_id` is set.
- Role is one of `admin`, `minister`, or `midia`.

### Emails Are Not Sent

Check:

- `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.
- `CRON_SECRET` in both production env and GitHub Actions.
- The church `email_mode`.
- The church `environment`.
- Logs from the `schedule-email-reminders` workflow.

### Stale Service Worker/PWA

In the browser:

1. DevTools > Application > Service Workers > Unregister.
2. Clear Cache Storage.
3. Close and reopen the app.
4. If installed as a PWA, reinstall it.

## Internal Docs

- `sdd/spec/simple-tenant-multitenancy-spec.md`
- `sdd/plan/simple-tenant-multitenancy-plan.md`
- `sdd/plan/new-church-setup-readme.md`
