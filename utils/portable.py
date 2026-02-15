"""
Portable configuration helper with encrypted storage.
"""

import base64
import json
import os
import platform
import uuid
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


PORTABLE_PASSPHRASE_ENV = "DRIVER_MANAGER_PORTABLE_PASSPHRASE"
KDF_ITERATIONS = 100000


class SecurePortableConfig:
    """
    Portable config manager.

    Security model:
    - Encrypts with Fernet.
    - Derives key using PBKDF2-HMAC-SHA256.
    - Uses per-file random salt.
    - Requires an external passphrase (argument or env var).
    """

    def __init__(self, allow_machine_transfer=True):
        self.allow_machine_transfer = allow_machine_transfer
        self.config_dir = Path(__file__).parent / "config"
        self.config_dir.mkdir(parents=True, exist_ok=True)

        self.encrypted_config_file = self.config_dir / "portable_config.encrypted"
        self.machine_id_file = self.config_dir / ".machine_id"

    def _get_machine_identifier(self):
        """Get a stable machine identifier."""
        try:
            if platform.system() == "Windows":
                import subprocess

                result = subprocess.run(
                    ["wmic", "csproduct", "get", "UUID"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                uuid_str = result.stdout.split("\n")[1].strip()
                if uuid_str and uuid_str != "UUID":
                    return uuid_str
        except Exception:
            pass

        try:
            mac = ":".join(
                ["{:02x}".format((uuid.getnode() >> element) & 0xFF) for element in range(0, 2 * 6, 2)][
                    ::-1
                ]
            )
            hostname = platform.node()
            return f"{mac}-{hostname}"
        except Exception:
            return "default-machine-id"

    def _get_or_create_machine_id(self):
        """Read or create local machine-id file."""
        if self.machine_id_file.exists():
            with open(self.machine_id_file, "r", encoding="utf-8") as file:
                return file.read().strip()

        machine_id = self._get_machine_identifier()
        with open(self.machine_id_file, "w", encoding="utf-8") as file:
            file.write(machine_id)

        try:
            if platform.system() == "Windows":
                import ctypes

                ctypes.windll.kernel32.SetFileAttributesW(str(self.machine_id_file), 2)
        except Exception:
            pass

        return machine_id

    def _resolve_passphrase(self, passphrase=None):
        """Resolve passphrase from argument or env var and validate."""
        resolved = passphrase or os.getenv(PORTABLE_PASSPHRASE_ENV)
        if not resolved:
            raise ValueError(
                "Portable encryption passphrase is required. "
                f"Provide it explicitly or set {PORTABLE_PASSPHRASE_ENV}."
            )
        if len(resolved) < 12:
            raise ValueError("Portable encryption passphrase must have at least 12 characters.")
        return resolved

    def _derive_encryption_key(self, passphrase, salt):
        """Derive a Fernet key using passphrase + optional machine binding + salt."""
        if self.allow_machine_transfer:
            base_id = passphrase
        else:
            machine_id = self._get_or_create_machine_id()
            base_id = f"{machine_id}_{passphrase}"

        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=KDF_ITERATIONS,
        )
        return base64.urlsafe_b64encode(kdf.derive(base_id.encode("utf-8")))

    def encrypt_config(self, config_dict, passphrase=None):
        """
        Encrypt and persist config.

        Args:
            config_dict: config dictionary.
            passphrase: encryption passphrase (required if env var not set).
        """
        try:
            resolved_passphrase = self._resolve_passphrase(passphrase)
            salt = os.urandom(16)
            key = self._derive_encryption_key(resolved_passphrase, salt)
            cipher = Fernet(key)

            json_data = json.dumps(config_dict, indent=2).encode("utf-8")
            encrypted = cipher.encrypt(json_data)

            config_package = {
                "version": "3.0",
                "salt": base64.urlsafe_b64encode(salt).decode("utf-8"),
                "encrypted_data": base64.urlsafe_b64encode(encrypted).decode("utf-8"),
                "created_at": self._get_timestamp(),
                "portable": self.allow_machine_transfer,
                "algorithm": "fernet",
                "kdf": "PBKDF2-HMAC-SHA256",
                "iterations": KDF_ITERATIONS,
            }

            with open(self.encrypted_config_file, "w", encoding="utf-8") as file:
                json.dump(config_package, file, indent=2)

            print(f"Config encrypted and saved in: {self.encrypted_config_file}")
            return True
        except Exception as error:
            print(f"Error encrypting config: {error}")
            return False

    def decrypt_config(self, passphrase=None):
        """
        Decrypt config file.

        Args:
            passphrase: decryption passphrase (required if env var not set).

        Returns:
            dict or None.
        """
        try:
            if not self.encrypted_config_file.exists():
                return None

            with open(self.encrypted_config_file, "r", encoding="utf-8") as file:
                config_package = json.load(file)

            if config_package.get("version") != "3.0":
                print("Incompatible encrypted config version. Recreate portable config with current app.")
                return None

            resolved_passphrase = self._resolve_passphrase(passphrase)
            salt_encoded = config_package.get("salt")
            if not salt_encoded:
                print("Encrypted config does not include salt.")
                return None

            salt = base64.urlsafe_b64decode(salt_encoded.encode("utf-8"))
            key = self._derive_encryption_key(resolved_passphrase, salt)
            cipher = Fernet(key)

            encrypted_bytes = base64.urlsafe_b64decode(config_package["encrypted_data"].encode("utf-8"))
            decrypted = cipher.decrypt(encrypted_bytes)
            return json.loads(decrypted.decode("utf-8"))
        except Exception as error:
            print(f"Error decrypting config: {error}")
            return None

    def config_exists(self):
        """Check if encrypted config exists."""
        return self.encrypted_config_file.exists()

    def delete_config(self):
        """Securely delete encrypted config file."""
        if self.encrypted_config_file.exists():
            file_size = self.encrypted_config_file.stat().st_size
            with open(self.encrypted_config_file, "wb") as file:
                file.write(os.urandom(file_size))

            self.encrypted_config_file.unlink()
            print("Encrypted config removed securely")

    def _get_timestamp(self):
        from datetime import datetime

        return datetime.now().isoformat()


PORTABLE_MODE = True
AUTO_CONFIGURE = True


def get_config(passphrase=None):
    """
    Load decrypted portable config.

    The passphrase must be passed explicitly or through
    DRIVER_MANAGER_PORTABLE_PASSPHRASE.
    """
    secure_config = SecurePortableConfig(allow_machine_transfer=PORTABLE_MODE)
    return secure_config.decrypt_config(passphrase)


def save_config(config_dict, passphrase=None):
    """
    Save encrypted portable config.

    The passphrase must be passed explicitly or through
    DRIVER_MANAGER_PORTABLE_PASSPHRASE.
    """
    secure_config = SecurePortableConfig(allow_machine_transfer=PORTABLE_MODE)
    return secure_config.encrypt_config(config_dict, passphrase)


def is_configured():
    """Check if encrypted portable config exists."""
    secure_config = SecurePortableConfig(allow_machine_transfer=PORTABLE_MODE)
    return secure_config.config_exists()


def get_cache_dir():
    """Get portable cache directory."""
    if PORTABLE_MODE:
        cache_dir = Path(__file__).parent / "portable_cache"
    else:
        cache_dir = Path.home() / ".driver_manager" / "cache"

    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def test_secure_config():
    """Simple local test helper for encrypted portable config."""
    print("=" * 60)
    print("PORTABLE SECURE CONFIG TEST")
    print("=" * 60)
    print()

    test_config = {
        "account_id": "EXAMPLE_ACCOUNT_ID",
        "access_key_id": "EXAMPLE_ACCESS_KEY_ID",
        "secret_access_key": "EXAMPLE_SECRET_ACCESS_KEY",
        "bucket_name": "example-bucket",
    }

    passphrase = "EXAMPLE_STRONG_PASSPHRASE"

    print("1) Encrypting config...")
    secure = SecurePortableConfig(allow_machine_transfer=True)

    if secure.encrypt_config(test_config, passphrase):
        print("Config encrypted successfully")
    else:
        print("Encryption failed")
        return False
    print()

    print("2) Decrypting config...")
    loaded_config = secure.decrypt_config(passphrase)

    if loaded_config:
        print("Config decrypted successfully")
        print(f"Account ID suffix: ****{loaded_config['account_id'][-4:]}")
        print(f"Bucket: {loaded_config['bucket_name']}")
    else:
        print("Decryption failed")
        return False
    print()

    print("3) Validating integrity...")
    if loaded_config == test_config:
        print("Data matches")
    else:
        print("ERROR: data mismatch")
        return False
    print()

    print("4) Testing wrong passphrase...")
    wrong_config = secure.decrypt_config("wrong_passphrase")

    if wrong_config is None:
        print("Wrong passphrase rejected")
    else:
        print("ERROR: wrong passphrase accepted")
        return False
    print()

    print("=" * 60)
    print("ALL TESTS PASSED")
    print("=" * 60)
    print()
    print("Security summary:")
    print("  - Encryption: Fernet")
    print("  - KDF: PBKDF2-HMAC-SHA256")
    print(f"  - Iterations: {KDF_ITERATIONS}")
    print("  - Salt: random per file")
    print()

    return True


if __name__ == "__main__":
    test_secure_config()
