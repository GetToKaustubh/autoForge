# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

**TubeForge** — multi-tenant YouTube automation SaaS. Monorepo with two packages: `apps/web` (Next.js frontend + API) and `packages/trigger` (Trigger.dev background tasks). The repo folder may be named `autoForge` (the planned rename from `youtube-automation-saas`). GitHub: `GetToKaustubh/autoForge`.

---

## Commands

All commands run from the **repo root** unless noted.

```bash
# Development
pnpm dev                         # Start all packages (turbo)
pnpm build                       # Build all packages
pnpm type-check                  # TypeScript check across all packages
pnpm lint                        # ESLint across all packages

# Database (runs in apps/web context)
pnpm db:push                     # Apply schema to Supabase (no migration file)
pnpm db:generate                 # Generate SQL migration files
pnpm db:studio                   # Open Drizzle Studio

# Testing
pnpm test                        # Vitest unit tests
pnpm test:e2e                    # Playwright E2E tests
cd apps/web && pnpm exec vitest run src/path/to/test.test.ts   # Single test file

# Trigger.dev task deployment (separate from web deploy)
cd packages/trigger && npx trigger deploy

# Vercel deployment
cd apps/web && vercel --prod     # Deploy web app (root dir must be apps/web in Vercel project)
```

Local dev env file: `apps/web/.env.local` (copy from `.env.example`).

---

## Architecture

### Monorepo Structure

```
apps/web/          → Next.js 15 App Router (Vercel)
packages/trigger/  → Trigger.dev v3 tasks (Trigger.dev cloud)
supabase/          → SQL migration files output
```

`packages/trigger` is **not deployed to Vercel** — it runs exclusively in Trigger.dev cloud. The web app calls `tasks.trigger(TASK_IDS.X, payload)` and returns immediately; tasks update the DB directly.

### Multi-Tenancy Model

- **Clerk** handles auth + organizations. Every request has `{ userId, orgId }` from `await auth()`.
- `orgId` is the Clerk org ID. The DB has its own UUID in `organizations.id`.
- Every API route calls `getOrgMember(orgId, userId)` from `lib/auth/get-member.ts` which returns `{ orgDbId, userDbId, role }`. Use `orgDbId` for all DB queries. Never use Clerk's `orgId` as a DB FK.
- RBAC: `canWrite(role)` = owner|admin|editor; `canAdmin(role)` = owner|admin only.

### Auth Pattern (every API route)

```ts
const { userId, orgId } = await auth()
if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const member = await getOrgMember(orgId, userId)  // resolves DB UUIDs
if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
```

### Database

- **Drizzle ORM** + **Supabase PostgreSQL** via PgBouncer (connection pooler).
- Schema: `apps/web/lib/db/schema/` — one file per domain, all exported from `index.ts`.
- `packages/trigger/src/lib/db/schema.ts` re-exports the web schema — no duplication.
- `db` singleton: `apps/web/lib/db/index.ts` (max 1 connection per serverless invocation).
- Trigger tasks use `packages/trigger/src/lib/db/index.ts` (max 5 connections, longer-lived).
- Drizzle config: `apps/web/drizzle.config.ts`. Migrations output to `supabase/migrations/`.

### Background Jobs (Trigger.dev v3)

All long-running work (AI generation, video processing, YouTube uploads) runs in Trigger.dev.

- Task IDs are centralized in `apps/web/lib/queue/client.ts` as `TASK_IDS` constants.
- Tasks live in `packages/trigger/src/tasks/<domain>/<name>.task.ts`.
- `trigger.config.ts` uses `dirs: ['./tasks']` — all task files are auto-discovered.
- **Logger format**: `logger.info(\`string message\`)` or `logger.info(\`message\`, { key: value })`. Do NOT use Pino-style `logger.info({ obj }, 'msg')` — Trigger.dev SDK rejects it.
- Tasks import DB/schema with dynamic `await import(...)` calls to avoid cold-start issues.

### Active Channel (Client State)

`useActiveChannel()` returns `ChannelInfo | null` directly (not destructured). The active channel is stored in Zustand (`stores/channel-store.ts`) with localStorage persistence. All dashboard pages gate on `if (!activeChannel)` before fetching.

```ts
const activeChannel = useActiveChannel()   // ✓ correct
const { activeChannel } = useActiveChannel()  // ✗ wrong — hook returns the value directly
```

### Encryption

YouTube OAuth tokens are AES-256-GCM encrypted before DB storage via `lib/utils/encryption.ts`. `ENCRYPTION_KEY` must be a 64-character hex string (32 bytes). **Never rotate this key** after channels are connected — existing tokens become unreadable.

### Rate Limiting

`lib/rate-limit/index.ts` exports `rateLimiters` (api, aiGeneration, uploads, oauthConnect, teamInvites) and `applyRateLimit(limiter, identifier)`. Call at the top of POST handlers before DB access.

### Caching

`lib/cache/redis.ts` exports `redis` (Upstash) and `cacheKeys` factory. Keyword results cached 24h; trend results cached 6h; OAuth state TTL 10 min.

### YouTube Quota

`lib/utils/quota.ts` exports `checkAndDeductQuota(channelId, operation)`. Uses Redis atomic decrement + DB mirror. Always call this before any YouTube Data API write operation. Upload = 1600 units/day limit of 10,000 per GCP project.

---

## Key Invariants

- **`pipelineStage` state machine** (videos table): `draft → script_ready → voice_ready → scenes_generating → scenes_ready → editing → render_queue → rendered → seo_optimized → scheduled → uploaded → published`. Can also transition to `failed`.
- **Clerk webhook** at `/api/webhooks/clerk` syncs users/orgs/memberships into Supabase. New users can't use the app until this fires.
- **`/api/webhooks/*`** routes are public (no Clerk auth) — verified by svix signatures instead.
- **`serverExternalPackages`** in `next.config.ts`: `['pino', 'pino-pretty', 'postgres']` — do not bundle these.
- **Vercel deployment**: root directory = `apps/web`, region = `bom1` (Mumbai). Config in `apps/web/vercel.json`.
- **Trigger.dev** tasks must be deployed separately (`cd packages/trigger && npx trigger deploy`) after any task code changes.

---

## Deployment Checklist

1. Set all env vars in Vercel (see `.env.example` for full list + `vercel env add` commands)
2. Create Supabase project (ap-south-1 region), run `pnpm db:push`
3. Create Trigger.dev project, `npx trigger deploy` from `packages/trigger`
4. Set up Clerk webhooks → `https://<domain>/api/webhooks/clerk` (events: user.created, user.updated, organization.created, organizationMembership.created)
5. Set up Google Cloud project → enable YouTube Data API v3 + YouTube Analytics API → OAuth 2.0 credentials with redirect URI `https://<domain>/api/auth/youtube/callback`
