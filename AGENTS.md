# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Worship Flow** is a Next.js web application for managing music repertoires and schedules for worship ministries. It includes role-based authentication (admin/minister), music management with cifra/YouTube links, and quarterly schedule management with email notifications.

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
pnpm lint             # Run ESLint on all files
```

**Data Management**
```bash
pnpm backfill:cifras           # Fetch missing song ciphers from web sources
pnpm backfill:cifras:dry       # Preview cipher backfill without changes
pnpm audit:tones               # Check for tone inconsistencies in songs
pnpm audit:tones:fix           # Fix individual song tones
pnpm audit:tones:rewrite       # Rewrite cipra content based on tone
```

> **Note on dev mode**: The dev script uses WATCHPACK_POLLING and CHOKIDAR_USEPOLLING for Windows file watching compatibility.

## Architecture

### Directory Structure

- **`app/`** — Next.js App Router pages and API routes
  - `app/auth/` — Login, password reset, set-password flows
  - `app/songs/` — Song management page (create/edit/delete)
  - `app/repertoire/` — View minister's scheduled songs
  - `app/schedule/` — Schedule views and admin builder
  - `app/api/` — Backend API endpoints (grouped by feature: `/schedule`, `/songs`, `/notifications`, etc.)
  - `app/api/notifications/schedule/` — Email reminder scheduling (7 days, 1 day, publish notifications)
  
- **`lib/`** — Utilities and clients
  - `lib/supabase/` — Supabase client factories (server, client, admin)
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
- **Roles**: `admin` (full access), `minister` (own songs/schedule), `midia` (limited access)
- Admin can manage ministers; ministers see only their own data
- User identification via `supabase.auth.getUser()` and mapping to `ministers` table

### Key Features

**1. Song Management**
- Ministers create/edit/delete their own songs
- Admin can view all songs, manage musician assignments
- Each song tracks: title, artist, tone, cipher URL, YouTube URL, capo frets, cifra PDF content
- Tones are validated against `TONES` constant (13 major + 13 minor keys)

**2. Repertoire & Scheduling**
- Quarterly schedule builder (admin feature)
- Bimestral periods with start/end dates
- Service types: Thursday (rehearsal), Sunday (service)
- Admin assigns ministers to services and builds repertoires
- Ministers view their assigned songs for upcoming services

**3. Email Notifications**
- Cron workflow (GitHub Actions) runs daily at 11:00 UTC
- Enqueues 7-day and 1-day reminders for upcoming services
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
- Authenticates via cookies; respects RLS policies automatically
- Common pattern in page components:
  ```typescript
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase.from('table').select('*')
  ```

### Client-Side Data Fetching
- Use `lib/supabase/client.ts` for client components (`'use client'`)
- Call API routes instead of querying Supabase directly for complex logic
- Example: fetch `/api/songs` instead of direct `supabase.from('songs')`

### API Route Convention
- All API routes are async and return `NextResponse`
- Authenticate and authorize early; use `createAdminClient()` for operations that bypass RLS (rare)
- Validate request bodies with Zod when receiving form data
- Example structure:
  ```typescript
  export async function POST(request: Request) {
    const { user } = await authenticateRequest()
    const body = await request.json()
    // validate, execute, return NextResponse.json()
  }
  ```

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
- Admins bypass certain policies to manage all data
- Ministers only see/edit their own songs
- Schedule assignments controlled by role and quarter ownership
- Check `scripts/` SQL files for exact policy definitions

**Migrations**:
- Scripts numbered sequentially (001, 003, 004, etc.)
- Always run in order; some depend on earlier tables
- Import new migrations in Supabase SQL Editor before deploying

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
- Use `console.log()` freely; it appears in server terminal and browser console
- Check Supabase dashboard for RLS errors during development
- YouTube search and cipher fetch can be slow; add loading spinners for UX

**Testing Workflows**:
- Test auth flows by creating test accounts in Supabase
- Test admin vs. minister access by logging in as different roles
- For email notifications, set `SCHEDULE_EMAIL_TEST_RECIPIENT` to intercept all mail
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
