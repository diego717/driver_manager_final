# Day 1 Scope Lock

Date: 2026-03-08  
Sprint window: 2026-03-09 to 2026-03-20 (2 weeks)

## Objective
Lock a focused UX refactor scope for Week 1 and Week 2 without expanding backend/API contracts.

## In Scope
- Web dashboard UX in:
  - `dashboard.html`
  - `dashboard.css`
  - `dashboard.js`
- Desktop PyQt UX in:
  - `ui/main_window.py`
  - `ui/ui_components.py`
  - `ui/theme_manager.py`
- Critical flows (both platforms where applicable):
  - Login / logout
  - Create manual record
  - Create incident
  - Link asset to installation
  - Upload incident photo
  - Upload driver
- Day 1 outputs:
  - Current flow map
  - Baseline metrics and stability snapshot
  - Agreed acceptance criteria

## Out of Scope
- Backend contract changes (`worker.js`, D1 schema, auth protocol)
- New product features
- Mobile app refactor (`mobile-app/`)
- Large visual redesign unrelated to flow friction/accessibility
- Infra/deploy changes

## Constraints
- Preserve current API endpoints and payload shapes.
- Preserve role model semantics (`viewer`, `admin`, `super_admin`).
- Keep behavior regressions near zero on tested web flows.

## Risks
- Existing test failures in Python suite can mask UX-related regressions.
- Prompt/dialog heavy flows are currently entangled with business actions.
- Desktop signal wiring by button text is fragile when labels change.

## Mitigations
- Freeze Day 1 baseline test outputs in docs before edits.
- Refactor UX in thin vertical slices per flow, not broad rewrites.
- Replace text-based signal matching with explicit widget references in later tasks.

## Acceptance Criteria For This 2-Week Refactor
- No critical web flow depends on `prompt()` or `confirm()`.
- Keyboard focus is visibly clear on all primary interactive controls.
- Empty/error states provide at least one direct next action.
- Primary user path per section is clearer and requires fewer modal interruptions.
- `npm run test:web` remains green during refactor.

