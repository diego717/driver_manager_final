"""
Normaliza credenciales API legacy dentro de config/config.enc.

Uso recomendado (PowerShell, solo integraciones legacy privadas):
  $env:DRIVER_MANAGER_MASTER_PASSWORD="***"
  python scripts/normalize_config_enc.py `
    --api-url "https://tu-worker.example.workers.dev" `
    --api-token "test-token" `
    --api-secret "test-secret"
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path


def _mask(value: str) -> str:
    if not value:
        return "<empty>"
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Actualiza api_url/history_api_url/api_token/api_secret dentro de config.enc",
    )
    parser.add_argument(
        "--config",
        default="config/config.enc",
        help="Ruta a config.enc (default: config/config.enc)",
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("DRIVER_MANAGER_HISTORY_API_URL", "").strip(),
        help="URL base del worker (también guarda api_url/history_api_url)",
    )
    parser.add_argument(
        "--api-token",
        default=os.getenv("DRIVER_MANAGER_API_TOKEN", "").strip(),
        help="API token legacy para X-API-Token",
    )
    parser.add_argument(
        "--api-secret",
        default=os.getenv("DRIVER_MANAGER_API_SECRET", "").strip(),
        help="API secret legacy para firma HMAC",
    )
    parser.add_argument(
        "--master-password",
        default=os.getenv("DRIVER_MANAGER_MASTER_PASSWORD", "").strip(),
        help="Clave maestra para descifrar/cifrar config.enc",
    )
    parser.add_argument(
        "--worker-defaults",
        action="store_true",
        help="Usa defaults locales/no productivos del worker (test-token/test-secret)",
    )
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    config_path = (root / args.config).resolve()
    if not config_path.exists():
        print(f"[ERROR] No existe config.enc en: {config_path}")
        return 1

    api_url = (args.api_url or "").strip().rstrip("/")
    api_token = (args.api_token or "").strip()
    api_secret = (args.api_secret or "").strip()
    master_password = (args.master_password or "").strip()

    if args.worker_defaults:
        if not api_token:
            api_token = "test-token"
        if not api_secret:
            api_secret = "test-secret"

    if not master_password:
        master_password = getpass.getpass("Master password (DRIVER_MANAGER_MASTER_PASSWORD): ").strip()

    if not master_password:
        print("[ERROR] Falta master password.")
        return 1
    if not api_url:
        print("[ERROR] Falta --api-url.")
        return 1
    if not api_token:
        print("[ERROR] Falta --api-token.")
        return 1
    if not api_secret:
        print("[ERROR] Falta --api-secret.")
        return 1

    try:
        from core.security_manager import SecurityManager
    except Exception as exc:
        print(f"[ERROR] No se pudo importar SecurityManager: {exc}")
        return 1

    sm = SecurityManager()
    config_data = sm.decrypt_config_file(master_password, config_path)
    if not isinstance(config_data, dict):
        print("[ERROR] No se pudo descifrar config.enc (clave incorrecta o archivo corrupto).")
        return 1

    before = {
        "api_url": str(config_data.get("api_url", "")),
        "history_api_url": str(config_data.get("history_api_url", "")),
        "api_token": str(config_data.get("api_token", "")),
        "api_secret": str(config_data.get("api_secret", "")),
    }

    config_data["api_url"] = api_url
    config_data["history_api_url"] = api_url
    config_data["api_token"] = api_token
    config_data["api_secret"] = api_secret

    ok = sm.encrypt_config_file(config_data, master_password, config_path)
    if not ok:
        print("[ERROR] No se pudo volver a cifrar config.enc.")
        return 1

    print("[OK] config.enc actualizado.")
    print(f"  file: {config_path}")
    print(f"  api_url:        {_mask(before['api_url'])} -> {_mask(api_url)}")
    print(f"  history_api_url:{_mask(before['history_api_url'])} -> {_mask(api_url)}")
    print(f"  api_token:      {_mask(before['api_token'])} -> {_mask(api_token)}")
    print(f"  api_secret:     {_mask(before['api_secret'])} -> {_mask(api_secret)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
