import os

import requests

from core.exceptions import AuthenticationError, ConfigurationError, ValidationError


class UserAuthProvider:
    """Proveedor de autenticacion web/sesion para UserManagerV2."""

    READ_ONLY_ROLES = {"solo_lectura", "viewer"}
    OPERATIONAL_ROLES = {"admin", "super_admin", "supervisor", "tecnico"}
    SUPPORTED_WEB_ROLES = OPERATIONAL_ROLES | READ_ONLY_ROLES

    def __init__(self, owner):
        self.owner = owner

    def set_audit_api_client(self, audit_api_client):
        self.owner.audit_api_client = audit_api_client
        self._bind_audit_api_client_hooks()

    def _resolve_current_web_access_token(self):
        return str(self.owner.current_web_token or "").strip()

    def _resolve_current_web_session_context(self):
        current_user = self.owner.current_user if isinstance(self.owner.current_user, dict) else {}
        if not current_user:
            return {}
        if str(current_user.get("source") or "").strip().lower() != "web":
            return {}
        return {
            "user_id": current_user.get("id"),
            "username": current_user.get("username"),
            "role": current_user.get("role"),
            "tenant_id": current_user.get("tenant_id"),
        }

    def _bind_audit_api_client_hooks(self):
        client = self.owner.audit_api_client
        if client is None:
            return

        token_provider_setter = getattr(client, "set_web_token_provider", None)
        if callable(token_provider_setter):
            token_provider_setter(self._resolve_current_web_access_token)

        auth_failure_handler_setter = getattr(client, "set_web_auth_failure_handler", None)
        if callable(auth_failure_handler_setter):
            auth_failure_handler_setter(self._handle_audit_api_web_auth_failure)

        session_context_provider_setter = getattr(client, "set_web_session_context_provider", None)
        if callable(session_context_provider_setter):
            session_context_provider_setter(self._resolve_current_web_session_context)

    def _handle_audit_api_web_auth_failure(self, api_detail=""):
        had_web_token = bool(self._resolve_current_web_access_token())
        current_user = self.owner.current_user if isinstance(self.owner.current_user, dict) else {}
        is_web_user = current_user.get("source") == "web"
        if not had_web_token and not is_web_user:
            return

        username = str(current_user.get("username") or "").strip() or "unknown"
        self.owner.current_web_token = None
        self.owner.current_web_token_type = "Bearer"
        if is_web_user:
            self.owner.current_user = None

        self.owner.logger.warning(
            "Sesion web local invalidada tras 401 de API.",
            username=username,
            api_detail=str(api_detail or "").strip() or "N/A",
        )

    def _resolve_auth_mode(self, auth_mode):
        raw_mode = auth_mode if auth_mode is not None else os.getenv(
            "DRIVER_MANAGER_DESKTOP_AUTH_MODE",
            "",
        )
        normalized = str(raw_mode or "").strip().lower()

        if not normalized:
            return self.owner.AUTH_MODE_LEGACY
        if normalized in self.owner.ALLOWED_AUTH_MODES:
            return normalized

        self.owner.logger.warning(
            "Modo de autenticacion desktop invalido; se usa legacy.",
            requested_mode=normalized,
        )
        return self.owner.AUTH_MODE_LEGACY

    def _resolve_web_api_url(self):
        candidates = []

        if self.owner.audit_api_client and hasattr(self.owner.audit_api_client, "_get_api_url"):
            try:
                candidates.append(self.owner.audit_api_client._get_api_url())
            except Exception:
                pass

        candidates.append(os.getenv("DRIVER_MANAGER_HISTORY_API_URL", ""))

        if self.owner.audit_api_client and hasattr(self.owner.audit_api_client, "config_manager"):
            try:
                config_manager = self.owner.audit_api_client.config_manager
                if config_manager and hasattr(config_manager, "load_config_data"):
                    config = config_manager.load_config_data() or {}
                    candidates.append(config.get("api_url", ""))
                    candidates.append(config.get("history_api_url", ""))
            except Exception:
                pass

        for candidate in candidates:
            value = str(candidate or "").strip()
            if value:
                return value.rstrip("/")

        return ""

    def _should_try_web_auth(self):
        if self.owner.auth_mode == self.owner.AUTH_MODE_WEB:
            return True
        if self.owner.auth_mode == self.owner.AUTH_MODE_AUTO:
            return bool(self._resolve_web_api_url())
        return False

    def _permissions_for_role(self, role):
        normalized_role = str(role or "solo_lectura").strip().lower()
        if normalized_role == "super_admin":
            return ["all"]
        if normalized_role == "admin":
            return [
                "read",
                "write",
                "write_operational",
                "manage_assignments",
                "manage_tenant",
                "manage_drivers",
                "manage_r2",
            ]
        if normalized_role == "supervisor":
            return ["read", "write_operational", "manage_assignments"]
        if normalized_role == "tecnico":
            return ["read", "write_operational"]
        return ["read"]

    def _build_web_current_user(self, username, user_payload):
        payload = user_payload if isinstance(user_payload, dict) else {}
        resolved_username = str(payload.get("username") or username or "").strip()
        role = str(payload.get("role") or "solo_lectura").strip().lower() or "solo_lectura"
        if role == "viewer":
            role = "solo_lectura"
        if role not in self.SUPPORTED_WEB_ROLES:
            role = "solo_lectura"

        return {
            "id": payload.get("id"),
            "username": resolved_username,
            "role": role,
            "tenant_id": payload.get("tenant_id"),
            "active": bool(payload.get("is_active", True)),
            "created_at": payload.get("created_at"),
            "updated_at": payload.get("updated_at"),
            "last_login": payload.get("last_login_at"),
            "permissions": self._permissions_for_role(role),
            "source": "web",
        }

    def _extract_web_auth_session(self, payload, username="", context_label="Login web"):
        if not isinstance(payload, dict):
            payload = {}

        if payload.get("authenticated") is False:
            raise ConfigurationError(f"{context_label} devolvio authenticated=false.")

        access_token = str(payload.get("access_token") or "").strip()
        if not access_token:
            raise ConfigurationError(f"{context_label} exitoso pero sin access_token.")

        token_type = str(payload.get("token_type") or "Bearer").strip() or "Bearer"
        if token_type.lower() != "bearer":
            raise ConfigurationError(
                f"{context_label} devolvio token_type no soportado: {token_type}."
            )

        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "user": self._build_web_current_user(username, payload.get("user")),
        }

    def _extract_http_error_message(self, response):
        try:
            payload = response.json()
            if isinstance(payload, dict):
                error_obj = payload.get("error")
                if isinstance(error_obj, dict) and error_obj.get("message"):
                    return str(error_obj.get("message"))
                if payload.get("message"):
                    return str(payload.get("message"))
        except Exception:
            pass
        text = (response.text or "").strip()
        return text or f"HTTP {response.status_code}"

    def _build_current_web_auth_headers(self):
        access_token = str(self.owner.current_web_token or "").strip()
        if not access_token:
            raise AuthenticationError("No hay sesion web activa. Inicia sesion nuevamente.")

        token_type = str(self.owner.current_web_token_type or "Bearer").strip() or "Bearer"
        return {
            "Authorization": f"{token_type} {access_token}",
        }

    def _verify_current_web_password(self, base_url, password, context_label="super_admin"):
        if not password:
            raise ValidationError(f"Debes ingresar la contrasena web de {context_label}.")

        headers = self._build_current_web_auth_headers()
        response = requests.post(
            f"{base_url}/web/auth/verify-password",
            headers={
                **headers,
                "Content-Type": "application/json",
            },
            json={"password": password},
            timeout=20,
        )
        if response.ok:
            return headers

        detail = self._extract_http_error_message(response)
        normalized_detail = str(detail or "").strip().lower()
        if response.status_code in (401, 403):
            if (
                "sesion web" in normalized_detail
                or "token web" in normalized_detail
                or "falta token" in normalized_detail
            ):
                self._handle_audit_api_web_auth_failure(detail)
                raise AuthenticationError("La sesion web expiro. Inicia sesion nuevamente.")
            raise AuthenticationError(f"Contrasena web de {context_label} incorrecta.")

        raise ConfigurationError(
            f"No se pudo validar la contrasena web de {context_label}. {detail}"
        )

    def _authenticate_web(self, username, password):
        base_url = self._resolve_web_api_url()
        if not base_url:
            raise ConfigurationError(
                "No hay URL de API para login web. "
                "Define DRIVER_MANAGER_HISTORY_API_URL o api_url/history_api_url en config.enc."
            )

        try:
            response = requests.post(
                f"{base_url}/web/auth/login",
                json={
                    "username": username,
                    "password": password,
                },
                timeout=20,
            )
        except requests.RequestException as error:
            raise ConfigurationError(f"No se pudo conectar al login web: {error}") from error

        if not response.ok:
            detail = self._extract_http_error_message(response)
            if response.status_code in (401, 403):
                raise AuthenticationError(
                    "Usuario o contrasena incorrectos.",
                    details={"username": username},
                )
            if response.status_code == 429:
                raise AuthenticationError("Demasiados intentos. Intenta nuevamente mas tarde.")
            raise ConfigurationError(f"Fallo login web. {detail}")

        payload = response.json() if response.content else {}
        session = self._extract_web_auth_session(payload, username, "Login web")
        user = session["user"]
        self.owner.current_user = user
        self.owner.current_web_token = session["access_token"]
        self.owner.current_web_token_type = session["token_type"]

        self.owner.logger.security_event(
            "login_success",
            user.get("username"),
            True,
            {"role": user.get("role"), "source": "web"},
        )
        self.owner._log_access(
            "login_success",
            user.get("username"),
            True,
            {"role": user.get("role"), "source": "web"},
        )
        self.owner.logger.operation_end("authenticate", success=True, mode="web")
        return True, "Login exitoso."

    def _logout_web_session_best_effort(self):
        access_token = str(self.owner.current_web_token or "").strip()
        if not access_token:
            return

        base_url = self._resolve_web_api_url()
        if not base_url:
            return

        token_type = str(self.owner.current_web_token_type or "Bearer").strip() or "Bearer"
        try:
            response = requests.post(
                f"{base_url}/web/auth/logout",
                headers={
                    "Authorization": f"{token_type} {access_token}",
                },
                timeout=10,
            )
        except requests.RequestException as error:
            self.owner.logger.warning(f"No se pudo invalidar la sesion web remota: {error}")
            return

        if not response.ok and response.status_code not in (401, 403):
            self.owner.logger.warning(
                "Logout web remoto devolvio un estado inesperado.",
                status_code=response.status_code,
            )
