import re

import requests

from core.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ValidationError,
    validate_min_length,
)


class UserTenantWebService:
    """Operaciones de administracion web por tenant para UserManagerV2."""

    ROLE_ALIASES = {
        "viewer": "solo_lectura",
    }

    def __init__(self, owner):
        self.owner = owner

    def _normalize_role_label(self, role):
        normalized_role = str(role or "solo_lectura").strip().lower() or "solo_lectura"
        return self.ROLE_ALIASES.get(normalized_role, normalized_role)

    def create_tenant_web_user(self, username, password, role, tenant_id, admin_web_password):
        self.owner.logger.operation_start(
            "create_tenant_web_user",
            username=username,
            role=role,
            tenant_id=tenant_id,
        )

        if not self.owner.current_user or self.owner.current_user.get("role") != "super_admin":
            raise AuthenticationError("Solo super_admin puede crear usuarios por tenant.")

        validate_min_length(username, 3, "username")
        if not re.match(r"^[a-zA-Z0-9_-]+$", username):
            raise ValidationError(
                "Nombre de usuario invalido (solo letras, numeros, guiones y guiones bajos).",
                details={"username": username},
            )

        tenant_id = str(tenant_id or "").strip()

        is_valid, message, score = self.owner.password_validator.validate_password_strength(
            password,
            username,
        )
        if not is_valid:
            raise ValidationError(
                f"La contrasena no cumple con los requisitos de seguridad:\n{message}",
                details={"username": username, "password_score": score},
            )

        if not self.owner.audit_api_client or not hasattr(self.owner.audit_api_client, "_get_api_url"):
            raise ConfigurationError("No hay cliente API disponible para creacion por tenant.")

        base_url = self.owner.audit_api_client._get_api_url().rstrip("/")
        if not base_url:
            raise ConfigurationError("URL de API no configurada.")

        admin_username = self.owner.current_user.get("username")
        if not admin_username:
            raise AuthenticationError("No hay usuario actual para autenticacion web.")

        auth_headers = self.owner._verify_current_web_password(
            base_url,
            admin_web_password,
            "super_admin",
        )

        create_response = requests.post(
            f"{base_url}/web/auth/users",
            headers={
                **auth_headers,
                "Content-Type": "application/json",
            },
            json={
                "username": username,
                "password": password,
                "role": role,
                "tenant_id": tenant_id or None,
            },
            timeout=20,
        )
        if not create_response.ok:
            detail = self.owner._extract_http_error_message(create_response)
            if tenant_id:
                raise ValidationError(
                    f"No se pudo crear usuario web en tenant '{tenant_id}'. {detail}"
                )
            raise ValidationError(f"No se pudo crear usuario web. {detail}")

        self.owner._log_access(
            "user_created_tenant_web",
            admin_username,
            True,
            {
                "new_user": username,
                "role": role,
                "tenant_id": tenant_id,
                "password_strength": score,
            },
        )

        self.owner.logger.operation_end("create_tenant_web_user", success=True)
        if tenant_id:
            return True, (
                f"Usuario web creado en tenant '{tenant_id}'.\n"
                "Nota: este usuario se gestiona en D1/web y puede no aparecer en la lista local."
            )
        return True, (
            "Usuario web creado exitosamente.\n"
            "Nota: este usuario se autentica contra la API web y puede no aparecer en la lista local."
        )

    def fetch_tenant_web_users(self, admin_web_password, tenant_id=None):
        self.owner.logger.operation_start("fetch_tenant_web_users", tenant_id=tenant_id or "")

        if not self.owner.current_user or self.owner.current_user.get("role") != "super_admin":
            raise AuthenticationError("Solo super_admin puede consultar usuarios web por tenant.")

        if not self.owner.audit_api_client or not hasattr(self.owner.audit_api_client, "_get_api_url"):
            raise ConfigurationError("No hay cliente API disponible para consultar usuarios web.")

        base_url = self.owner.audit_api_client._get_api_url().rstrip("/")
        if not base_url:
            raise ConfigurationError("URL de API no configurada.")

        admin_username = self.owner.current_user.get("username")
        if not admin_username:
            raise AuthenticationError("No hay usuario actual para autenticacion web.")

        auth_headers = self.owner._verify_current_web_password(
            base_url,
            admin_web_password,
            "super_admin",
        )

        params = {}
        normalized_tenant_id = str(tenant_id or "").strip()
        if normalized_tenant_id:
            params["tenant_id"] = normalized_tenant_id

        users_response = requests.get(
            f"{base_url}/web/auth/users",
            headers={**auth_headers},
            params=params,
            timeout=20,
        )
        if not users_response.ok:
            detail = self.owner._extract_http_error_message(users_response)
            raise ValidationError(f"No se pudo consultar usuarios web. {detail}")

        payload = users_response.json() if users_response.content else {}
        raw_users = payload.get("users") if isinstance(payload, dict) else []
        if not isinstance(raw_users, list):
            raw_users = []

        normalized = []
        for item in raw_users:
            if not isinstance(item, dict):
                continue
            normalized.append(
                {
                    "username": item.get("username"),
                    "role": self._normalize_role_label(item.get("role", "solo_lectura")),
                    "tenant_id": item.get("tenant_id"),
                    "active": bool(item.get("is_active", True)),
                    "last_login": item.get("last_login_at"),
                    "created_at": item.get("created_at"),
                    "created_by": "web-api",
                    "source": "web",
                }
            )

        self.owner.logger.operation_end(
            "fetch_tenant_web_users",
            success=True,
            count=len(normalized),
        )
        return normalized
