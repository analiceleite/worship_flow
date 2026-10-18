# AGENTS.md

This file is the shared guidance for AI coding agents working in this repository. Keep it aligned with the implementation; do not treat historical plans as proof that a feature is implemented.

## Agent Working Agreement

- Read the relevant implementation and nearby patterns before editing. Keep changes focused on the user's request; do not add unrelated refactors, dependencies, or infrastructure.
- Preserve existing user changes. Never discard, reset, or overwrite unrelated work.
- Use pnpm and the existing UI, authentication, and data-access helpers. Do not invent helpers or endpoints: verify their existence first.
- Never read or print secret-bearing `.env` files, tokens, cookies, service-role keys, or production credentials. Use documented variable names and placeholders. Ask for sanitized diagnostics if configuration is needed.
- Do not run migrations, backfills, data rewrites, production requests, notification delivery, deployments, or destructive commands without explicit authorization for the target environment. A development server can still connect to a production database.
- Treat authentication, RLS, tenant boundaries, impersonation, and service-role access as security-sensitive. Follow the invariants below even when nearby legacy code does not.
- For schema changes, add a dedicated SQL migration following the existing naming conventions; do not rewrite previously applied migrations. Include constraints, indexes, tenant isolation, and a safe verification procedure as appropriate. Creating a migration does not authorize running it.
- For behavior changes, add or update tests when a test harness exists. Otherwise describe concrete manual checks and explicitly disclose the lack of automated coverage; do not add a new test framework unless it is within scope.

### Definition of Done

- Review the final diff for unintended changes, secrets, tenant leaks, and missing error handling.
- Run the relevant available checks described below for code changes. For documentation-only changes, review accuracy and run `git diff --check`; application builds are not required.
- If a check fails, distinguish pre-existing failures from regressions where possible. Do not silently weaken types, validation, RLS, or checks to make a command pass.
- Report what changed, which checks actually ran and their results, and any unverified behavior, manual steps, or migrations still required. Never claim tests passed when they were not run.

## Project Overview

**Worship Flow** is a multitenant Next.js web application for managing music repertoires and schedules for worship ministries. Operational data is isolated by church (`church_id`), with church-level roles and separate platform administration/impersonation. Features include music management with cifra/YouTube links and schedule management with email notifications.

**Tech Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Supabase (Auth + Postgres + RLS), pnpm

## Common Commands

**Development**
```bash
pnpm install           # Install dependencies
pnpm dev              # Start dev server (http://localhost:3000) with polling enabled for Windows
pnpm prod             # Build and start production server
```

**Build & Testing**
```bash
pnpm build            # Build for production
pnpm exec tsc --noEmit # Explicit TypeScript check (no typecheck script yet)
pnpm test:cifra       # Cifra import tests (vitest, jsdom)
pnpm lint             # Intended ESLint check; currently incomplete (see below)
git diff --check      # Check patch whitespace/errors
```

**Current validation limitations**:
- `next.config.mjs` enables `typescript.ignoreBuildErrors`; a successful build is NOT proof of type safety. Run the explicit TypeScript check for TypeScript changes.
- `package.json` defines `lint`, but does not currently declare ESLint or a versioned ESLint configuration. Report this limitation rather than claiming lint passed or installing tools implicitly.
- There is no project test script or configured automated test suite yet. Do not invent `pnpm test` results. Prioritize tenant isolation, role authorization, impersonation, and repertoire/schedule flows when tests are introduced.
- Builds and checks may need dependencies or environment configuration. If blocked, report the exact limitation without accessing secrets or production to unblock them.

**Data Management**
```bash
pnpm backfill:cifras           # Fetch missing song ciphers from web sources
pnpm backfill:cifras:dry       # Preview cipher backfill without changes
pnpm audit:tones               # Check for tone inconsistencies in songs
pnpm audit:tones:fix           # Fix individual song tones
pnpm audit:tones:rewrite       # Rewrite cipra content based on tone
```

> **Note on dev mode**: The dev script uses Windows `set` syntax with WATCHPACK_POLLING and CHOKIDAR_USEPOLLING. Do not assume it works unchanged in Linux/macOS shells.

## Architecture

### Directory Structure

- **`app/`** — Next.js App Router pages and API routes
  - `app/auth/` — Login, password reset, set-password flows
  - `app/songs/` — Song management page (create/edit/delete)
  - `app/repertoire/` — View minister's scheduled songs
  - `app/schedule/` — Schedule views and admin builder
  - `app/api/` — Backend API endpoints (grouped by feature: `/schedule`, `/songs`, `/notifications`, etc.)
  - `app/api/notifications/schedule/` — Configurable offset reminders, publish notifications, and queue processing
  
- **`lib/`** — Utilities and clients
  - `lib/supabase/` — Supabase client factories (server, client, admin)
  - `lib/auth-context.ts` — Authenticated church context, platform-admin authorization, and impersonation helpers
  - `lib/types.ts` — Core TypeScript interfaces (Minister, Song, RepertoireItem, etc.)
  - `lib/permissions.ts` — Permission checks (e.g., `hasLeadVoiceRole()`)
  - `lib/routes.ts` — Route constants for navigation
  - `lib/cifra-*.ts` — Cipher scraping and URL utilities (cifraclub, cifralize, PDF storage)
  - `lib/notifications/schedule-email.ts` — Email scheduling logic
  - `lib/youtube-search-cache.ts` — YouTube video search and caching
  
