"""
Infraestructura de transporte/auth para InstallationHistory.

Separa resolucion de modo desktop, Bearer/HMAC y envio HTTP del manager
de negocio para reducir acoplamiento y facilitar pruebas unitarias.
"""

import hashlib
import hmac
import json
import os
import secrets
import sys
import time

import requests

from core.logger import get_logger

logger = get_logger()


class HistoryRequestAdapter:
    """Adaptador de autenticacion, firmado y transporte HTTP para la API."""

    def __init__(self, config_manager, timeout=10):
        self.config_manager = config_manager
        self.api_url = None
        self.api_token = None
        self.api_secret = None
        self.api_tenant_id = None
        self.web_token_provider = None
        self.web_session_context_provider = None
        self.web_auth_failure_handler = None
        self.allow_unsigned_requests = str(
            os.getenv("DRIVER_MANAGER_ALLOW_UNSIGNED_REQUESTS", "")
        ).strip().lower() in {"1", "true", "yes", "on"}
        self.timeout = timeout

        self._initialize_api_config()

    def set_web_token_provider(self, token_provider):
        """Registrar proveedor de token web (Bearer) para endpoints /web/*."""
        self.web_token_provider = token_provider

    def set_web_session_context_provider(self, context_provider):
        """Registrar proveedor del contexto de sesion web actual."""
        self.web_session_context_provider = context_provider

    def set_web_auth_failure_handler(self, failure_handler):
        """Registrar callback para invalidar sesion local cuando el Bearer falle con 401."""
        self.web_auth_failure_handler = failure_handler

    def _notify_web_auth_failure(self, api_detail=""):
        """Notificar al runtime desktop que el Bearer actual quedo invalido."""
        failure_handler = self.web_auth_failure_handler
        if not callable(failure_handler):
            return

        try:
            failure_handler(api_detail)
        except Exception as error:
            logger.warning(
                f"No se pudo notificar la invalidez de la sesion web local: {error}"
            )

    def _current_desktop_auth_mode(self):
        """Resolver modo desktop desde env o config persistida."""
        allowed_modes = {"legacy", "web", "auto"}

        env_mode = str(os.getenv("DRIVER_MANAGER_DESKTOP_AUTH_MODE", "")).strip().lower()
        if env_mode in allowed_modes:
            return env_mode

        config_manager = getattr(self, "config_manager", None)
        if config_manager and hasattr(config_manager, "load_config_data"):
            try:
                config = config_manager.load_config_data() or {}
            except Exception:
                config = {}
            config_mode = str(config.get("desktop_auth_mode", "")).strip().lower()
            if config_mode in allowed_modes:
                return config_mode

        return "legacy"

    def _get_web_access_token(self):
        provider = self.web_token_provider
        if not callable(provider):
            return ""
        try:
            return str(provider() or "").strip()
        except Exception:
            return ""

    def _get_web_session_context(self):
        provider = self.web_session_context_provider
        if not callable(provider):
            return {}
        try:
            context = provider() or {}
        except Exception:
            return {}
        return context if isinstance(context, dict) else {}

    def _resolve_active_tenant_id(self):
        session_tenant_id = str(
            self._get_web_session_context().get("tenant_id") or ""
        ).strip()
        if session_tenant_id:
            return session_tenant_id
        return str(self.api_tenant_id or "").strip()

    def _should_use_web_bearer_mode(self):
        mode = self._current_desktop_auth_mode()
        if mode not in {"web", "auto"}:
            return False
        return bool(self._get_web_access_token())

    def _requires_web_session(self):
        """Indicate when desktop is configured as web-only but has no active bearer session."""
        return self._current_desktop_auth_mode() == "web" and not self._get_web_access_token()

    def _initialize_api_config(self):
        """Inicializar configuracion de API de forma segura."""
        try:
            config = self.config_manager.load_config_data()
            desktop_auth_mode = self._current_desktop_auth_mode()

            if not config:
                logger.warning("No configuration found for API initialization")
                config = {}

            api_url = (
                os.getenv("DRIVER_MANAGER_HISTORY_API_URL", "")
                or config.get("api_url")
                or config.get("history_api_url", "")
            )
            if api_url:
                self.api_url = api_url.rstrip("/")
                logger.info(f"API URL configured: {self.api_url[:30]}...")

            self.api_token = (
                os.getenv("DRIVER_MANAGER_API_TOKEN")
                or config.get("api_token")
            )
            self.api_secret = (
                os.getenv("DRIVER_MANAGER_API_SECRET")
                or config.get("api_secret")
            )
            if self.api_token and self.api_secret:
                logger.info("Legacy API authentication configured successfully")
            else:
                if desktop_auth_mode == "web":
                    logger.info(
                        "Desktop auth mode 'web': legacy API token/secret are not required at startup."
                    )
                elif desktop_auth_mode == "auto":
                    logger.info(
                        "Desktop auth mode 'auto': use an active web session for /web/* or "
                        "configure legacy API token/secret for private HMAC routes."
                    )
                elif self.allow_unsigned_requests:
                    logger.warning(
                        "Legacy API authentication not configured. "
                        "Unsigned requests enabled by DRIVER_MANAGER_ALLOW_UNSIGNED_REQUESTS."
                    )
                else:
                    logger.error(
                        "Legacy API authentication not configured. "
                        "Requests in legacy mode will be blocked until API token/secret are configured."
                    )

            self.api_tenant_id = (
                os.getenv("DRIVER_MANAGER_API_TENANT_ID")
                or config.get("api_tenant_id")
                or config.get("tenant_id")
                or None
            )
            if self.api_tenant_id:
                self.api_tenant_id = str(self.api_tenant_id).strip()

        except Exception as error:
            logger.error(f"Failed to initialize API config: {error}", exc_info=True)

    def _get_api_url(self):
        """Obtener la URL de API desde configuracion sin fallback hardcodeado."""
        if "PYTEST_CURRENT_TEST" in os.environ or "unittest" in sys.modules:
            config = self.config_manager.load_config_data()
            return config.get("api_url", "").rstrip("/") if config else ""

        if self.api_url:
            return self.api_url

        try:
            config = self.config_manager.load_config_data()
            if config and config.get("api_url"):
                api_url = config.get("api_url").rstrip("/")
                logger.debug(f"API URL loaded from config: {api_url[:30]}...")
                self.api_url = api_url
                return api_url
        except Exception as error:
            logger.error(f"Failed to load API URL from config: {error}")

        logger.critical(
            "API URL not configured. Application requires reconfiguration.",
            severity="CRITICAL",
        )
        raise ConnectionError(
            "API URL no configurada.\n\n"
            "Por favor, configura las credenciales de Cloudflare "
            "en la pestana de Administracion.\n\n"
            "Si eres super_admin, ve a:\n"
            "Administracion > Configuracion de Cloudflare R2 > "
            "Campo 'URL de API de Historial'"
        )

    def _generate_request_signature(self, method, path, timestamp, body_hash, nonce):
        """Generar firma HMAC para solicitudes legacy privadas."""
        if not self.api_secret:
            return None

        message = f"{method.upper()}|{path}|{timestamp}|{body_hash}|{nonce}"
        return hmac.new(
            self.api_secret.encode(),
            message.encode(),
            hashlib.sha256,
        ).hexdigest()

    def _generate_request_nonce(self):
        """Generar nonce unico por request para prevenir replay."""
        return secrets.token_urlsafe(18)

    def _get_headers(self, method="GET", path="/", body_hash=""):
        """Generar headers con autenticacion legacy HMAC."""
        if not body_hash:
            body_hash = self._sha256_hex(b"")

        headers = {
            "Content-Type": "application/json",
            "X-Body-SHA256": body_hash,
        }

        if self.api_token and self.api_secret:
            timestamp = int(time.time())
            nonce = self._generate_request_nonce()
            signature = self._generate_request_signature(method, path, timestamp, body_hash, nonce)

            headers.update({
                "X-API-Token": self.api_token,
                "X-Request-Timestamp": str(timestamp),
                "X-Request-Signature": signature,
                "X-Request-Nonce": nonce,
            })
            active_tenant_id = self._resolve_active_tenant_id()
            if active_tenant_id:
                headers["X-Tenant-Id"] = active_tenant_id

        return headers

    def _serialize_json_body(self, body):
        """Serializar body JSON de forma determinista para hash/firma/envio."""
        if body is None:
            return ""
        return json.dumps(body, separators=(",", ":"), ensure_ascii=False)

    def _sha256_hex(self, raw_text):
        """Hash SHA-256 hexadecimal de texto UTF-8."""
        if raw_text is None:
            raw_text = ""
        if isinstance(raw_text, bytes):
            payload = raw_text
        else:
            payload = str(raw_text).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    def _make_request(
        self,
        method,
        endpoint,
        params=None,
        expect_json=True,
        extra_headers=None,
        **kwargs,
    ):
        """Realizar solicitud HTTP con autenticacion y validacion."""
        worker_url = self._get_api_url()

        if not worker_url:
            raise ConnectionError(
                "La URL del Worker (API) no esta configurada. "
                "Por favor, configura las credenciales de Cloudflare."
            )

        endpoint_clean = str(endpoint or "").lstrip("/")
        auth_mode = self._current_desktop_auth_mode()
        web_mode_active = auth_mode in {"web", "auto"}
        web_access_token = self._get_web_access_token()
        use_web_bearer_mode = self._should_use_web_bearer_mode()

        if web_mode_active and auth_mode == "web" and not web_access_token:
            raise ConnectionError(
                "No hay sesion web activa para consumir la API.\n\n"
                "Inicia sesion nuevamente para operar en modo web."
            )

        if use_web_bearer_mode and endpoint_clean and not endpoint_clean.startswith("web/"):
            endpoint_clean = f"web/{endpoint_clean}"

        url = f"{worker_url}/{endpoint_clean}"
        path = f"/{endpoint_clean}"

        body_bytes = b""
        if "json" in kwargs:
            json_payload = kwargs.pop("json")
            serialized_body = self._serialize_json_body(json_payload)
            body_bytes = serialized_body.encode("utf-8")
            kwargs["data"] = body_bytes
        elif isinstance(kwargs.get("data"), bytes):
            body_bytes = kwargs.get("data")
        elif isinstance(kwargs.get("data"), str):
            body_bytes = kwargs.get("data").encode("utf-8")
            kwargs["data"] = body_bytes
        elif kwargs.get("data") is not None:
            body_bytes = str(kwargs.get("data")).encode("utf-8")
            kwargs["data"] = body_bytes

        body_hash = self._sha256_hex(body_bytes)

        if use_web_bearer_mode:
            headers = {
                "Authorization": f"Bearer {web_access_token}",
            }
            active_tenant_id = self._resolve_active_tenant_id()
            if active_tenant_id:
                headers["X-Tenant-Id"] = active_tenant_id
            if kwargs.get("data") is not None:
                headers["Content-Type"] = "application/json"
            if extra_headers:
                headers.update(extra_headers)
        else:
            headers = self._get_headers(method, path, body_hash)
            if extra_headers:
                headers.update(extra_headers)
            if not self.allow_unsigned_requests:
                missing_auth_headers = [
                    header_name
                    for header_name in (
                        "X-API-Token",
                        "X-Request-Timestamp",
                        "X-Request-Signature",
                        "X-Request-Nonce",
                    )
                    if not headers.get(header_name)
                ]
                if missing_auth_headers:
                    if auth_mode == "auto":
                        raise ConnectionError(
                            "Autenticacion desktop no configurada para modo auto.\n\n"
                            "Activa una sesion web para usar /web/* o configura "
                            "DRIVER_MANAGER_API_TOKEN y DRIVER_MANAGER_API_SECRET para rutas legacy privadas.\n"
                            "Para debug local unicamente, habilita DRIVER_MANAGER_ALLOW_UNSIGNED_REQUESTS=true."
                        )
                    raise ConnectionError(
                        "Autenticacion API legacy no configurada para desktop.\n\n"
                        "Configura DRIVER_MANAGER_API_TOKEN y DRIVER_MANAGER_API_SECRET (o config.enc).\n"
                        "Para debug local unicamente, habilita DRIVER_MANAGER_ALLOW_UNSIGNED_REQUESTS=true."
                    )

        try:
            response = requests.request(
                method,
                url,
                headers=headers,
                params=params,
                timeout=self.timeout,
                **kwargs,
            )
            response.raise_for_status()
            if expect_json:
                return response.json() if response.content else None
            return response

        except requests.exceptions.Timeout:
            logger.error(f"Request timeout: {url}")
            raise ConnectionError(f"Timeout al conectar con la API: {url}")

        except requests.exceptions.ConnectionError as error:
            logger.error(f"Connection error: {error}")
            raise ConnectionError(f"Error de conexion con la API: {str(error)}")

        except requests.exceptions.HTTPError as error:
            if error.response.status_code == 401:
                api_detail = ""
                try:
                    payload = error.response.json()
                    api_detail = payload.get("error", {}).get("message", "")
                except Exception:
                    api_detail = (error.response.text or "").strip()[:200]

                logger.error(
                    "API authentication failed (401 Unauthorized)",
                    api_detail=api_detail or "N/A",
                )

                detail_line = f"\nDetalle API: {api_detail}" if api_detail else ""
                if use_web_bearer_mode:
                    self._notify_web_auth_failure(api_detail)
                    raise ConnectionError(
                        "[ERROR] La sesion web de la API ya no es valida.\n\n"
                        "Inicia sesion nuevamente para continuar."
                        f"{detail_line}"
                    )
                raise ConnectionError(
                    "Autenticacion fallida con la API.\n\n"
                    "Las credenciales de API pueden estar incorrectas o expiradas.\n"
                    "Contacta al super_admin para verificar la configuracion."
                    f"{detail_line}"
                )
            if error.response.status_code == 403:
                logger.error("API access forbidden (403 Forbidden)")
                raise ConnectionError(
                    "Acceso denegado a la API.\n\n"
                    "Tu cuenta no tiene permisos para realizar esta operacion."
                )

            logger.error(f"HTTP error: {error}")
            raise ConnectionError(f"Error HTTP {error.response.status_code}: {str(error)}")

        except Exception as error:
            logger.error(f"Unexpected error in API request: {error}", exc_info=True)
            raise ConnectionError(f"Error inesperado al conectar con la API: {str(error)}")
