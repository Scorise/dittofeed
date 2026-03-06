# Auth Keycloak System — Reference

> Last updated: 2026-03-06

## Overview

Custom Keycloak OIDC multi-tenant auth module for Dittofeed (Automate/Scorise).
Lives in `packages/auth-keycloak/` — the only auth-related package we can modify.
Upstream packages (`api/`, `backend-lib/`, `dashboard/`, etc.) are **read-only**.

---

## Architecture

```
Browser → nginx (local-automate.scorise.pl)
       → Fastify (lite container, port 3000)
           ├── /api/public/oidc/login    → Keycloak redirect (PKCE)
           ├── /api/public/oidc/callback → Token exchange, onboarding, session
           ├── /api/public/oidc/signout  → Session destroy, Keycloak logout
           ├── /api/*                    → Upstream API (with requestContext auth)
           └── /dashboard/*             → Next.js SSR (with session bridge)
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/auth-keycloak/src/keycloakPlugin.ts` | OIDC discovery, client creation, secure session registration |
| `packages/auth-keycloak/src/routes/login.ts` | PKCE code verifier + challenge, redirects to Keycloak |
| `packages/auth-keycloak/src/routes/callback.ts` | Token exchange, profile mapping, onboarding, session creation |
| `packages/auth-keycloak/src/routes/signout.ts` | Session destroy, Keycloak logout redirect |
| `packages/auth-keycloak/src/oidcAuth.ts` | preHandler hook: bridges OIDC session → request.user + injects workspace ID header |
| `packages/auth-keycloak/src/onboarding.ts` | Per-user workspace creation (bootstrapPostgres) |
| `packages/auth-keycloak/src/config.ts` | Environment variable resolution |
| `packages/auth-keycloak/src/buildAppOpts.ts` | Registers keycloakPlugin + oidcAuth into upstream buildApp |
| `packages/auth-keycloak/scripts/startLite.ts` | Entry point — builds app, Next.js SSR, session-to-profile bridge |

## OIDC Login Flow

1. **`/api/public/oidc/login`** — generates PKCE code verifier + challenge, nonce, state. Stores in session as `oidc-pending`. Redirects to Keycloak authorization URL.

2. **Keycloak** — user authenticates (email/password, SSO, etc.)

3. **`/api/public/oidc/callback`** — retrieves `oidc-pending` from session (400 if missing). Exchanges authorization code for tokens. Maps Keycloak claims to `OpenIdProfile`:
   - `sub` → user ID
   - `email` → email address
   - `email_verified` → verified flag
   - `picture`, `name`, `nickname` → profile info

4. **Onboarding** — calls `onboardUserToOwnWorkspace()`:
   - If user already has a workspace role → returns existing workspace ID
   - If not → creates new workspace via `bootstrapPostgres()` (full setup: user properties, write keys, providers, subscription groups) + assigns user as Admin + starts compute properties workflow

5. **Session** — stores `OidcSession { profile, workspaceId }` in encrypted cookie. Clears `oidc-pending`.

6. **Redirect** → `/dashboard/`

## Session Structure

```typescript
interface OidcSession {
  profile: OpenIdProfile;  // sub, email, email_verified, picture, name, nickname
  workspaceId?: string;    // resolved during onboarding, used by oidcAuth hook
}
```

Stored in `@fastify/secure-session` encrypted cookie. Must stay under 4KB.

## oidcAuth preHandler Hook

Registered via `buildAppOpts.registerAuthentication`. Runs before upstream `requestContext` hook on all `/api/*` routes.

Does two things:
1. Sets `request.user = session.profile` — contract expected by upstream `getRequestContextFastify()`
2. Injects `df-workspace-id` header from `session.workspaceId` when not present in request — fixes upstream bug where multi-tenant `getWorkspaceId()` returns null for endpoints that omit workspaceId from query params (e.g., `/api/subscription-management-template`)

## Per-User Workspace Onboarding

File: `packages/auth-keycloak/src/onboarding.ts`

```
onboardUserToOwnWorkspace({ email, name })
  ├── Check if user already has any WorkspaceMemberRole
  │   └── Yes → return existing workspaceId (isNew: false)
  │   └── No ↓
  ├── bootstrapPostgres({ workspaceName: displayName, workspaceType: "Root" })
  │   Creates: Workspace + 11 UserProperties + WriteKey + EmailProviders
  │            + SmsProviders + SubscriptionGroups + MessageTemplates + Secrets
  │   (If name taken → retry with " (email)" suffix)
  ├── Create/find WorkspaceMember + assign Admin role
  └── bootstrapComputeProperties({ workspaceId }) — starts Temporal workflow
```

Workspace name = user's `name` from Keycloak profile, fallback to email prefix.

## Upstream Request Context Flow (read-only)

File: `packages/api/src/buildApp/requestContext.ts` + `packages/backend-lib/src/requestContext.ts`

