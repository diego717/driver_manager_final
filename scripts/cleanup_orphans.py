"""
Run orphan cleanup in Worker (DB + R2) with web admin authentication.

Examples:
  python scripts/cleanup_orphans.py --admin-user diego_sasen --admin-pass "TuPass#2026" --dry-run

  python scripts/cleanup_orphans.py --admin-user diego_sasen --admin-pass "TuPass#2026" --tenant-id acme --dry-run

  python scripts/cleanup_orphans.py --admin-user diego_sasen --admin-pass "TuPass#2026" --tenant-id acme --yes
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

import requests


DEFAULT_BASE_URL = "https://driver-manager-db.diegosasen.workers.dev"


def _mask(value: str) -> str:
    value = str(value or "")
    if len(value) <= 6:
        return "*" * len(value)
    return f"{value[:3]}...{value[-3:]}"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cleanup orphan incidents/photos in Worker DB and R2.",
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("WORKER_URL", DEFAULT_BASE_URL),
        help=f"Worker base URL (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument("--admin-user", required=True, help="Web admin/super_admin username")
    parser.add_argument("--admin-pass", required=True, help="Web admin/super_admin password")
    parser.add_argument(
        "--tenant-id",
        help="Target tenant id. Optional: if omitted uses current admin tenant.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only scan and report, do not delete anything.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Required to run real cleanup (without --dry-run).",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="Request timeout in seconds (default: 30)",
    )
    args = parser.parse_args()
    if not args.dry_run and not args.yes:
        parser.error("Real cleanup requires --yes (or use --dry-run).")
    return args


def _raise_for_status(response: requests.Response) -> None:
    if response.ok:
        return
    detail = ""
    try:
        payload = response.json()
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                detail = str(error.get("message") or "")
            else:
                detail = str(payload.get("message") or "")
    except Exception:
        detail = (response.text or "").strip()
    raise RuntimeError(f"HTTP {response.status_code}: {detail or 'request failed'}")


def _post_json(
    url: str,
    payload: dict[str, Any],
    timeout: int,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    response = requests.post(url, json=payload, timeout=timeout, headers=headers or {})
    _raise_for_status(response)
    if not response.content:
        return {}
    return response.json()


def _login(base_url: str, username: str, password: str, timeout: int) -> str:
    data = _post_json(
        f"{base_url}/web/auth/login",
        payload={"username": username, "password": password},
        timeout=timeout,
    )
    token = str(data.get("access_token") or "")
    if not token:
        raise RuntimeError("Login response did not include access_token.")
    return token


def _cleanup(
    base_url: str,
    token: str,
    tenant_id: str | None,
    dry_run: bool,
    timeout: int,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"dry_run": dry_run}
    if tenant_id:
        payload["tenant_id"] = tenant_id
    headers = {"Authorization": f"Bearer {token}"}
    return _post_json(
        f"{base_url}/web/maintenance/cleanup-orphans",
        payload=payload,
        timeout=timeout,
        headers=headers,
    )


def main() -> int:
    args = _parse_args()
    base_url = str(args.base_url).rstrip("/")
    mode = "DRY-RUN" if args.dry_run else "EXECUTE"

    print(f"[INFO] Worker: {base_url}")
    print(f"[INFO] Mode: {mode}")
    print(f"[INFO] Admin user: {args.admin_user} / {_mask(args.admin_pass)}")
    if args.tenant_id:
        print(f"[INFO] Target tenant: {args.tenant_id}")

    try:
        token = _login(base_url, args.admin_user, args.admin_pass, args.timeout)
        result = _cleanup(base_url, token, args.tenant_id, args.dry_run, args.timeout)
    except Exception as exc:
        print(f"[ERROR] {exc}")
        return 1

    print("[OK] Cleanup completed.")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
