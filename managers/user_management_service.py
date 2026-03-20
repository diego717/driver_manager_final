import re
from datetime import datetime

from core.exceptions import (
    AuthenticationError,
    CloudStorageError,
    ConfigurationError,
    ValidationError,
    validate_min_length,
)


class UserManagementService:
    """Reglas de negocio de usuarios para UserManagerV2."""

    def __init__(self, owner):
        self.owner = owner

    def create_user(self, username, password, role="admin", created_by=None, **kwargs):
        self.owner.logger.operation_start("create_user", username=username, role=role)
        current_username = (
            self.owner.current_user.get("username", "N/A")
            if self.owner.current_user
            else "N/A"
        )

        if not self.owner.current_user or self.owner.current_user.get("role") != "super_admin":
            self.owner.logger.security_event(
                "user_creation_failed",
                current_username,
                False,
                {"reason": "Insufficient permissions"},
            )
            raise AuthenticationError("Solo super_admin puede crear usuarios.")

        validate_min_length(username, 3, "username")
        if not re.match(r"^[a-zA-Z0-9_-]+$", username):
            raise ValidationError(
                "Nombre de usuario invalido (solo letras, numeros, guiones y guiones bajos).",
                details={"username": username},
            )

        is_valid, message, score = self.owner.password_validator.validate_password_strength(
            password,
            username,
        )
        if not is_valid:
            raise ValidationError(
                f"La contrasena no cumple con los requisitos de seguridad:\n{message}",
                details={"username": username, "password_score": score},
            )

        users_data = self.owner._load_users()
        try:
            if not users_data:
                users_data = {
                    "users": {},
                    "created_at": datetime.now().isoformat(),
                    "version": "2.1",
                }

            if username in users_data["users"]:
                self.owner.logger.warning("Attempt to create duplicate user", username=username)
                raise ValidationError("El usuario ya existe.", details={"username": username})

            new_user = {
                "username": username,
                "password_hash": self.owner._hash_password(password),
                "password_history": [],
                "role": role,
                "tenant_id": kwargs.get("tenant_id"),
                "created_at": datetime.now().isoformat(),
                "created_by": created_by or self.owner.current_user.get("username"),
                "last_login": None,
                "last_password_change": datetime.now().isoformat(),
                "active": True,
                "permissions": self.owner._permissions_for_role(role),
                "email": kwargs.get("email"),
                "full_name": kwargs.get("full_name"),
                "password_strength_score": score,
            }

            users_data["users"][username] = new_user
            self.owner._save_users(users_data)

            self.owner.logger.security_event(
                "user_created",
                self.owner.current_user.get("username"),
                True,
                {
                    "new_user": username,
                    "role": role,
                    "password_strength": score,
                },
            )
            self.owner._log_access(
                "user_created",
                self.owner.current_user.get("username"),
                True,
                {
                    "new_user": username,
                    "role": role,
                    "password_strength": score,
                },
            )
            self.owner.logger.operation_end("create_user", success=True)
            return True, f"Usuario creado exitosamente.\nFortaleza de contrasena: {score}/100"
        except (
            AuthenticationError,
            ValidationError,
            ConfigurationError,
            CloudStorageError,
        ) as error:
            self.owner.logger.error(
                f"Error creating user: {error.message}",
                exc_info=False,
                username=username,
                role=role,
                details=error.details,
            )
            self.owner.logger.operation_end("create_user", success=False, reason=error.message)
            raise
        except Exception as error:
            self.owner.logger.error(
                f"Unexpected error creating user: {error}",
                exc_info=True,
                username=username,
                role=role,
            )
            self.owner.logger.operation_end("create_user", success=False, reason=str(error))
            raise

    def change_password(self, username, old_password, new_password):
        self.owner.logger.operation_start("change_password", username=username)

        users_data = self.owner._load_users()
        if not users_data or username not in users_data["users"]:
            self.owner.logger.security_event(
                "password_change_failed",
                username,
                False,
                {"reason": "User not found"},
            )
            raise AuthenticationError("Usuario no encontrado.")

        user = users_data["users"][username]
        if not self.owner._verify_password(old_password, user["password_hash"]):
            self.owner.logger.security_event(
                "password_change_failed",
                username,
                False,
                {"reason": "Wrong old password"},
            )
            raise AuthenticationError("Contrasena actual incorrecta.")

        is_valid, message, score = self.owner.password_validator.validate_password_strength(
            new_password,
            username,
        )
        if not is_valid:
            raise ValidationError(
                f"La nueva contrasena no cumple con los requisitos:\n{message}",
                details={"username": username, "password_score": score},
            )

        password_history = user.get("password_history", [])
        if not self.owner.password_validator.check_password_history(new_password, password_history):
            raise ValidationError(
                "No puedes reutilizar una de tus ultimas "
                f"{self.owner.password_validator.PASSWORD_HISTORY_SIZE} contrasenas.\n"
                "Por favor, elige una contrasena diferente.",
                details={"username": username},
            )

        new_hash = self.owner._hash_password(new_password)
        if user["password_hash"] not in password_history:
            password_history.append(user["password_hash"])

        if len(password_history) > self.owner.password_validator.PASSWORD_HISTORY_SIZE:
            password_history = password_history[
                -self.owner.password_validator.PASSWORD_HISTORY_SIZE :
            ]

        timestamp = datetime.now().isoformat()
        user["password_hash"] = new_hash
        user["password_history"] = password_history
        user["password_changed_at"] = timestamp
        user["last_password_change"] = timestamp
        user["password_strength_score"] = score

        users_data["users"][username] = user
        self.owner._save_users(users_data)

        self.owner.logger.security_event(
            "password_changed",
            username,
            True,
            {"password_strength": score},
        )
        self.owner._log_access(
            "password_changed",
            username,
            True,
            {"password_strength": score},
        )
        self.owner.logger.operation_end("change_password", success=True)
        return True, f"Contrasena cambiada exitosamente.\nFortaleza: {score}/100"

    def deactivate_user(self, username):
        self.owner.logger.operation_start("deactivate_user", target_username=username)
        current_username = (
            self.owner.current_user.get("username", "N/A")
            if self.owner.current_user
            else "N/A"
        )

        if not self.owner.current_user or self.owner.current_user.get("role") != "super_admin":
            self.owner.logger.security_event(
                "user_deactivation_failed",
                current_username,
                False,
                {"reason": "Insufficient permissions"},
            )
            raise AuthenticationError("Solo super_admin puede desactivar usuarios.")

        if username == "admin":
            self.owner.logger.warning("Attempt to deactivate main admin user", target_username=username)
            raise ValidationError("No se puede desactivar el usuario admin principal.")

        users_data = self.owner._load_users()
        if not users_data or username not in users_data["users"]:
            self.owner.logger.security_event(
                "user_deactivation_failed",
                current_username,
                False,
                {"reason": "User not found", "target_username": username},
            )
            raise AuthenticationError("Usuario no encontrado.")

        users_data["users"][username]["active"] = False
        users_data["users"][username]["deactivated_at"] = datetime.now().isoformat()
        users_data["users"][username]["deactivated_by"] = self.owner.current_user.get("username")
        self.owner._save_users(users_data)

        self.owner.logger.security_event(
            "user_deactivated",
            self.owner.current_user.get("username"),
            True,
            {"deactivated_user": username},
        )
        self.owner._log_access(
            "user_deactivated",
            self.owner.current_user.get("username"),
            True,
            {"deactivated_user": username},
        )
        self.owner.logger.operation_end("deactivate_user", success=True)
        return True, "Usuario desactivado."
