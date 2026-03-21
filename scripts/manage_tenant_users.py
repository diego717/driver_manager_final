"""
Administra usuarios web por tenant vía API del Worker.

Ejemplos:
  python scripts/manage_tenant_users.py list \
    --admin-user diego_sasen --admin-pass "TuPass#2026"

  python scripts/manage_tenant_users.py list \
    --admin-user diego_sasen --admin-pass "TuPass#2026" \
    --tenant-id tenant-a

  python scripts/manage_tenant_users.py create \
    --admin-user diego_sasen --admin-pass "TuPass#2026" \
    --username tecnico_a1 --password "TechPass#2026" \
    --role admin --tenant-id tenant-a
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import requests


def _mask(value: str) -> str:
    value = str(value or "")
    if len(value) <= 6:
        return "*" * len(value)
    return f"{value[:3]}...{value[-3:]}"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crear/listar usuarios web por tenant (requiere super_admin web).",
    )
    parser.add_argument(
        "action",
        choices=["list", "create"],
        help="Acción a ejecutar.",
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("DRIVER_MANAGER_HISTORY_API_URL", "").strip(),
        help="Base URL del Worker. Requerida si no defines DRIVER_MANAGER_HISTORY_API_URL.",
    )
    parser.add_argument("--admin-user", required=True, help="Usuario web super_admin")
    parser.add_argument("--admin-pass", required=True, help="Password del super_admin web")

    parser.add_argument("--tenant-id", help="Tenant objetivo (para list/create)")

    parser.add_argument("--username", help="Usuario a crear")
    parser.add_argument("--password", help="Password del usuario a crear")
    parser.add_argument(
        "--role",
        default="viewer",
        choices=["viewer", "admin", "super_admin"],
        help="Rol del usuario a crear (default: viewer)",
    )

    args = parser.parse_args()
    if not str(args.base_url).strip():
        parser.error("Debes definir --base-url o la variable DRIVER_MANAGER_HISTORY_API_URL.")
    if args.action == "create":
        missing = [name for name in ["username", "password", "tenant_id"] if not getattr(args, name)]
        if missing:
            parser.error(f"En acción 'create' faltan argumentos: {', '.join(missing)}")
    return args


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
    response = requests.post(url, json=payload, headers=headers or {}, timeout=20)
    _raise_for_status(response)
    return response.json() if response.content else {}


def _get_json(url: str, headers: dict[str, str], params: dict[str, Any] | None = None) -> dict[str, Any]:
    response = requests.get(url, headers=headers, params=params or {}, timeout=20)
    _raise_for_status(response)
    return response.json() if response.content else {}


def _raise_for_status(response: requests.Response) -> None:
    if response.ok:
        return
    detail = ""
    try:
        payload = response.json()
        if isinstance(payload, dict):
            detail = (
                payload.get("error", {}).get("message")
                if isinstance(payload.get("error"), dict)
                else payload.get("message", "")
            ) or ""
    except Exception:
        detail = (response.text or "").strip()
    message = f"HTTP {response.status_code}: {detail or 'request failed'}"
    raise RuntimeError(message)


def _login(base_url: str, username: str, password: str) -> str:
    payload = {"username": username, "password": password}
    data = _post_json(f"{base_url}/web/auth/login", payload)
    token = str(data.get("access_token") or "")
    if not token:
        raise RuntimeError("Login no devolvió access_token.")
    return token


def _action_list(base_url: str, token: str, tenant_id: str | None) -> int:
    headers = {"Authorization": f"Bearer {token}"}
    params = {"tenant_id": tenant_id} if tenant_id else {}
    data = _get_json(f"{base_url}/web/auth/users", headers=headers, params=params)
    users = data.get("users") if isinstance(data, dict) else None
    if not isinstance(users, list):
        print("[ERROR] Respuesta inesperada del endpoint /web/auth/users")
        return 1

    print(f"[INFO] Usuarios encontrados: {len(users)}")
    for item in users:
        if not isinstance(item, dict):
            continue
        print(
            f"- username={item.get('username')} "
            f"role={item.get('role')} "
            f"tenant_id={item.get('tenant_id')} "
            f"active={item.get('is_active')}"
        )
    return 0


def _action_create(
    base_url: str,
    token: str,
    username: str,
    password: str,
    role: str,
    tenant_id: str,
) -> int:
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "username": username,
        "password": password,
        "role": role,
        "tenant_id": tenant_id,
    }
    data = _post_json(f"{base_url}/web/auth/users", payload=payload, headers=headers)
    user = data.get("user") if isinstance(data, dict) else None
    if not isinstance(user, dict):
        print("[ERROR] Respuesta inesperada al crear usuario.")
        return 1
    print("[OK] Usuario creado:")
    print(
        json.dumps(
            {
                "id": user.get("id"),
                "username": user.get("username"),
                "role": user.get("role"),
                "tenant_id": user.get("tenant_id"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def main() -> int:
    args = _parse_args()
    base_url = str(args.base_url).rstrip("/")

    print(f"[INFO] Worker: {base_url}")
    print(f"[INFO] Login admin: {args.admin_user} / {_mask(args.admin_pass)}")

    try:
        token = _login(base_url, args.admin_user, args.admin_pass)
    except Exception as exc:
        print(f"[ERROR] Login super_admin falló: {exc}")
        return 1

    try:
        if args.action == "list":
            return _action_list(base_url, token, args.tenant_id)
        return _action_create(
            base_url,
            token,
            args.username,
            args.password,
            args.role,
            args.tenant_id,
        )
    except Exception as exc:
        print(f"[ERROR] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
