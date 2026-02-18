"""
Sync desktop users (R2 users.json) into Worker D1 web_users.

Usage (interactive):
  python sync_r2_users_to_web_d1.py

Typical flow:
  1) Decrypt config/config.enc with desktop master password.
  2) Download users payload from R2 key `system/users.json`.
  3) Login to Worker web auth with admin user/password.
  4) Import user hashes through /web/auth/import-users.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from core.security_manager import CloudDataEncryption, SecurityManager
from managers.cloud_manager import CloudflareR2Manager


def parse_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def detect_hash_type(password_hash: str) -> str:
    value = (password_hash or "").strip()
    if value.startswith("pbkdf2_sha256$"):
        return "pbkdf2_sha256"
    if value.startswith("$2a$") or value.startswith("$2b$") or value.startswith("$2y$"):
        return "bcrypt"
    return "legacy_pbkdf2_hex"


def normalize_users_payload(payload: object) -> dict[str, dict]:
    if not isinstance(payload, dict):
        return {}

    users = payload.get("users")
    if isinstance(users, list):
        output: dict[str, dict] = {}
        for item in users:
            if not isinstance(item, dict):
                continue
            username = str(item.get("username", "")).strip()
            if username:
                output[username] = item
        return output

    if isinstance(users, dict):
        output: dict[str, dict] = {}
        for username, item in users.items():
            if isinstance(item, dict):
                output[str(username).strip()] = item
        return output

    return {}


def request_json(method: str, url: str, payload: dict | None = None, headers: dict | None = None) -> dict:
    body = None
    request_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/132.0.0.0 Safari/537.36"
        ),
    }
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url=url, data=body, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        if "error code: 1010" in raw.lower():
            raise RuntimeError(
                f"HTTP {error.code} {url}: Cloudflare bloqueó esta solicitud (1010). "
                "Intenta usar --access-token para evitar el login desde script."
            ) from error
        raise RuntimeError(f"HTTP {error.code} {url}: {raw}") from error


def decrypt_with_salt_dir(config_path: Path, password: str, salt_dir: Path) -> tuple[dict | None, SecurityManager]:
    security = SecurityManager()
    security._get_config_dir = lambda: salt_dir  # type: ignore[method-assign]
    config_data = security.decrypt_config_file(password, config_path)
    return config_data, security


def resolve_master_password(args: argparse.Namespace) -> str:
    password = args.password or ""
    if not password and args.password_env:
        password = os.getenv(args.password_env, "")
    if password:
        return password

    try:
        password = getpass.getpass("Desktop master password (hidden): ").strip()
    except Exception:
        password = ""

    if password:
        return password

    return input("Desktop master password (visible): ").strip()


def load_users_from_r2(args: argparse.Namespace) -> dict[str, dict]:
    config_path = Path(args.config_file)
    if not config_path.exists():
        raise RuntimeError(f"Encrypted config not found: {config_path}")

    password = resolve_master_password(args)
    if not password:
        raise RuntimeError("Empty desktop master password.")

    candidate_salt_dirs: list[Path] = []
    if args.salt_dir:
        candidate_salt_dirs.append(Path(args.salt_dir))
    else:
        candidate_salt_dirs.extend([config_path.parent, Path.home() / ".driver_manager"])

    config_data = None
    security: SecurityManager | None = None
    used_salt_dir: Path | None = None
    for directory in candidate_salt_dirs:
        resolved = directory.resolve()
        if not resolved.exists():
            continue
        maybe_config, maybe_security = decrypt_with_salt_dir(config_path, password, resolved)
        if maybe_config:
            config_data = maybe_config
            security = maybe_security
            used_salt_dir = resolved
            break

    if not config_data or security is None or used_salt_dir is None:
        raise RuntimeError("Could not decrypt config/config.enc with provided password.")

    account_id = config_data.get("account_id")
    access_key_id = config_data.get("access_key_id")
    secret_access_key = config_data.get("secret_access_key")
    bucket_name = config_data.get("bucket_name")
    if not all([account_id, access_key_id, secret_access_key, bucket_name]):
        raise RuntimeError("R2 credentials missing in decrypted config.")

    cloud = CloudflareR2Manager(
        account_id=account_id,
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        bucket_name=bucket_name,
    )

    users_key = args.r2_users_key
    raw_content = cloud.download_file_content(users_key)
    if not raw_content:
        raise RuntimeError(f"R2 key not found or empty: {users_key}")

    payload = json.loads(raw_content)
    users = normalize_users_payload(payload)
    if users:
        return users

    cloud_crypto = CloudDataEncryption(security)
    decrypted_payload = cloud_crypto.decrypt_cloud_data(dict(payload))
    users = normalize_users_payload(decrypted_payload)
    if users:
        return users

    raise RuntimeError("Could not parse users payload from R2 (plain or encrypted).")


def load_users_from_file(users_file: Path) -> dict[str, dict]:
    if not users_file.exists():
        raise RuntimeError(f"users file not found: {users_file}")
    payload = json.loads(users_file.read_text(encoding="utf-8-sig"))
    users = normalize_users_payload(payload)
    if not users:
        raise RuntimeError(f"No users found in: {users_file}")
    return users


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync R2 users.json into Worker D1 web_users.")
    parser.add_argument("--api-base-url", default="", help="Worker base URL. If empty, uses mobile-app/.env")
    parser.add_argument("--env-file", default="mobile-app/.env", help="Path to mobile .env")
    parser.add_argument("--admin-username", default="", help="Web admin username for /web/auth/login")
    parser.add_argument(
        "--admin-username-env",
        default="DRIVER_MANAGER_WEB_ADMIN_USERNAME",
        help="Environment variable name for web admin username",
    )
    parser.add_argument("--admin-password", default="", help="Web admin password for /web/auth/login")
    parser.add_argument(
        "--admin-password-env",
        default="DRIVER_MANAGER_WEB_ADMIN_PASSWORD",
        help="Environment variable name for web admin password",
    )
    parser.add_argument("--access-token", default="", help="Existing web Bearer token (skip /web/auth/login)")
    parser.add_argument(
        "--access-token-env",
        default="DRIVER_MANAGER_WEB_ACCESS_TOKEN",
        help="Environment variable name for web Bearer token",
    )
    parser.add_argument(
        "--users-file",
        default="",
        help="Optional local users.json path. If set, skips R2 download.",
    )
    parser.add_argument("--r2-users-key", default="system/users.json", help="R2 key for users payload")
    parser.add_argument("--config-file", default="config/config.enc", help="Encrypted desktop config path")
    parser.add_argument("--password", default="", help="Desktop master password (not recommended)")
    parser.add_argument(
        "--password-env",
        default="DRIVER_MANAGER_MASTER_PASSWORD",
        help="Environment variable for desktop master password",
    )
    parser.add_argument("--salt-dir", default="", help="Optional directory containing .security_salt")
    args = parser.parse_args()

    api_base_url = args.api_base_url.strip()
    if not api_base_url:
        env_path = Path(args.env_file)
        if not env_path.exists():
            print(f"ERROR: env file not found: {env_path}")
            return 1
        env_data = parse_env_file(env_path)
        api_base_url = (env_data.get("EXPO_PUBLIC_API_BASE_URL") or "").strip()
    api_base_url = api_base_url.rstrip("/")
    if not api_base_url:
        print("ERROR: API base URL is empty.")
        return 1

    access_token = args.access_token.strip()
    if not access_token and args.access_token_env:
        access_token = os.getenv(args.access_token_env, "").strip()

    admin_username = args.admin_username.strip()
    admin_password = args.admin_password.strip()
    if not access_token:
        if not admin_username and args.admin_username_env:
            admin_username = os.getenv(args.admin_username_env, "").strip()
        if not admin_username:
            admin_username = input("Web admin username: ").strip()

        if not admin_password and args.admin_password_env:
            admin_password = os.getenv(args.admin_password_env, "").strip()
        if not admin_password:
            try:
                admin_password = getpass.getpass("Web admin password (hidden): ").strip()
            except Exception:
                admin_password = ""
        if not admin_password:
            admin_password = input("Web admin password (visible): ").strip()
        if not admin_username or not admin_password:
            print("ERROR: admin username/password required when access token is not provided.")
            return 1

    try:
        if args.users_file:
            users_map = load_users_from_file(Path(args.users_file))
        else:
            users_map = load_users_from_r2(args)
    except Exception as error:
        print(f"ERROR loading users: {error}")
        return 1

    import_items = []
    skipped = 0
    for username, user in users_map.items():
        password_hash = str(user.get("password_hash", "")).strip()
        if not username or not password_hash:
            skipped += 1
            continue
        import_items.append(
            {
                "username": username,
                "password_hash": password_hash,
                "password_hash_type": detect_hash_type(password_hash),
                "role": str(user.get("role", "viewer")).strip() or "viewer",
                "is_active": bool(user.get("active", True)),
            }
        )

    if not import_items:
        print("ERROR: no importable users found (missing username/password_hash).")
        return 1

    try:
        if not access_token:
            login_response = request_json(
                "POST",
                f"{api_base_url}/web/auth/login",
                {
                    "username": admin_username,
                    "password": admin_password,
                },
            )
            access_token = login_response.get("access_token")
            if not access_token:
                raise RuntimeError("Login did not return access_token.")

        import_response = request_json(
            "POST",
            f"{api_base_url}/web/auth/import-users",
            {
                "users": import_items,
            },
            headers={"Authorization": f"Bearer {access_token}"},
        )
    except Exception as error:
        print(f"ERROR syncing users: {error}")
        return 1

    print("OK: user sync finished.")
    print(f"Source users: {len(users_map)}")
    print(f"Imported payload users: {len(import_items)}")
    print(f"Skipped invalid users: {skipped}")
    print(f"Created: {import_response.get('created', 0)}")
    print(f"Updated: {import_response.get('updated', 0)}")
    print(f"Imported: {import_response.get('imported', 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