1. `getRequestContextFastify(request)` → reads `request.user` (set by oidcAuth) or `Authorization` header
2. `getMultiTenantRequestContext()`:
   - Validates `email_verified` → 403 if false
   - Upserts `WorkspaceMember` + `WorkspaceMembeAccount`
   - `findAndCreateRoles(member)`:
     - Finds workspaces by explicit role OR email domain match
     - Auto-creates Admin roles for domain-matched workspaces
     - Returns first workspace (by createdAt)
   - If no workspace found → `NotOnboarded` error → 403
3. `getWorkspaceId(request)` → extracts workspaceId from query/body/headers (`df-workspace-id`)
4. Compares resolved workspace with request workspace → 403 if mismatch

## Environment Variables

| Variable | Value (local) | Purpose |
|----------|---------------|---------|
| `AUTH_MODE` | `multi-tenant` | Set in docker-compose.keycloak.yaml |
| `AUTH_PROVIDER` | `keycloak` | Set in docker-compose.keycloak.yaml |
| `OIDC_ISSUER_URL` | `https://local-user.scorise.pl/realms/scorise` | Keycloak realm |
| `OIDC_CALLBACK_URL` | `https://local-automate.scorise.pl/api/public/oidc/callback` | Must match nginx domain |
| `OPEN_ID_CLIENT_ID` | `automate` | Keycloak client ID |
| `OPEN_ID_CLIENT_SECRET` | (in .env) | Keycloak client secret |
| `SIGNOUT_REDIRECT_URL` | `https://local-automate.scorise.pl` | **Must match app domain** (was localhost → caused 400) |
| `SESSION_COOKIE_SECURE` | `true` | HTTPS required for cookies |
| `SECRET_KEY` | (in .env) | Encrypted session cookie key (trimmed to 32 bytes) |
| `WORKSPACE_NAME` | `Default` | Bootstrap workspace name (still used by initial bootstrap) |
| `DASHBOARD_API_BASE` | `https://local-automate.scorise.pl` | Dashboard API base URL |

## Docker Setup

```bash
# Start
docker compose -f docker-compose.lite.yaml -f docker-compose.keycloak.yaml up -d

# Build (after code changes)
docker compose -f docker-compose.lite.yaml -f docker-compose.keycloak.yaml build lite

# Shortcut
./start
```

Image built from `packages/auth-keycloak/Dockerfile`. Build order: emailo → api → worker → admin-cli → dashboard → lite → auth-keycloak.

Container `lite` runs: `node ./packages/auth-keycloak/dist/scripts/startLite.js --workspace-name=Default`

Needs external network `keycloak_keycloak-net` for OIDC discovery.

## Database Tables (key ones)

| Table | Key Columns |
|-------|------------|
| `Workspace` | id, name, domain, type (Root/Parent/Child), status (Active), parentWorkspaceId |
| `WorkspaceMember` | id, email (unique), emailVerified, name, nickname, lastWorkspaceId |
| `WorkspaceMemberRole` | workspaceId + workspaceMemberId (composite PK), role (Admin/WorkspaceManager/Author/Viewer) |
| `WorkspaceMembeAccount` | provider + providerAccountId (unique), workspaceMemberId |

Workspace unique constraint: `(parentWorkspaceId, name)` — names must be unique among root workspaces.

## Known Issues & Fixes Applied (2026-03-06)

### 1. SIGNOUT_REDIRECT_URL caused 400 on callback
**Root cause**: `SIGNOUT_REDIRECT_URL=http://localhost:3962`. After signout, user landed on localhost, login flow started from localhost domain, session cookie set for localhost. Keycloak callback returned to `local-automate.scorise.pl` — different domain, cookie not sent → "Missing OIDC pending session" → 400.
**Fix**: Set `SIGNOUT_REDIRECT_URL=https://local-automate.scorise.pl` in `.env`.

### 2. 403 on endpoints without workspaceId in query params
**Root cause**: Upstream `requestContext.ts` compares `getWorkspaceId(request)` with user's workspace. In multi-tenant mode, `getWorkspaceId` returns null for endpoints like `/api/subscription-management-template?includeDefault=true` that don't pass workspaceId. `null !== workspace.id` → 403.
**Fix**: `oidcAuth.ts` injects `df-workspace-id` header from session when not present in request.

### 3. All users shared one workspace
**Root cause**: `onboardUser()` from upstream backend-lib assigned all users to `WORKSPACE_NAME` ("Default").
**Fix**: Replaced with `onboardUserToOwnWorkspace()` in auth-keycloak that creates per-user workspaces via `bootstrapPostgres()`. Users can invite others via Settings UI.

## SSR Session Bridge

In `startLite.ts`, the catch-all route handler bridges OIDC session to Next.js SSR:
- Reads `oidc` session → sets `req.raw.profile` for dashboard's `requestContext.ts`
- If no session on non-public path → redirects to `/api/public/oidc/login`
- Public paths: `/api/`, `/_next/`, `/dashboard/_next/`, `/favicon`
