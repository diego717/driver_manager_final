# Security Best Practices Report

## Executive Summary
Scope reviewed: Cloudflare Worker backend in `worker.js`, plus the desktop client usage pattern in `managers/history_manager.py` and the deployment notes in `README.md`.

I did **not** find an unauthenticated `GET` path that directly exposes `web_users`, password hashes, audit logs, or the full database. Sensitive backend routes are generally gated before hitting D1.

This review found **2 serious findings** and **1 conditional configuration risk**. As of the current repository state, the two serious findings are **remediated in code** and the conditional risk is guarded by deploy-time checks but still depends on runtime configuration.

References used:
- `javascript-express-web-server-security.md` as the closest backend JavaScript guidance.

## Critical Severity

### SBP-001: Global HMAC credential plus client-supplied tenant header enables cross-tenant compromise
- Rule ID: `AUTHZ-TENANT-001`
- Severity: Critical
- Location:
  - `worker.js:4492-4588`
  - `worker.js:737-750`
  - `worker.js:8066-8135`
  - `managers/history_manager.py:468-479`
  - `README.md:118-129`
  - `README.md:226-233`
- Evidence:
  - Legacy non-web routes authenticate only with a shared `API_TOKEN` / `API_SECRET` pair and HMAC request signing; there is no user identity or tenant binding in `verifyAuth(...)`.
  - After auth, the backend resolves tenant context from `X-Tenant-Id` when the request is not a `/web/*` session request.
  - The desktop client sends those global headers for API calls.
  - The README documents storing `api_secret` client-side for legacy compatibility.
- Impact:
  - If a single legacy client secret is extracted from a desktop install, config file, logs, or memory, the attacker can sign requests for any non-web endpoint and pivot across tenants by changing `X-Tenant-Id`. That is a full cross-tenant confidentiality and integrity break.
- Fix:
  - Retire legacy HMAC auth for internet-facing clients and move external clients to `/web/*` short-lived sessions only.
  - If legacy support must remain, bind credentials to a specific tenant and derive tenant exclusively from the credential, not from a caller-controlled header.
  - Prefer per-user or per-device credentials with revocation rather than one shared secret for the whole backend surface.
- Mitigation:
  - Rotate `API_TOKEN` / `API_SECRET` immediately if they were ever distributed broadly.
  - Restrict legacy routes at the edge to trusted internal networks or specific device identities.
- False positive notes:
  - If legacy HMAC auth is used only by a tightly controlled internal service and never by distributed clients, practical exposure is lower. The current README and client code suggest broader client-side use.
- Current repo status:
  - Fixed. Legacy HMAC routes now derive tenant from Worker configuration (`DRIVER_MANAGER_API_TENANT_ID` / `API_TENANT_ID`) and reject mismatched `X-Tenant-Id` values.

## High Severity

### SBP-002: Account changes do not revoke active web sessions
- Rule ID: `AUTH-SESSION-002`
- Severity: High
- Location:
  - `worker.js:3598-3649`
  - `worker.js:2645-2662`
  - `worker.js:3527-3558`
  - `worker.js:4231-4297`
  - `worker.js:4300-4338`
- Evidence:
  - `verifyWebAccessToken(...)` trusts role and tenant data embedded in the signed token and only checks the stored session version if it exists.
  - `updateWebUserRoleAndStatus(...)` updates DB state but does not rotate or invalidate the user session version.
  - `forceResetWebUserPassword(...)` changes the password hash but also does not invalidate existing sessions.
  - The patch/password-reset handlers call those functions and return success without revoking tokens.
- Impact:
  - A user who is disabled, downgraded from admin, or forcibly reset can continue using an already-issued token with the old privileges until the token expires. Current token lifetime is 8 hours.
- Fix:
  - Invalidate or rotate the session version whenever role, active state, tenant assignment, or password changes.
  - Optionally re-load the current user record during token verification for sensitive routes and reject inactive users even when the token is otherwise valid.
- Mitigation:
  - Shorten web token TTL until revocation is enforced on account changes.
  - Monitor audit logs for activity from users immediately after disable/reset events.
- False positive notes:
  - If administrators always also force logout manually, risk is reduced, but the code does not enforce that.
- Current repo status:
  - Fixed. Role/status updates, password resets, and imported updates for existing users now invalidate active web session versions.

## Medium Severity

### SBP-003: Insecure fallback can disable persistent revocation and login throttling
- Rule ID: `AUTH-CONFIG-003`
- Severity: Medium
- Location:
  - `worker.js:799-829`
  - `README.md:188-191`
  - `scripts/verify-security-deploy-config.mjs:4-6`
- Evidence:
  - `ALLOW_INSECURE_WEB_AUTH_FALLBACK=true` makes missing security stores return `null` instead of failing closed.
  - That weakens rate limiting and server-side session invalidation guarantees.
  - There is a deployment check to block this secret remotely, which is good, but runtime state was not independently verified in this review.
- Impact:
  - If enabled in a real environment, brute-force protection and reliable session revocation degrade silently.
- Fix:
  - Keep this flag limited to local development only.
  - Treat any non-local use as a deployment failure.
- Mitigation:
  - Continue enforcing the deploy-time check and audit remote Worker secrets regularly.
- False positive notes:
  - This is a conditional risk. I did not verify the live Cloudflare environment, only the repository code and deploy guard.

## Remediation Status
- SBP-001: fixed in `worker.js`, `README.md`, and deploy validation flow.
- SBP-002: fixed in `worker.js` with regression coverage in `tests_js/worker.contract.test.mjs`.
- SBP-003: partially mitigated. The repository blocks insecure deploys more aggressively, but the final state still depends on remote Worker secrets/config.

## What Looked Good
- Web routes generally require a valid session before querying D1.
- `web_users` listings serialize user metadata and do not return password hashes.
- SQL access is consistently parameterized via `env.DB.prepare(...).bind(...)`; I did not see a clear SQL injection path in the reviewed backend.
- Web session cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`.
- SSE explicitly rejects query-string tokens.

## Recommended Remaining Action
1. Verify the remote Cloudflare Worker does not expose `ALLOW_INSECURE_WEB_AUTH_FALLBACK`.
2. If legacy HMAC remains enabled, rotate `API_TOKEN` / `API_SECRET` and set `DRIVER_MANAGER_API_TENANT_ID` remotely before next deploy.

## Report Date
2026-03-13
