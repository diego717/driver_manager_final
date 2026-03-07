"""
Gestor de drivers via endpoints web autenticados (Bearer).
"""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import quote

import requests

from core.exceptions import AuthenticationError, CloudStorageError, ConfigurationError, ValidationError
from core.logger import get_logger

logger = get_logger()


class WebDriverManager:
    """Cliente de /web/drivers para desktop."""

    def __init__(
        self,
        api_url_provider: Callable[[], str],
        token_provider: Callable[[], str],
        timeout_seconds: int = 30,
    ):
        self._api_url_provider = api_url_provider
        self._token_provider = token_provider
        self.timeout_seconds = max(5, int(timeout_seconds or 30))

    def _get_api_base_url(self) -> str:
        value = str(self._api_url_provider() or "").strip()
        if not value:
            raise ConfigurationError("No hay URL API para operaciones web de drivers.")
        return value.rstrip("/")

    def _get_bearer_token(self) -> str:
        token = str(self._token_provider() or "").strip()
        if not token:
            raise AuthenticationError("No hay sesión web activa. Inicia sesión nuevamente.")
        return token

    def _build_headers(self) -> dict:
        token = self._get_bearer_token()
        return {"Authorization": f"Bearer {token}"}

    def _extract_http_error_message(self, response: requests.Response) -> str:
        try:
            payload = response.json()
            if isinstance(payload, dict):
                err = payload.get("error")
                if isinstance(err, dict) and err.get("message"):
                    return str(err.get("message"))
                if payload.get("message"):
                    return str(payload.get("message"))
        except Exception:
            pass
        raw = (response.text or "").strip()
        return raw or f"HTTP {response.status_code}"

    def _raise_for_response(self, response: requests.Response, operation: str):
        if response.ok:
            return
        detail = self._extract_http_error_message(response)
        if response.status_code in (401, 403):
            raise AuthenticationError(f"{operation}: sesión inválida o sin permisos. {detail}")
        if response.status_code == 404:
            raise CloudStorageError(f"{operation}: recurso no encontrado. {detail}")
        if response.status_code == 400:
            raise ValidationError(f"{operation}: solicitud inválida. {detail}")
        raise CloudStorageError(f"{operation}: fallo de API. {detail}")

    def list_drivers(self, brand: Optional[str] = None, version: Optional[str] = None, search: Optional[str] = None):
        """Listar drivers del tenant actual."""
        base_url = self._get_api_base_url()
        headers = self._build_headers()
        params = {}
        if brand:
            params["brand"] = str(brand).strip()
        if version:
            params["version"] = str(version).strip()
        if search:
            params["search"] = str(search).strip()

        response = requests.get(
            f"{base_url}/web/drivers",
            headers=headers,
            params=params,
            timeout=self.timeout_seconds,
        )
        self._raise_for_response(response, "Listar drivers")
        payload = response.json() if response.content else {}
        if not isinstance(payload, dict):
            return []
        items = payload.get("items")
        if isinstance(items, list):
            return items
        legacy_items = payload.get("drivers")
        if isinstance(legacy_items, list):
            return legacy_items
        return []

    def get_driver_size_mb(self, driver):
        """Obtener tamaño del driver en MB sin consultas extra."""
        if not isinstance(driver, dict):
            return None
        if driver.get("size_mb") not in (None, "", "N/A"):
            try:
                return round(float(driver.get("size_mb")), 2)
            except Exception:
                return None
        if driver.get("size_bytes") not in (None, ""):
            try:
                return round(float(driver.get("size_bytes")) / (1024 * 1024), 2)
            except Exception:
                return None
        return None

    def download_driver(self, driver_key: str, local_path: str, progress_callback=None):
        """Descargar driver a ruta local."""
        key = str(driver_key or "").strip()
        if not key:
            raise ValidationError("Falta key de driver para descargar.")

        base_url = self._get_api_base_url()
        headers = self._build_headers()
        target = Path(local_path)
        target.parent.mkdir(parents=True, exist_ok=True)

        if progress_callback:
            progress_callback(0)

        with requests.get(
            f"{base_url}/web/drivers/download",
            headers=headers,
            params={"key": key},
            timeout=max(self.timeout_seconds, 60),
            stream=True,
        ) as response:
            self._raise_for_response(response, "Descargar driver")
            total = int(response.headers.get("Content-Length") or 0)
            written = 0
            with open(target, "wb") as out_file:
                for chunk in response.iter_content(chunk_size=128 * 1024):
                    if not chunk:
                        continue
                    out_file.write(chunk)
                    written += len(chunk)
                    if progress_callback and total > 0:
                        progress_callback(min(99, int((written / total) * 100)))

        if progress_callback:
            progress_callback(100)
        return str(target)

    def upload_driver(self, local_file_path: str, brand: str, version: str, description: str = "", progress_callback=None):
        """Subir driver con multipart/form-data."""
        file_path = Path(local_file_path)
        if not file_path.exists() or not file_path.is_file():
            raise ValidationError(f"No existe el archivo: {local_file_path}")
        if not str(brand or "").strip():
            raise ValidationError("Marca requerida para subir driver.")
        if not str(version or "").strip():
            raise ValidationError("Versión requerida para subir driver.")

        base_url = self._get_api_base_url()
        headers = self._build_headers()

        if progress_callback:
            progress_callback(5)

        mime_type, _ = mimetypes.guess_type(str(file_path))
        mime = mime_type or "application/octet-stream"

        with open(file_path, "rb") as input_stream:
            files = {
                "file": (file_path.name, input_stream, mime),
            }
            data = {
                "brand": str(brand).strip(),
                "version": str(version).strip(),
                "description": str(description or "").strip(),
            }
            response = requests.post(
                f"{base_url}/web/drivers",
                headers=headers,
                data=data,
                files=files,
                timeout=max(self.timeout_seconds, 120),
            )

        self._raise_for_response(response, "Subir driver")
        if progress_callback:
            progress_callback(100)

        payload = response.json() if response.content else {}
        if isinstance(payload, dict):
            driver = payload.get("driver")
            if isinstance(driver, dict):
                return driver.get("key") or driver.get("download_url")
        return None

    def delete_driver(self, driver_key: str):
        """Eliminar driver por key."""
        key = str(driver_key or "").strip()
        if not key:
            raise ValidationError("Falta key de driver para eliminar.")

        base_url = self._get_api_base_url()
        headers = self._build_headers()
        encoded_key = quote(key, safe="")
        response = requests.delete(
            f"{base_url}/web/drivers?key={encoded_key}",
            headers=headers,
            timeout=self.timeout_seconds,
        )
        self._raise_for_response(response, "Eliminar driver")
        return True
