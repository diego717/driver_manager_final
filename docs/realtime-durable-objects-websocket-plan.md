# Realtime Migration Plan (Durable Objects + WebSocket + FCM)

## Goal
Migrate the current realtime stack from long-lived SSE to a scalable model based on:
- Durable Objects for tenant-scoped fanout.
- WebSocket for active foreground clients.
- FCM as wake-up trigger for background/offline clients.
- Cursor-based sync endpoint for consistency and replay.

This document is implementation guidance for a future phase. It does not change current production behavior.

## Current limitations
- SSE connections are expensive at high concurrency.
- Reconnect storms can spike CPU and connection counts.
- Poll-based fallback increases DB load under sustained usage.
- No durable replay contract by event cursor yet.

## Target architecture
1. API Worker keeps auth, business logic, D1 writes, and R2 operations.
2. One Durable Object per tenant handles WebSocket connections.
3. D1 `event_outbox` stores durable realtime events with increasing `event_id`.
4. Clients keep `last_event_id` and recover with `/web/realtime/sync?after=`.
5. FCM payloads notify clients to resume and sync.

## Data model
### `event_outbox`
- `event_id INTEGER PRIMARY KEY AUTOINCREMENT`
- `tenant_id TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `entity_type TEXT`
- `entity_id INTEGER`
- `payload_json TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `expires_at TEXT NOT NULL`
- `producer TEXT NOT NULL`
- `idempotency_key TEXT` (optional)

Recommended indexes:
- `(tenant_id, event_id)`
- `(expires_at)`

## Durable Object responsibilities
- Maintain live sockets for one tenant namespace.
- Validate tenant and user context on connect.
- Enforce connection caps per tenant and per user.
- Broadcast events to connected sockets.
- Send heartbeats and close stale sockets.

## API contracts
### 1) WebSocket connect
- Route: `GET /web/realtime/ws` (upgrade)
- Auth: bearer or secure session cookie
- Response on auth failure: `401`
- Response on capacity limit: `503` with retry hint

### 2) Sync replay
- Route: `GET /web/realtime/sync?after={event_id}&limit={n}`
- Returns ordered events after cursor.
- Includes `has_more` and `next_after` for pagination.
- Returns `409 CURSOR_EXPIRED` if cursor is older than retention.

### 3) Internal publish
- Worker -> DO internal call (not public route).
- Event envelope must include `tenant_id`, `event_id`, `type`, `timestamp`, `data`.

## Client behavior
1. On login:
- Read local `last_event_id`.
- Run immediate sync.
- Open WebSocket only when app is foreground and active.

2. On message:
- If `event_id == last + 1`: apply and advance cursor.
- If gap detected: call sync.
- Ignore duplicates (`event_id <= last`).

3. On background:
- Close socket.
- Keep FCM subscription.

4. On push:
- Wake app.
- Run sync from `last_event_id`.

## FCM usage
- Use as trigger only, not as source of truth.
- Keep payload minimal: `tenant_id`, `event_id`, `type`.
- Do not include sensitive business data in push payload.

## Reliability and retention
- Keep outbox retention for 24-72h (per volume target).
- Scheduled cleanup removes expired outbox rows.
- Sync endpoint supports pagination to avoid large payloads.

## Security controls
- No auth token in query string.
- Validate tenant ownership on connect and sync.
- Validate allowed origins for cookie-based auth.
- Apply rate limits to connect and sync routes.

## Rollout plan
1. Add outbox table and write-path publication.
2. Add sync endpoint and cursor handling in clients.
3. Add Durable Object WebSocket in parallel to existing SSE.
4. Enable WebSocket with feature flag per tenant.
5. Observe metrics and gradually reduce SSE traffic.
6. Remove SSE fallback after stable adoption.

## Metrics to track
- Active sockets per tenant.
- Reconnect rate and reconnect failures.
- Sync latency and sync backlog size.
- Event delivery lag (`now - event.created_at`).
- FCM trigger-to-sync completion time.
- Cost and CPU trends by traffic tier.

## Backward compatibility notes
- Existing endpoints remain functional during migration.
- Mobile and web can migrate independently.
- `last_event_id` initialization should default safely to zero and tolerate empty sync.

