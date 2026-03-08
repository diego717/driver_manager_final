# Day 1 Baseline Metrics

Date: 2026-03-08  
Method: automated test baseline + static UX complexity baseline from code.

## 1) Stability Baseline

Commands run from repo root:

```powershell
pytest -q
npm run test:web
```

### Result Summary

| Suite | Status | Summary | Duration |
|---|---|---|---|
| `pytest -q` | FAIL | `10 failed, 262 passed, 2 skipped` | `25.66s` |
| `npm run test:web` | PASS | `95 passed, 0 failed` | `3.50s` (worker test phase) |

### Python Failures Captured (Pre-existing)

Grouped failures:
- `qrcode/release.py` date format portability (`%-d`) failing in:
  - `qrcode/tests/test_release.py::test_change`
  - `vendor/qrcode/tests/test_release.py::test_change`
- `InstallationHistory._make_request` web-auth mode mismatch in:
  - `tests/test_history_manager.py::test_make_request_success_returns_json`
  - `tests/test_history_manager.py::test_make_request_post_json_sends_utf8_bytes_payload`
- `UserManagerV2` auth/permissions lockout behavior in:
  - `tests/test_user_manager.py::test_authenticate`
  - `tests/test_user_manager.py::test_authenticate_locks_account_after_repeated_failures`
  - `tests/test_user_manager.py::test_change_password`
  - `tests/test_user_manager.py::test_create_superadmin_permissions`
  - `tests/test_user_manager.py::test_create_user_permissions`
  - `tests/test_user_manager.py::test_unlock_user_account_allows_login_again`

## 2) UX Interaction Baseline

Note: This is a code-based baseline, not stopwatch timing from live UI sessions.

### Modal/Dialog Density

| Metric | Count | Source |
|---|---:|---|
| `prompt()` usages in web | 18 | `dashboard.js` |
| `confirm()` usages in web | 3 | `dashboard.js` |
| `QInputDialog.get*` usages in desktop main window | 14 | `ui/main_window.py` |
| `QMessageBox` warning/critical/info calls in desktop main window | 64 | `ui/main_window.py` |

### Critical Flow Complexity (Static)

| Flow | Platform | Estimated Mandatory User Inputs/Actions | Dialog Interruptions | Estimated Time Range |
|---|---|---:|---:|---|
| Login | Web | 3-4 | 1 modal | 10-20s |
| Login | Desktop | 3-5 | 1 dialog + role updates | 15-35s |
| Create manual record | Web | 7-10 | 5 prompts | 45-90s |
| Create manual record | Desktop | 7-10 | 5 dialogs | 45-90s |
| Create incident | Web | 6-9 | 3 prompts + 1 confirm | 35-75s |
| Create incident | Desktop | 6-9 | 4 dialogs | 35-75s |
| Link asset | Web | 5-8 | 3 prompts | 30-60s |
| Link asset | Desktop | 5-8 | 3 dialogs | 30-60s |
| Upload incident photo | Web | 3-4 | file picker | 15-35s |
| Upload incident photo | Desktop | 3-4 | file picker | 15-35s |
| Upload driver | Web | 5-8 | inline + file picker | 25-55s |
| Upload driver | Desktop | 5-8 | inline + file picker | 25-55s |

## 3) Accessibility Baseline

### Strengths
- Web login modal has focus trap handling and restores focus on close.
- Web provides reduced-motion media-query handling.

### Gaps
- Multiple web control styles suppress browser outlines (`outline: none`) without a clear `:focus-visible` replacement system.
- Critical transactional flows rely on prompt/confirm, which limits accessible, context-rich validation.

## 4) Information Architecture Baseline

### Desktop
- Main tabs are broad and action-dense.
- Incidents can be reached both through history context and dedicated incidents tab, which increases path duplication.
- Signal wiring includes button-text matching logic, increasing maintenance risk.

### Web
- Installations section action bar is dynamically expanded with additional critical actions, which can dilute primary action hierarchy.

## 5) Manual Timing Worksheet (To Run In App)

Use this exact table for 3-run stopwatch measurement with a real operator session:

| Flow | Run 1 | Run 2 | Run 3 | Avg | Errors/Backtracks |
|---|---|---|---|---|---|
| Login | TBD | TBD | TBD | TBD | TBD |
| Create manual record | TBD | TBD | TBD | TBD | TBD |
| Create incident | TBD | TBD | TBD | TBD | TBD |
| Link asset | TBD | TBD | TBD | TBD | TBD |
| Upload incident photo | TBD | TBD | TBD | TBD | TBD |
| Upload driver | TBD | TBD | TBD | TBD | TBD |

## 6) Day 1 Exit Criteria Check

- Scope lock doc: complete
- Flow map doc: complete
- Baseline metrics doc: complete
- Automated baseline run: complete
- Ready for Day 2 implementation work: yes

