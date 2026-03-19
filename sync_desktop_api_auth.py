"""
Sync desktop legacy API auth credentials into config/config.enc.

Usage:
  $env:DRIVER_MANAGER_API_TOKEN="token-legacy"
  $env:DRIVER_MANAGER_API_SECRET="secret-legacy"
  python sync_desktop_api_auth.py

The script reads explicit desktop env vars/flags, asks for the desktop master
password, decrypts config/config.enc, updates api_token/api_secret, and
re-encrypts it. Use it only for private or legacy HMAC integrations.
"""

from __future__ import annotations

import argparse
import getpass
import os
from pathlib import Path

from core.security_manager import SecurityManager

def decrypt_with_salt_dir(
    config_path: Path, password: str, salt_dir: Path
) -> tuple[dict | None, SecurityManager]:
    security = SecurityManager()
    security._get_config_dir = lambda: salt_dir  # type: ignore[method-assign]
    data = security.decrypt_config_file(password, config_path)
    return data, security


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync explicit legacy API token/secret into desktop encrypted config."
    )
    parser.add_argument(
        "--api-token",
        default=os.getenv("DRIVER_MANAGER_API_TOKEN", ""),
        help="Legacy API token to persist in config.enc (or use DRIVER_MANAGER_API_TOKEN).",
    )
    parser.add_argument(
        "--api-secret",
        default=os.getenv("DRIVER_MANAGER_API_SECRET", ""),
        help="Legacy API secret to persist in config.enc (or use DRIVER_MANAGER_API_SECRET).",
    )
    parser.add_argument(
        "--api-base-url",
        default=os.getenv("DRIVER_MANAGER_HISTORY_API_URL", os.getenv("WORKER_URL", "")),
        help="Optional Worker base URL to persist as api_url/history_api_url.",
    )
    parser.add_argument(
        "--config-file",
        default="config/config.enc",
        help="Path to encrypted desktop config file.",
    )
    parser.add_argument(
        "--password",
        default="",
        help="Desktop master password (not recommended; use only if needed).",
    )
    parser.add_argument(
        "--password-env",
        default="DRIVER_MANAGER_MASTER_PASSWORD",
        help="Environment variable name containing desktop master password.",
    )
    parser.add_argument(
        "--salt-dir",
        default="",
        help=(
            "Optional directory containing .security_salt. "
            "If empty, script auto-tries config/ and ~/.driver_manager."
        ),
    )
    args = parser.parse_args()

    config_path = Path(args.config_file)

    if not config_path.exists():
        print(f"ERROR: encrypted config not found: {config_path}")
        return 1

    api_token = (args.api_token or "").strip()
    api_secret = (args.api_secret or "").strip()
    api_base_url = (args.api_base_url or "").strip()

    if not api_token or not api_secret:
        print(
            "ERROR: missing legacy API credentials. "
            "Use --api-token/--api-secret or DRIVER_MANAGER_API_TOKEN/DRIVER_MANAGER_API_SECRET."
        )
        return 1

    password = args.password
    if not password and args.password_env:
        password = os.getenv(args.password_env, "")

    if not password:
        try:
            # Hidden input in normal terminals.
            password = getpass.getpass(
                "Desktop master password (hidden input): "
            )
        except (EOFError, KeyboardInterrupt):
            password = ""
        except Exception:
            password = ""

    if not password:
        # Fallback for terminals that break getpass.
        password = input("Desktop master password (visible input): ").strip()

    if not password:
        print("ERROR: empty password.")
        return 1

    candidate_salt_dirs: list[Path] = []
    if args.salt_dir:
        candidate_salt_dirs.append(Path(args.salt_dir))
    else:
        candidate_salt_dirs.extend(
            [
                config_path.parent,
                Path.home() / ".driver_manager",
            ]
        )

    # Keep insertion order and uniqueness.
    unique_dirs: list[Path] = []
    for directory in candidate_salt_dirs:
        resolved = directory.resolve()
        if resolved not in unique_dirs:
            unique_dirs.append(resolved)

    current_config = None
    security: SecurityManager | None = None
    used_salt_dir: Path | None = None

    for salt_dir in unique_dirs:
        if not salt_dir.exists():
            continue
        config_data, sec = decrypt_with_salt_dir(config_path, password, salt_dir)
        if config_data:
            current_config = config_data
            security = sec
            used_salt_dir = salt_dir
            break

    if not current_config:
        print("ERROR: could not decrypt config.enc.")
        print("Tried salt directories:")
        for salt_dir in unique_dirs:
            print(f"  - {salt_dir}")
        print(
            "Possible causes: wrong desktop master password, different salt location, or corrupted config.enc."
        )
        return 1

    assert security is not None
    assert used_salt_dir is not None

    current_config["api_token"] = api_token
    current_config["api_secret"] = api_secret

    # Keep both keys aligned when possible.
    if api_base_url:
        current_config.setdefault("history_api_url", api_base_url)
        current_config["api_url"] = api_base_url

    saved = security.encrypt_config_file(current_config, password, config_path)
    if not saved:
        print("ERROR: failed to re-encrypt config.enc.")
        return 1

    updated_keys = ["api_token", "api_secret"]
    if api_base_url:
        updated_keys.append("api_url/history_api_url")

    print("OK: desktop encrypted config updated.")
    print(f"Updated keys: {', '.join(updated_keys)}")
    print(f"Salt directory used: {used_salt_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
