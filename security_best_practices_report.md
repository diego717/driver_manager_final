# Security Best Practices Report

## Executive Summary
Scope reviewed: `worker.js`, `dashboard.js`, `dashboard-api.js` (Cloudflare Worker backend + vanilla JS frontend).

I found **4 security findings**:
- **1 High**: security controls fail open when KV bindings are missing.
- **2 Medium**: auth/user-state enumeration via detailed errors, and session token exposure to browser JS.
- **1 Low**: malformed cookie can trigger auth-path 500s (DoS-style instability).

References used:
- `javascript-general-web-frontend-security.md`
- `javascript-express-web-server-security.md` (applied as closest backend JS guidance; stack is Worker, not Express)

## High Severity

### SBP-001: Critical auth protections fail open when KV is absent
- Rule ID: `AUTH-HARDEN-001`
- Severity: High
- Location:
  - `worker.js:783-794`
  - `worker.js:914-917`, `worker.js:925-928`, `worker.js:944-947`, `worker.js:955-958`
  - `worker.js:2587-2594`, `worker.js:3590-3599`, `worker.js:4359-4363`
- Evidence:
  - `getRateLimitKv` returns `null` if `RATE_LIMIT_KV` is not present.
  - Login/password rate-limit functions short-circuit with `if (!kv) return;`.
  - Session version checks/revocation depend on `getWebSessionStore(env)`; without store, logout/revocation checks do not enforce server-side invalidation.
- Impact:
  - Missing KV binding disables brute-force protections and weakens token revocation guarantees (stolen tokens remain usable until expiry).
- Fix:
  - Fail closed in production when required KV bindings are missing (e.g., refuse startup or return 503 for auth routes).
  - Add in-memory fallback counters/versioning only as explicit dev-mode behavior, gated by env flag.
  - Emit clear startup log/health signal when security stores are unavailable.
- Mitigation:
  - Keep `WEB_ACCESS_TTL_SECONDS` as short as operationally possible.
  - Monitor failed login rates and auth anomalies from edge logs.
- False positive notes:
  - If your deployment **always** provisions `RATE_LIMIT_KV`/`WEB_SESSION_KV`, exposure is lower; still brittle against misconfiguration/drift.

## Medium Severity

### SBP-002: Detailed auth errors allow account-state/user enumeration
- Rule ID: `AUTH-ENUM-001`
- Severity: Medium
- Location:
  - `worker.js:3616-3619`, `worker.js:3629`, `worker.js:3661`
  - `worker.js:8637-8644`
- Evidence:
  - Backend throws distinct messages (`Credenciales web invalidas.`, `Usuario web inactivo.`).
  - Global HttpError serialization returns `message: error.message` to clients.
- Impact:
  - Attackers can distinguish account states and improve username discovery and credential-stuffing efficiency.
- Fix:
  - Return a generic auth failure message for login/verify-password paths (same status/message for invalid user, wrong password, inactive account).
  - Keep detailed reason only in server/audit logs.
- Mitigation:
  - Increase monitoring/alerting on repeated auth failures by IP + username.
- False positive notes:
  - If this API is strictly private and not internet-exposed, practical risk drops but still violates least-information principles.

### SBP-003: Session token is exposed to browser JS despite HttpOnly cookie session
- Rule ID: `TOKEN-EXPOSURE-001`
- Severity: Medium
- Location:
  - `worker.js:3958-3961`, `worker.js:3971`
  - `worker.js:4071-4074`, `worker.js:4078`
  - `dashboard.js:5404-5406`
  - `dashboard-api.js:84-86`
- Evidence:
  - Login/bootstrap responses include `access_token` in JSON body and also set HttpOnly cookie.
  - Frontend stores token in JS runtime and sends `Authorization: Bearer ...`.
- Impact:
  - Any DOM XSS immediately gains a reusable bearer token (exfiltrable), reducing protection benefit of HttpOnly cookies.
- Fix:
  - For web dashboard flows, prefer cookie-only auth and remove `access_token` from web auth responses.
  - Keep bearer mode only for non-browser clients via dedicated endpoint/flow.
- Mitigation:
  - Maintain strict CSP and avoid unsafe DOM sinks to lower XSS likelihood.
- False positive notes:
  - If bearer support is mandatory for your web client design, risk is accepted but should be explicitly documented.

## Low Severity

### SBP-004: Malformed cookie can trigger server error path in auth parsing
- Rule ID: `ROBUSTNESS-COOKIE-001`
- Severity: Low
- Location:
  - `worker.js:2558-2567`
  - `worker.js:2571-2576`
- Evidence:
  - `decodeURIComponent(...)` is used on raw cookie values without try/catch.
  - A malformed `%` sequence can throw and bubble to global error handling (500 path).
- Impact:
  - Enables low-effort instability/DoS on auth-protected requests.
- Fix:
  - Wrap cookie decoding in try/catch and ignore invalid cookie pairs instead of throwing.
- Mitigation:
  - Add request-level metrics for malformed cookie incidents to detect abuse.
- False positive notes:
  - If an upstream normalizes/strips malformed cookies before Worker execution, exploitability drops.

## Recommended Fix Order
1. SBP-001 (High)
2. SBP-002 (Medium)
3. SBP-003 (Medium)
4. SBP-004 (Low)

## Remediation Status (2026-03-12)
- SBP-001: Fixed in backend with fail-closed defaults for web auth security stores.
  - Added `requireRateLimitStoreForWebAuth(...)` and `requireWebSessionStoreForWebAuth(...)`.
  - Production now returns `503` on missing `RATE_LIMIT_KV` / `WEB_SESSION_KV` for protected web-auth flows.
  - Added explicit opt-in fallback flag: `ALLOW_INSECURE_WEB_AUTH_FALLBACK=true` (intended for local/test only).
- SBP-002: Fixed with generic auth failures on login/password verification responses.
  - Added `sanitizeWebAuthFailure(...)`.
  - Invalid credentials vs inactive-account specifics remain in server-side audit data, but API responses are normalized.
- SBP-003: Fixed with strict cookie-only web auth flow.
  - `/web/auth/login` and `/web/auth/bootstrap` no longer return `access_token` or `token_type` in JSON payloads.
  - Web frontend no longer persists web bearer token after login (`webAccessToken=''`) and uses session cookie flow.
- SBP-004: Fixed by making cookie parsing resilient to malformed values.
  - `parseCookies(...)` now wraps `decodeURIComponent` in `try/catch` and ignores invalid cookie pairs.

## Verification
- `npm run test:web`: pass (`102/102` tests).
- `npm run security:verify-deploy`: pass (`env=default`).

## Operational Hardening Added
- Added pre-deploy security gate in `package.json`:
  - `security:verify-deploy` runs before `wrangler deploy`.
- Added `scripts/verify-security-deploy-config.mjs`:
  - verifies required KV bindings in `wrangler.toml`: `RATE_LIMIT_KV`, `WEB_SESSION_KV`
  - verifies remote secret presence: `WEB_SESSION_SECRET`
  - blocks deploy if insecure fallback secret exists remotely: `ALLOW_INSECURE_WEB_AUTH_FALLBACK`
- Updated `wrangler.toml` with explicit `WEB_SESSION_KV` binding declaration.
- Updated `README.md` with production-safe deploy guidance and insecure fallback removal command.
