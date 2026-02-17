"""
Secure local storage for master password on trusted devices.

Windows implementation uses DPAPI (CryptProtectData/CryptUnprotectData).
"""

from __future__ import annotations

import base64
import ctypes
import json
import os
from pathlib import Path
from ctypes import wintypes

from core.logger import get_logger

logger = get_logger()


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


class MasterPasswordVault:
    """Store/retrieve master password bound to the local Windows user profile."""

    _DPAPI_UI_FORBIDDEN = 0x01
    _PAYLOAD_VERSION = 1

    def __init__(self, store_file: Path | None = None):
        if store_file is not None:
            self.store_file = Path(store_file)
        else:
            local_app_data = os.getenv("LOCALAPPDATA")
            if local_app_data:
                base_dir = Path(local_app_data) / "DriverManager"
            else:
                base_dir = Path.home() / ".driver_manager"
            self.store_file = base_dir / ".master_password_vault.json"

        self._entropy = b"driver_manager_master_password_v1"

    def is_supported(self) -> bool:
        """Return True when secure local storage is available."""
        return self._supports_dpapi()

    def save_password(self, password: str) -> bool:
        """Persist password securely for current Windows user."""
        if not password:
            return False
        if not self._supports_dpapi():
            logger.info("Secure vault not supported on this platform.")
            return False

        try:
            encrypted = self._dpapi_encrypt(password.encode("utf-8"))
            payload = {
                "version": self._PAYLOAD_VERSION,
                "scheme": "dpapi",
                "blob": base64.b64encode(encrypted).decode("ascii"),
            }
            self.store_file.parent.mkdir(parents=True, exist_ok=True)
            self.store_file.write_text(json.dumps(payload), encoding="utf-8")

            try:
                ctypes.windll.kernel32.SetFileAttributesW(str(self.store_file), 2)
            except Exception:
                pass

            return True
        except Exception as error:
            logger.warning(f"Failed to save master password in secure vault: {error}")
            return False

    def load_password(self) -> str | None:
        """Load password from secure local storage."""
        if not self._supports_dpapi():
            return None
        if not self.store_file.exists():
            return None

        try:
            payload = json.loads(self.store_file.read_text(encoding="utf-8"))
            if payload.get("scheme") != "dpapi":
                return None

            blob = payload.get("blob", "")
            encrypted = base64.b64decode(blob.encode("ascii"))
            decrypted = self._dpapi_decrypt(encrypted)
            return decrypted.decode("utf-8")
        except Exception as error:
            logger.warning(f"Failed to load master password from secure vault: {error}")
            return None

    def clear_password(self) -> None:
        """Delete locally stored password from secure vault."""
        try:
            if self.store_file.exists():
                self.store_file.unlink()
        except Exception as error:
            logger.warning(f"Failed to clear secure master password vault: {error}")

    def _supports_dpapi(self) -> bool:
        return os.name == "nt" and hasattr(ctypes, "windll")

    def _make_blob(self, data: bytes):
        if not data:
            return _DataBlob(), None
        buffer = ctypes.create_string_buffer(data, len(data))
        blob = _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
        return blob, buffer

    def _dpapi_encrypt(self, raw_data: bytes) -> bytes:
        in_blob, in_buffer = self._make_blob(raw_data)
        entropy_blob, entropy_buffer = self._make_blob(self._entropy)
        out_blob = _DataBlob()

        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        crypt32.CryptProtectData.argtypes = [
            ctypes.POINTER(_DataBlob),
            wintypes.LPCWSTR,
            ctypes.POINTER(_DataBlob),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(_DataBlob),
        ]
        crypt32.CryptProtectData.restype = wintypes.BOOL
        kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
        kernel32.LocalFree.restype = wintypes.HLOCAL

        ok = crypt32.CryptProtectData(
            ctypes.byref(in_blob),
            "Driver Manager Master Password",
            ctypes.byref(entropy_blob),
            None,
            None,
            self._DPAPI_UI_FORBIDDEN,
            ctypes.byref(out_blob),
        )
        _ = in_buffer, entropy_buffer  # keep buffers alive through API call
        if not ok:
            raise OSError(ctypes.get_last_error(), "CryptProtectData failed")

        try:
            return ctypes.string_at(out_blob.pbData, out_blob.cbData)
        finally:
            kernel32.LocalFree(out_blob.pbData)

    def _dpapi_decrypt(self, encrypted_data: bytes) -> bytes:
        in_blob, in_buffer = self._make_blob(encrypted_data)
        entropy_blob, entropy_buffer = self._make_blob(self._entropy)
        out_blob = _DataBlob()

        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        crypt32.CryptUnprotectData.argtypes = [
            ctypes.POINTER(_DataBlob),
            ctypes.c_void_p,
            ctypes.POINTER(_DataBlob),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(_DataBlob),
        ]
        crypt32.CryptUnprotectData.restype = wintypes.BOOL
        kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
        kernel32.LocalFree.restype = wintypes.HLOCAL

        ok = crypt32.CryptUnprotectData(
            ctypes.byref(in_blob),
            None,
            ctypes.byref(entropy_blob),
            None,
            None,
            self._DPAPI_UI_FORBIDDEN,
            ctypes.byref(out_blob),
        )
        _ = in_buffer, entropy_buffer  # keep buffers alive through API call
        if not ok:
            raise OSError(ctypes.get_last_error(), "CryptUnprotectData failed")

        try:
            return ctypes.string_at(out_blob.pbData, out_blob.cbData)
        finally:
            kernel32.LocalFree(out_blob.pbData)