- **`components/`** — Reusable React components
  - `components/ui/` — Radix UI + Tailwind styled components (button, dialog, form, etc.)
  - `components/song-form.tsx` — Song creation/edit form with YouTube/cifra validation
  - `components/schedule/` — Schedule-specific components (ScheduleGrid, BimesterForm)
  - `components/cifra-viewer.tsx` — PDF/content viewer for ciphers
  
- **`scripts/`** — Migration scripts (SQL) and utilities (Node.js)
  - SQL migrations: create tables, RLS policies, schedule rehearsal tables
  - Node.js backfill/audit utilities for data management

- **`sdd/`** — Feature specifications and implementation plans; verify their status against code
  - `sdd/plan/simple-tenant-multitenancy-plan.md` — Tenant-isolation principles and migration plan
  - `sdd/plan/new-church-setup-readme.md` — Church onboarding and isolation verification guidance

### Core Entities & Relationships

**Key Types** (from `lib/types.ts`):
- **Minister**: user with role (admin/minister/midia), instrument (voice, guitar, etc.), avatar
- **Song**: music entry with title, artist, tone, cipher/YouTube URLs, owner (minister_id)
- **RepertoireItem**: scheduled song for an event with song_id, event_date, order_index
- **ScheduleQuarter**: bimestral period for organizing assignments
- **ScheduleAssignment**: minister + service (thursday/sunday) mapping for a quarter

**Database Structure**:
- `ministers` table with auth integration (user_id references auth.users)
- `songs` table linked to ministers (minister_id)
- `schedule_quarters` for quarterly periods
- `schedule_assignments` mapping ministers to service types
- `schedule_rehearsals` for rehearsal scheduling per service
- RLS policies enforce role-based data access

### Authentication & Authorization

- **Supabase Auth** with implicit flow for mobile/webview compatibility
- **Role-based access control** via RLS policies and `lib/permissions.ts`
- **Church roles**: `admin`, `minister`, `midia`. Church admins are not global admins; role-specific access must stay within the effective church.
- Resolve church-scoped server access through `getCurrentMinisterContext()` in `lib/auth-context.ts`; use `{ requireAdmin: true }` for church-admin-only operations.
- Platform administration is separate from `ministers.role`, uses `platform_admins`, and must be authorized with `authenticatePlatformAdmin()`.

### Tenant Isolation and Impersonation (Mandatory)

- Resolve the effective `churchId` from authenticated server context, including authorized impersonation. Never trust a `church_id` from request bodies, query parameters, or client state as authorization.
- Every query on tenant-scoped data must be scoped by `church_id` or protected by verified equivalent RLS. Inspect the actual schema and policies rather than assuming RLS covers a new access path.
- `createAdminClient()` bypasses RLS. For church-scoped operations, explicitly filter reads, updates, and deletes by the effective `churchId`, and set `church_id` from server context on inserts. A filter by record ID alone is insufficient.
- Validate that referenced records (minister, song, quarter, assignment, event, etc.) belong to the same effective church before linking them. Validate permissions in addition to tenant ownership.
- The impersonation cookie alone is not authorization. Reuse the context helpers, which verify platform-admin membership. Do not implement a second cookie-based authorization path.
- During impersonation, use the effective `churchId`; do not derive it from the platform user's original minister record. Do not assume the context's `ministerId` identifies a minister in the impersonated church.
- Keep intentionally cross-tenant platform operations and scheduled jobs separate from ordinary church routes. Verify their platform-admin/cron authorization and preserve per-church scoping during processing; do not turn a church endpoint into an unscoped service-role query.
- Check isolation for all affected access paths: pages, APIs, scripts, storage, integrations, and notifications. Do not expose another church's records through related-record lookups or error responses.

### Key Features

**1. Song Management**
- Ministers create/edit/delete their own songs
- Admin can view songs and manage musician assignments within the effective church, subject to feature-specific permissions
- Each song tracks: title, artist, tone, cipher URL, YouTube URL, capo frets, cifra PDF content
- Tones are validated against `TONES` constant (13 major + 13 minor keys)

**2. Repertoire & Scheduling**
- Quarterly schedule builder (admin feature)
- Bimestral periods with start/end dates
- Service types: Thursday (rehearsal), Sunday (service)
- Admin assigns ministers to services and builds repertoires
- Ministers view their assigned songs for upcoming services

**3. Email Notifications**
- Cron workflow (`.github/workflows/schedule-email-reminders.yml`) is scheduled every 15 minutes; GitHub Actions execution is best-effort
- Enqueues configurable offset reminders for upcoming services
- Sends schedule-published notifications
- Email queue processed asynchronously
- Configurable test recipient for development

**4. Cipher Integration**
- Fetches cipher data from CifraClub and Cifralize APIs
- Stores PDF paths and text content in `cifra_content` column
- Validates tone consistency across sources
- Backfill and audit scripts for data maintenance

