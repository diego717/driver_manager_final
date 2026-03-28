# Security Best Practices Report

## Executive Summary
Scope reviewed: Cloudflare Worker backend and static dashboard assets in [worker.js](/g:/dev/driver_manager/worker.js), public tracking flows in [worker/lib/public-tracking.js](/g:/dev/driver_manager/worker/lib/public-tracking.js) and [worker/routes/public-tracking.js](/g:/dev/driver_manager/worker/routes/public-tracking.js), dashboard web client files, and mobile/web session storage in [mobile-app/src/storage/secure.ts](/g:/dev/driver_manager/mobile-app/src/storage/secure.ts).

I did not find an obvious unauthenticated backend route exposing D1 data, and the project already has several solid controls in place: `HttpOnly` + `Secure` + `SameSite=Strict` session cookies, rate limiting for login/password verification, and hardened headers for dashboard/public tracking HTML responses.

This review found:
- `0` critical findings
- `0` active high findings
- `0` active medium findings
- `0` active low findings

Primary references used:
- `javascript-general-web-frontend-security.md`
- `javascript-typescript-react-web-frontend-security.md`

## Resolved High Severity

### SBP-001: Public tracking capability URLs were exposed and persisted in logs/API responses
- Rule ID: `TOKEN-URL-001`
- Severity: High
- Location:
  - [worker/lib/public-tracking.js](/g:/dev/driver_manager/worker/lib/public-tracking.js#L679)
  - [worker/lib/public-tracking.js](/g:/dev/driver_manager/worker/lib/public-tracking.js#L683)
  - [worker/routes/public-tracking.js](/g:/dev/driver_manager/worker/routes/public-tracking.js#L165)
  - [worker/routes/public-tracking.js](/g:/dev/driver_manager/worker/routes/public-tracking.js#L166)
  - [worker/routes/public-tracking.js](/g:/dev/driver_manager/worker/routes/public-tracking.js#L184)
  - [worker/routes/public-tracking.js](/g:/dev/driver_manager/worker/routes/public-tracking.js#L185)
- Evidence:
  - The issuance flow returns both a short URL and a long URL containing the signed tracking token in the path:
  ```js
  return {
    token,
    shortCode,
    url: buildTrackingUrl(origin, shortCode),
    longUrl: buildTrackingUrl(origin, token),
  };
  ```
  - The web route also stores both URLs in audit details and returns them in the admin API response:
  ```js
  tracking_url: issuedLink.url,
  long_tracking_url: issuedLink.longUrl,
  ```
- Impact:
  - The long URL is effectively a bearer credential. If it lands in audit logs, browser history, screenshots, copy/paste trails, reverse-proxy logs, or support tooling, anyone with that URL can read the public tracking status until expiry.
- Fix:
  - Stop returning and logging `long_tracking_url` by default.
  - Prefer the short code URL only, and keep the signed token internal to the backend/KV mapping.
  - If a long URL is still needed for break-glass support, gate it behind an explicit admin action, avoid persisting it in logs, and shorten its TTL further.
- Mitigation:
  - Continue using `Referrer-Policy: no-referrer` on the public page.
  - Consider one-time or rotating public tracking links for higher sensitivity deployments.
- False positive notes:
  - The short-code flow is safer and already implemented. The risk came from also exposing the long bearer-style URL.
- Current repo status:
  - Fixed on 2026-03-28. `long_tracking_url` is no longer returned in the admin API contract and is no longer written to audit log details. The shareable URL now stays on the short-code path only.

## Resolved Medium Severity

### SBP-002: Mobile web fallback stores access tokens in browser sessionStorage
- Rule ID: `JS-STORAGE-001`
- Severity: Medium
- Location:
  - [mobile-app/src/storage/secure.ts](/g:/dev/driver_manager/mobile-app/src/storage/secure.ts#L38)
  - [mobile-app/src/storage/secure.ts](/g:/dev/driver_manager/mobile-app/src/storage/secure.ts#L47)
  - [mobile-app/src/storage/secure.ts](/g:/dev/driver_manager/mobile-app/src/storage/secure.ts#L85)
  - [mobile-app/src/storage/secure.ts](/g:/dev/driver_manager/mobile-app/src/storage/secure.ts#L174)
  - [mobile-app/src/storage/secure.ts](/g:/dev/driver_manager/mobile-app/src/storage/secure.ts#L242)
- Evidence:
  - On web, the storage helper falls back to browser storage:
  ```ts
  if (webStorage) {
    webStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
  ```
  - Session keys include the access token:
  ```ts
  const WEB_ACCESS_TOKEN_KEY = "dm_web_access_token";
  ```
  - Web session keys are routed to `sessionStorage`:
  ```ts
  if (isStoredWebSessionKey(key)) {
    return getWebSessionStorage();
  }
  ```
- Impact:
  - Any XSS in the web build can exfiltrate the stored access token. `sessionStorage` is better than `localStorage`, but it is still JS-readable and should not be treated as secure secret storage.
- Fix:
  - Prefer cookie-based session auth for web builds, or keep access tokens in memory only and re-bootstrap the session from a hardened backend endpoint.
  - If token persistence is unavoidable on web, minimize token lifetime and scope, and pair it with stronger CSP/Trusted Types hardening.
- Mitigation:
  - Keep the dashboard CSP strict and avoid introducing any new DOM XSS sinks.
  - Clear stored web sessions aggressively on tab close/logout/expiry.
- False positive notes:
  - Native mobile builds use `expo-secure-store`; this finding applies to the web fallback path.
- Current repo status:
  - Fixed on 2026-03-28. The browser build no longer persists `dm_web_access_token`, `/web/*` requests in browser runtime rely on `credentials: include`, and shared session state revalidates against `/web/auth/me` instead of trusting JS-readable token storage.

## Resolved Low Severity

### SBP-003: Most API JSON responses do not receive the same security header baseline as HTML entrypoints
- Rule ID: `HEADERS-BASELINE-001`
- Severity: Low
- Location:
  - [worker/lib/http.js](/g:/dev/driver_manager/worker/lib/http.js#L267)
  - [worker.js](/g:/dev/driver_manager/worker.js#L174)
  - [worker.js](/g:/dev/driver_manager/worker.js#L340)
- Evidence:
  - Dashboard/public tracking assets get an explicit header baseline:
  ```js
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(self), microphone=(), camera=(self)",
  "X-Content-Type-Options": "nosniff",
  ```
  - Generic JSON responses only set content type and optional cache control:
  ```js
  const headers = {
    ...corsHeaders(request, env, corsPolicy),
    "Content-Type": "application/json",
  };
  ```
- Impact:
  - This is mostly defense-in-depth. JSON endpoints do not need CSP, but `X-Content-Type-Options: nosniff` and a consistent `Referrer-Policy` are still good baseline hardening and reduce accidental weakening as the API surface evolves.
- Fix:
  - Add a minimal shared response header helper for API responses, at least `X-Content-Type-Options: nosniff` and optionally `Referrer-Policy: no-referrer`.
- Mitigation:
  - Keep the stronger HTML response headers already present on dashboard/public tracking routes.
- False positive notes:
  - Some of these headers may also be injected at Cloudflare edge/runtime, which is not verifiable from repo code alone.
- Current repo status:
  - Fixed on 2026-03-28. Shared API helpers now add `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` to generic JSON/text API responses, while keeping the stronger HTML-specific header set on dashboard and public tracking assets.

## What Looked Good
- Web session cookies are built as `HttpOnly`, `Secure`, `SameSite=Strict` in [worker/auth/web-session.js](/g:/dev/driver_manager/worker/auth/web-session.js#L56).
- Login and password verification endpoints have rate limiting in [worker/auth/security.js](/g:/dev/driver_manager/worker/auth/security.js#L200) and [worker/auth/security.js](/g:/dev/driver_manager/worker/auth/security.js#L230).
- Dashboard assets are served with CSP, `X-Frame-Options`, `nosniff`, and `Permissions-Policy` in [worker.js](/g:/dev/driver_manager/worker.js#L174).
- Public tracking responses also ship with a restrictive CSP and `no-referrer` in [worker/lib/public-tracking.js](/g:/dev/driver_manager/worker/lib/public-tracking.js#L905).
- The dashboard client clears the password field after failed login attempts in [dashboard-auth.js](/g:/dev/driver_manager/dashboard-auth.js#L163).

## Recommended Next Step
1. Keep validating new dashboard/mobile changes against the current CSP and avoid re-introducing JS-readable credential storage.

## Report Date
2026-03-28
