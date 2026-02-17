"""
Sync desktop API auth credentials into config/config.enc.

Usage:
  python sync_desktop_api_auth.py

The script reads:
  - EXPO_PUBLIC_API_TOKEN
  - EXPO_PUBLIC_API_SECRET
  - EXPO_PUBLIC_API_BASE_URL (optional)
from mobile-app/.env by default, asks for the desktop master password,
decrypts config/config.enc, updates api_token/api_secret, and re-encrypts it.
"""

from __future__ import annotations

import argparse
import getpass
import os
from pathlib import Path

from core.security_manager import SecurityManager


def parse_env_file(env_path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def decrypt_with_salt_dir(
    config_path: Path, password: str, salt_dir: Path
) -> tuple[dict | None, SecurityManager]:
    security = SecurityManager()
    security._get_config_dir = lambda: salt_dir  # type: ignore[method-assign]
    data = security.decrypt_config_file(password, config_path)
    return data, security


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync API token/secret from mobile .env into desktop encrypted config."
    )
    parser.add_argument(
        "--env-file",
        default="mobile-app/.env",
        help="Path to .env file containing EXPO_PUBLIC_API_TOKEN/SECRET.",
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

    env_path = Path(args.env_file)
    config_path = Path(args.config_file)

    if not env_path.exists():
        print(f"ERROR: env file not found: {env_path}")
        return 1

    if not config_path.exists():
        print(f"ERROR: encrypted config not found: {config_path}")
        return 1

    env_data = parse_env_file(env_path)
    api_token = env_data.get("EXPO_PUBLIC_API_TOKEN", "")
    api_secret = env_data.get("EXPO_PUBLIC_API_SECRET", "")
    api_base_url = env_data.get("EXPO_PUBLIC_API_BASE_URL", "")

    if not api_token or not api_secret:
        print(
            "ERROR: EXPO_PUBLIC_API_TOKEN/EXPO_PUBLIC_API_SECRET missing in "
            f"{env_path}"
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

    print("OK: desktop encrypted config updated.")
    print("Updated keys: api_token, api_secret, api_url")
    print(f"Salt directory used: {used_salt_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