**5. PWA Support**
- Service Worker at `public/sw.js`
- Manifest configured in `app/manifest.ts`
- `components/pwa-register.tsx` registers SW in production

## Important Implementation Patterns

### Server-Side Data Fetching
- Use `lib/supabase/server.ts` for server components and API routes
- The session client uses cookies and is subject to RLS, but does not replace permission checks or effective-church scoping, especially during impersonation.
- Resolve context before church-scoped access. Example for a session/RLS-backed query (not a complete impersonation data-access implementation):
   ```typescript
   import { getCurrentMinisterContext } from '@/lib/auth-context'
   import { createClient } from '@/lib/supabase/server'

   const { churchId } = await getCurrentMinisterContext()
   const supabase = await createClient()
   const { data, error } = await supabase
     .from('songs')
     .select('id, title')
     .eq('church_id', churchId)
   // Handle errors and apply any additional role/ownership restrictions.
   ```
- For impersonation-capable operations, follow the relevant existing route's authorized access pattern. Do not disable RLS or switch to the admin client merely to fix an access error.

### Client-Side Data Fetching
- Use `lib/supabase/client.ts` for client components (`'use client'`)
- Call API routes instead of querying Supabase directly for complex logic
- Reuse actual existing API routes where available; verify their paths and authorization rather than assuming a generic `/api/songs` endpoint exists.

### API Route Convention
- All API routes are async and return `NextResponse`
- Authenticate and authorize early using the appropriate context helper; service-role operations require explicit tenant scoping as described above
- Validate request bodies with Zod when receiving form data
- Handle `AuthContextError` with its intended HTTP status; do not turn authentication/authorization failures into generic server errors. Follow nearby route patterns for validation and database errors.

### Form Handling
- Use `react-hook-form` + `zod` for validation
- `components/song-form.tsx` and `components/minister-form.tsx` show patterns
- Async operations (YouTube search, cipher fetch) happen on form submit

### UI Components
- All UI built with Radix UI + Tailwind CSS, wrapped in `components/ui/`
- Use `Button`, `Dialog`, `Form`, `Input`, `Select` etc. from these wrappers
- Icons from `lucide-react`
- Toast notifications via `sonner` and `components/ui/sonner.tsx`

## Database Notes

**RLS Policies**:
- Church admin privileges do not grant cross-church access
- Apply feature-specific role/ownership rules in addition to church isolation
- Schedule assignments controlled by role and quarter ownership
- Check `scripts/` SQL files for exact policy definitions

**Migrations**:
- Scripts numbered sequentially (001, 003, 004, etc.)
- Read each script's header and dependencies before proposing an execution order. Not every SQL file is an executable migration.
- `scripts/001_create_tables.sql` is a reference snapshot explicitly marked not to execute; do not use it as a clean-database bootstrap or run every SQL file blindly.
- Document required migrations and verification steps for deployment. Do not execute them against any database without explicit authorization and a confirmed target environment.

## Environment Variables

Create `.env.development.local` and `.env.production.local` with:
```env
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
APP_BASE_URL=http://localhost:3000  # dev
CRON_SECRET=<random-secret-for-cron-jobs>
RESEND_API_KEY=<email-service-key>
RESEND_FROM_EMAIL=noreply@seudominio.com
SCHEDULE_EMAIL_TEST_RECIPIENT=<optional-test-email>
```

> Supabase credentials are in your project settings. `CRON_SECRET` must match the GitHub Actions secret.

## Development Tips

**Debugging**:
- Use focused diagnostics; never log credentials, auth headers, cookies, or sensitive user/church data. Remove temporary debugging before delivery.
- Check Supabase dashboard for RLS errors during development
- YouTube search and cipher fetch can be slow; add loading spinners for UX

**Testing Workflows**:
- Use an explicitly approved test environment and synthetic accounts/data; do not create accounts or modify a shared/production database implicitly
- Check unauthenticated requests, each affected role, and access attempts between two churches (including foreign record IDs in reads and mutations)
- For impersonation changes, check normal church access, authorized impersonation, rejected non-platform-admin attempts, and exiting impersonation
- For notification changes, verify the effective church's email mode and recipient routing. A configured `SCHEDULE_EMAIL_TEST_RECIPIENT` is not permission to send email; obtain authorization before triggering delivery
- Use browser DevTools → Application → Manifest to verify PWA installability

**Common Issues**:
- **`pnpm-lock.yaml` out of sync**: Run `pnpm install` locally and commit the lock file
- **RLS permission denied**: Verify user role in `ministers` table matches your auth token
- **YouTube/Cipher fetch fails**: Check API rate limits (Cifralize rate limits per IP; Resend requires valid key)
- **Service Worker cache stale**: Clear browser cache and reinstall PWA after updates

## Future Considerations

- Add automated tests for critical flows (auth, RLS, repertoire assignment)
- Expand special events catalog with seasonal/recurring event templates
- Implement automatic deploy pipeline (GitHub Actions + Vercel)
- Consider migrating from implicit auth flow if webview support isn't needed
