"""
Sistema Mejorado de Gestión de Usuarios Multi-Admin - Seguridad Reforzada
Incluye migración automática del sistema legacy

SECURITY IMPROVEMENTS:
- SEC-004: Strong password policy with complexity requirements
- SEC-005: Account lockout mechanism after failed attempts
- Password breach checking (optional integration)
- Password history to prevent reuse
"""

import json
import hashlib
import secrets
import bcrypt
import re
import sys
import copy
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
import socket
import platform
import requests

from core.logger import get_logger
from core.password_policy import PasswordPolicy
from managers.user_audit_service import UserAuditService
from managers.user_auth_provider import UserAuthProvider
from managers.user_management_service import UserManagementService
from managers.user_repository import UserRepository
from managers.user_tenant_web_service import UserTenantWebService
from core.exceptions import (
    handle_errors,
    returns_result_tuple,
    AuthenticationError,
    ValidationError,
    ConfigurationError,
    CloudStorageError,
    SecurityError,
    validate_min_length
)


class PasswordValidator:
    """
    Validador de contraseñas con políticas de seguridad robustas.
    
    SECURITY IMPROVEMENT (SEC-004): Comprehensive password validation.
    """
    
    # Configuración de política de contraseñas
    MIN_LENGTH = PasswordPolicy.MIN_LENGTH
    REQUIRE_UPPERCASE = PasswordPolicy.REQUIRE_UPPER
    REQUIRE_LOWERCASE = PasswordPolicy.REQUIRE_LOWER
    REQUIRE_DIGIT = PasswordPolicy.REQUIRE_DIGIT
    REQUIRE_SPECIAL = PasswordPolicy.REQUIRE_SPECIAL
    SPECIAL_CHARS = PasswordPolicy.SPECIAL_CHARS
    
    # Password history
    PASSWORD_HISTORY_SIZE = 5
    
    @classmethod
    def validate_password_strength(cls, password, username=None):
        """Validar contraseña con la política compartida."""
        return PasswordPolicy.validate_with_score(password, username or "")

    @classmethod
    def check_password_history(cls, new_password, password_history):
        """
        Verificar que la contraseña no está en el historial.
        
        Args:
            new_password: Nueva contraseña
            password_history: Lista de hashes anteriores
            
        Returns:
            bool: True si la contraseña es nueva (no está en historial)
        """
        if not password_history:
            return True
        
        # Verificar contra cada hash en el historial
        for old_hash in password_history:
            try:
                if bcrypt.checkpw(new_password.encode('utf-8'), old_hash.encode('utf-8')):
                    return False
            except (ValueError, TypeError, AttributeError, UnicodeError):
                continue
        
        return True


class AccountLockoutManager:
    """
    Gestor de bloqueo de cuentas por intentos fallidos.
    
    SECURITY IMPROVEMENT (SEC-005): Account lockout mechanism.
    """
    
    # Configuración
    MAX_FAILED_ATTEMPTS = 5
    LOCKOUT_DURATION_MINUTES = 15
    LOCKOUT_INCREASE_FACTOR = 2  # Cada bloqueo subsecuente dura el doble
    
    def __init__(self):
        self.failed_attempts = {}  # username -> {count, last_attempt, lockout_until, lockout_count}
    
    def record_failed_attempt(self, username, ip_address=None):
        """
        Registrar intento fallido de autenticación.
        
        Args:
            username: Usuario que intentó autenticarse
            ip_address: IP desde donde se intenta (opcional)
            
        Returns:
            dict: Estado actual de la cuenta
        """
        now = datetime.now()
        
        if username not in self.failed_attempts:
            self.failed_attempts[username] = {
                'count': 0,
                'last_attempt': now,
                'lockout_until': None,
                'lockout_count': 0,
                'ip_addresses': []
            }
        
        account_info = self.failed_attempts[username]
        
        # Si está bloqueado, no incrementar contador
        if self.is_locked_out(username):
            return account_info
        
        # Incrementar contador de intentos
        account_info['count'] += 1
        account_info['last_attempt'] = now
        
        if ip_address and ip_address not in account_info['ip_addresses']:
            account_info['ip_addresses'].append(ip_address)
        
        # Si alcanza el máximo, bloquear cuenta
        if account_info['count'] >= self.MAX_FAILED_ATTEMPTS:
            lockout_count = account_info['lockout_count']
            duration_minutes = self.LOCKOUT_DURATION_MINUTES * (self.LOCKOUT_INCREASE_FACTOR ** lockout_count)
            
            account_info['lockout_until'] = now + timedelta(minutes=duration_minutes)
            account_info['lockout_count'] += 1
            account_info['count'] = 0  # Resetear contador
            
            logger = get_logger()
            logger.security_event(
                event_type="account_locked",
                username=username,
                success=False,
                details={
                    'lockout_duration_minutes': duration_minutes,
                    'lockout_number': account_info['lockout_count'],
                    'ip_addresses': account_info['ip_addresses']
                },
                severity='WARNING'
            )
        
        return account_info
    
    def record_successful_login(self, username):
        """
        Registrar login exitoso (resetea contador).
        
        Args:
            username: Usuario que se autenticó correctamente
        """
        if username in self.failed_attempts:
            self.failed_attempts[username]['count'] = 0
            self.failed_attempts[username]['ip_addresses'] = []
            # Mantener lockout_until y lockout_count por si acaso
    
    def is_locked_out(self, username):
        """
        Verificar si una cuenta está bloqueada.
        
        Args:
            username: Usuario a verificar
            
        Returns:
            bool: True si está bloqueada
        """
        if username not in self.failed_attempts:
            return False
        
        account_info = self.failed_attempts[username]
        lockout_until = account_info.get('lockout_until')
        
        if not lockout_until:
            return False
        
        # Verificar si el bloqueo ya expira
        if datetime.now() > lockout_until:
            account_info['lockout_until'] = None
            return False
        
        return True
    
    def get_lockout_time_remaining(self, username):
        """
        Obtener tiempo restante de bloqueo.
        
        Args:
            username: Usuario
            
        Returns:
            timedelta or None: Tiempo restante o None si no está bloqueado
        """
        if not self.is_locked_out(username):
            return None
        
        lockout_until = self.failed_attempts[username]['lockout_until']
        return lockout_until - datetime.now()
    
    def get_failed_attempts_count(self, username):
        """
        Obtener número de intentos fallidos actuales.
        
        Args:
            username: Usuario
            
        Returns:
            int: Namero de intentos fallidos
        """
        if username not in self.failed_attempts:
            return 0
        return self.failed_attempts[username].get('count', 0)
    
    def unlock_account(self, username):
        """
        Desbloquear cuenta manualmente (solo admin).
        
        Args:
            username: Usuario a desbloquear
        """
        if username in self.failed_attempts:
            self.failed_attempts[username]['lockout_until'] = None
            self.failed_attempts[username]['count'] = 0
            
            logger = get_logger()
            logger.security_event(
                event_type="account_unlocked_manually",
                username=username,
                success=True,
                severity='INFO'
            )


class UserManagerV2:
    """
    Gestor de usuarios mejorado con seguridad reforzada.
    
    SECURITY IMPROVEMENTS:
    - SEC-004: Strong password policy
    - SEC-005: Account lockout mechanism
    - Password history tracking
    - Enhanced validation
    """
    
    logger = get_logger()
    USERS_CACHE_TTL_SECONDS = 2.0
    LEGACY_LOG_APPEND_RETRIES = 3
    AUTH_MODE_LEGACY = "legacy"
    AUTH_MODE_WEB = "web"
    AUTH_MODE_AUTO = "auto"
    ALLOWED_AUTH_MODES = {AUTH_MODE_LEGACY, AUTH_MODE_WEB, AUTH_MODE_AUTO}
    
    def __init__(
        self,
        cloud_manager=None,
        security_manager=None,
        local_mode=False,
        audit_api_client=None,
        auth_mode=None,
    ):
        """
        Args:
            cloud_manager: Gestor de nube (opcional)
            security_manager: Gestor de seguridad para cifrado
            local_mode: Si True, usa almacenamiento local
        """
        self.cloud_manager = cloud_manager
        self.security_manager = security_manager
        self.local_mode = local_mode or (cloud_manager is None)
        self.audit_api_client = None
        self.current_user = None
        self.current_web_token = None
        self.current_web_token_type = "Bearer"
        self._users_cache_data = None
        self._users_cache_loaded_at = 0.0
        self.auth_provider = UserAuthProvider(self)
        self.auth_mode = self._resolve_auth_mode(auth_mode)
        self.user_repository = UserRepository(self)
        self.audit_service = UserAuditService(self)
        self.user_management_service = UserManagementService(self)
        self.user_tenant_web_service = UserTenantWebService(self)
        self.password_validator = PasswordValidator
        self.set_audit_api_client(audit_api_client)
        
        # SECURITY IMPROVEMENT (SEC-005): Account lockout manager
        self.lockout_manager = AccountLockoutManager()
        
        # Rutas de archivos
        self.config_dir = Path.home() / ".driver_manager"
        self.config_dir.mkdir(parents=True, exist_ok=True)
        
        if self.local_mode:
            self.users_file = self.config_dir / "users.json"
            self.logs_file = self.config_dir / "access_logs.json"
        else:
            self.users_file = "system/users.json"
            self.logs_file = "system/access_logs.json"
        
        # Inicializar cifrado de nube si está disponible
        if security_manager and not local_mode:
            from core.security_manager import CloudDataEncryption
            self.cloud_encryption = CloudDataEncryption(security_manager)
        else:
            self.cloud_encryption = None

    def set_audit_api_client(self, audit_api_client):
        """Asignar cliente API para auditoría remota (D1)."""
        return self.auth_provider.set_audit_api_client(audit_api_client)

    def _resolve_current_web_access_token(self):
        """Resolver token web actual para clientes API que dependan del UserManager."""
        return self.auth_provider._resolve_current_web_access_token()

    def _bind_audit_api_client_hooks(self):
        """Conectar el cliente de auditoría con el estado de sesión web actual."""
        return self.auth_provider._bind_audit_api_client_hooks()

    def _handle_audit_api_web_auth_failure(self, api_detail=""):
        """Limpiar sesión web local cuando la API informa Bearer inválido/expirado."""
        return self.auth_provider._handle_audit_api_web_auth_failure(api_detail)

    def _resolve_auth_mode(self, auth_mode):
        """Resolver modo de autenticaci??n desktop: legacy | web | auto."""
        return self.auth_provider._resolve_auth_mode(auth_mode)

    def _resolve_web_api_url(self):
        """Resolver base URL para autenticaci??n web."""
        return self.auth_provider._resolve_web_api_url()

    def _should_try_web_auth(self):
        """Determinar si este login debe intentar autenticaci??n web."""
        return self.auth_provider._should_try_web_auth()

    def _permissions_for_role(self, role):
        return self.auth_provider._permissions_for_role(role)

    def _build_web_current_user(self, username, user_payload):
        """Normalizar usuario retornado por /web/auth/login."""
        return self.auth_provider._build_web_current_user(username, user_payload)

    def _extract_web_auth_session(self, payload, username="", context_label="Login web"):
        """Validar el contrato oficial de sesion web emitido por /web/auth/login|bootstrap."""
        return self.auth_provider._extract_web_auth_session(payload, username, context_label)

    def _authenticate_web(self, username, password):
        """Autenticar contra /web/auth/login."""
        return self.auth_provider._authenticate_web(username, password)

    def _logout_web_session_best_effort(self):
        """Invalidar la sesion remota usando el mismo Bearer emitido por /web/auth/login."""
        return self.auth_provider._logout_web_session_best_effort()

    def _can_use_audit_api(self):
        return self.audit_service._can_use_audit_api()

    def _should_defer_access_logging(self):
        """Skip legacy audit persistence until desktop has a usable auth context."""
        return self.audit_service._should_defer_access_logging()

    def _cache_clock(self):
        return time.monotonic()

    def _invalidate_users_cache(self):
        return self.user_repository._invalidate_users_cache()

    def _set_users_cache(self, users_data):
        return self.user_repository._set_users_cache(users_data)

    def _get_cached_users(self):
        return self.user_repository._get_cached_users()

    def _normalize_audit_api_log_entry(self, entry):
        """Normalizar un registro de auditor??a proveniente del endpoint D1."""
        return self.audit_service._normalize_audit_api_log_entry(entry)

    def _extract_http_error_message(self, response):
        """Obtener mensaje de error desde una respuesta HTTP."""
        return self.auth_provider._extract_http_error_message(response)

    def _build_current_web_auth_headers(self):
        """Construir headers Authorization usando la sesi??n web actual."""
        return self.auth_provider._build_current_web_auth_headers()

    def _verify_current_web_password(self, base_url, password, context_label="super_admin"):
        """Validar la contrase??a del usuario web actual sin reloguear ni rotar la sesi??n."""
        return self.auth_provider._verify_current_web_password(base_url, password, context_label)

    @returns_result_tuple("initialize_system")
    def initialize_system(self, first_user_username, first_user_password):
        """
        Inicializar sistema con primer usuario super_admin.
        
        SECURITY: Applies password policy even for first user.
        
        Args:
            first_user_username: Nombre de usuario del primer admin
            first_user_password: Contraseña del primer admin
            
        Returns:
            (success: bool, message: str)
        """
        self.logger.operation_start("initialize_system", username=first_user_username)
        
        try:
            # Verificar que no existan usuarios
            users_data = self._load_users()
            if users_data and len(users_data.get('users', {})) > 0:
                raise ConfigurationError("El sistema ya tiene usuarios configurados.")
            
            # Validar contraseña del primer usuario con la política vigente
            is_valid, message, score = PasswordValidator.validate_password_strength(
                first_user_password,
                first_user_username
            )
            
            if not is_valid:
                raise ValidationError(
                    f"La contraseña del primer usuario no cumple con los requisitos de seguridad:\n{message}"
                )
            
            # Crear primer usuario
            first_user = {
                "username": first_user_username,
                "password_hash": self._hash_password(first_user_password),
                "password_history": [],
                "role": "super_admin",
                "created_at": datetime.now().isoformat(),
                "created_by": "system",
                "last_login": None,
                "last_password_change": datetime.now().isoformat(),
                "active": True,
                "permissions": ["all"],
                "email": None,
                "full_name": None,
                "password_strength_score": score
            }
            
            users_data = {
                "users": {
                    first_user_username: first_user
                },
                "created_at": datetime.now().isoformat(),
                "version": "2.1",  # Incrementada por mejoras de seguridad
                "migrated_from_legacy": False,
                "password_policy": {
                    "min_length": PasswordValidator.MIN_LENGTH,
                    "require_complexity": True,
                    "history_size": PasswordValidator.PASSWORD_HISTORY_SIZE,
                    "max_age_days": None  # Opcional
                },
                "lockout_policy": {
                    "max_attempts": AccountLockoutManager.MAX_FAILED_ATTEMPTS,
                    "lockout_duration_minutes": AccountLockoutManager.LOCKOUT_DURATION_MINUTES
                }
            }
            
            # Guardar
            self._save_users(users_data)
            
            # Registrar evento de inicializacion
            self.logger.security_event(
                event_type="system_initialized",
                username=first_user_username,
                success=True,
                details={
                    'message': f"First user created: {first_user_username}",
                    'password_strength': score
                }
            )
            
            self.logger.operation_end("initialize_system", success=True)
            return True, f"Sistema inicializado correctamente.\nFortaleza de contraseña: {score}/100"
            
        except Exception as e:
            return False, f"Error inicializando sistema: {str(e)}"
    
    def _hash_password(self, password, salt=None):
        """Hash seguro de contraseña con bcrypt"""
        password_bytes = password.encode('utf-8')
        hashed = bcrypt.hashpw(password_bytes, bcrypt.gensalt(rounds=12))
        return hashed.decode('utf-8')
    
    def _verify_password(self, password, hashed):
        """Verificar contraseña usando bcrypt"""
        try:
            password_bytes = password.encode('utf-8')
            hashed_bytes = hashed.encode('utf-8')
            return bcrypt.checkpw(password_bytes, hashed_bytes)
        except (ValueError, TypeError):
            # Fallback al método antiguo si existe
            return self._verify_password_legacy(password, hashed)
    
    def _verify_password_legacy(self, password, hashed):
        """Verificar contraseña con método legacy (PBKDF2)"""
        try:
            salt = hashed[:64]
            stored_key = hashed[64:]
            
            key = hashlib.pbkdf2_hmac('sha256',
                                     password.encode('utf-8'),
                                     salt.encode('utf-8'),
                                     100000)
            return key.hex() == stored_key
        except (ValueError, TypeError, AttributeError, UnicodeError):
            return False
    
    def _get_system_info(self):
        """Obtener información del sistema para auditoría"""
        try:
            return {
                'computer_name': socket.gethostname(),
                'username': Path.home().name,
                'platform': platform.system(),
                'ip': socket.gethostbyname(socket.gethostname())
            }
        except (OSError, UnicodeError):
            return {
                'computer_name': 'Unknown',
                'username': 'Unknown',
                'platform': 'Unknown',
                'ip': 'Unknown'
            }
    
    def _load_users(self):
        """Cargar usuarios desde almacenamiento"""
        return self.user_repository._load_users()

    def _normalize_users_data(self, users_data):
        """Asegurar formato v??lido para base de usuarios."""
        return self.user_repository._normalize_users_data(users_data)

    def _decode_cloud_users_payload(self, cloud_payload):
        """
        Decodificar payload de usuarios desde nube con integridad estricta.

        Returns:
            dict | None: users_data_normalizado
        """
        return self.user_repository._decode_cloud_users_payload(cloud_payload)

    def _load_users_disk_fallback(self):
        """Intentar recuperar usuarios desde copias locales."""
        return self.user_repository._load_users_disk_fallback()

    def _candidate_users_fallback_paths(self):
        """Construir lista de rutas posibles para recuperar users.json."""
        return self.user_repository._candidate_users_fallback_paths()

    @handle_errors("_save_users", reraise=True)
    def _save_users(self, users_data):
        """Guardar usuarios en almacenamiento"""
        return self.user_repository._save_users(users_data)

    def _normalize_logs_data(self, logs_data):
        """
        Asegurar formato v??lido para logs de auditor??a.
        """
        return self.audit_service._normalize_logs_data(logs_data)

    def _decode_cloud_logs_payload(self, cloud_payload):
        """
        Decodificar payload de logs de nube con estrategia best-effort.

        Returns:
            tuple(dict, bool): (logs_data_normalizado, recovered_with_fallback)
        """
        return self.audit_service._decode_cloud_logs_payload(cloud_payload)

    def _persist_logs_data(self, logs_data):
        """Persistir logs normalizados en almacenamiento local o nube."""
        return self.audit_service._persist_logs_data(logs_data)

    def _load_legacy_logs_data(self):
        """Leer logs desde almacenamiento legacy (archivo o blob), normalizando formato."""
        return self.audit_service._load_legacy_logs_data()

    def _log_entry_key(self, entry):
        return self.audit_service._log_entry_key(entry)

    def _merge_logs_preserving_order(self, existing_logs, additional_logs):
        return self.audit_service._merge_logs_preserving_order(existing_logs, additional_logs)

    def _append_legacy_log_entry(self, log_entry):
        """Agregar log con reintentos para reducir p??rdidas por escritura concurrente."""
        return self.audit_service._append_legacy_log_entry(log_entry)

    @returns_result_tuple("repair_access_logs")
    def repair_access_logs(self):
        """Reparar archivo de logs de auditor??a (solo aplica a modo legacy)."""
        return self.audit_service.repair_access_logs()

    @handle_errors("_log_access", reraise=False, log_errors=False)
    def _log_access(self, action, username, success, details=None):
        """Registrar acceso en auditor??a (API D1 o fallback legacy)."""
        return self.audit_service._log_access(action, username, success, details)

    @returns_result_tuple("authenticate")
    def authenticate(self, username, password):
        """
        Autenticar usuario con lockout protection.
        
        SECURITY IMPROVEMENTS:
        - SEC-005: Check account lockout status
        - Rate limiting via failed attempt tracking
        
        Args:
            username: Nombre de usuario
            password: Contraseña
            
        Returns:
            (success: bool, message: str)
        """
        self.logger.operation_start("authenticate", username=username)

        if self._should_try_web_auth():
            try:
                return self._authenticate_web(username, password)
            except AuthenticationError:
                self.logger.security_event(
                    "login_failed",
                    username,
                    False,
                    {"reason": "Invalid web credentials", "source": "web"},
                )
                self._log_access(
                    "login_failed",
                    username,
                    False,
                    {"reason": "Invalid web credentials", "source": "web"},
                )
                raise
            except (ConfigurationError, CloudStorageError) as web_error:
                if self.auth_mode == self.AUTH_MODE_AUTO:
                    self.logger.warning(
                        f"Web auth no disponible ({web_error}). Se usa fallback legacy.",
                        username=username,
                    )
                else:
                    raise
        
        # Verificar si la cuenta esta bloqueada
        if self.lockout_manager.is_locked_out(username):
            time_remaining = self.lockout_manager.get_lockout_time_remaining(username)
            minutes_remaining = int(time_remaining.total_seconds() / 60)
            
            self.logger.security_event(
                "login_blocked_lockout",
                username,
                False,
                {'reason': 'Account locked', 'minutes_remaining': minutes_remaining},
                severity='WARNING'
            )
            self._log_access(
                "login_blocked_lockout",
                username,
                False,
                {'reason': 'Account locked', 'minutes_remaining': minutes_remaining}
            )
            
            raise AuthenticationError(
                f"Cuenta bloqueada por múltiples intentos fallidos.\n"
                f"Intenta nuevamente en {minutes_remaining} minutos.",
                details={'username': username, 'lockout_time_remaining': minutes_remaining}
            )
        
        # Cargar datos de usuarios
        users_data = self._load_users()
        if not users_data or not users_data.get("users"):
            self.logger.security_event("login_failed", username, False, {'reason': 'No users database'})
            self._log_access("login_failed", username, False, {'reason': 'No users database'})
            raise ConfigurationError("No hay base de datos de usuarios.")
        
        # Verificar que el usuario existe
        if username not in users_data["users"]:
            # Registrar intento fallido tambien para usuarios inexistentes
            self.lockout_manager.record_failed_attempt(username)
            
            self.logger.security_event("login_failed", username, False, {'reason': 'User not found'})
            self._log_access("login_failed", username, False, {'reason': 'User not found'})
            raise AuthenticationError("Usuario o contraseña incorrectos.", details={'username': username})
        
        user = users_data["users"][username]
        
        # Verificar que el usuario está activo
        if not user.get("active", True):
            self.logger.security_event("login_failed", username, False, {'reason': 'User inactive'})
            self._log_access("login_failed", username, False, {'reason': 'User inactive'})
            raise AuthenticationError("Usuario inactivo.", details={'username': username})
        
        # Verificar contraseña
        if not self._verify_password(password, user["password_hash"]):
            # Registrar intento fallido
            system_info = self._get_system_info()
            self.lockout_manager.record_failed_attempt(username, system_info.get('ip'))
            
            failed_count = self.lockout_manager.get_failed_attempts_count(username)
            attempts_remaining = AccountLockoutManager.MAX_FAILED_ATTEMPTS - failed_count
            
            self.logger.security_event(
                "login_failed",
                username,
                False,
                {
                    'reason': 'Wrong password',
                    'failed_attempts': failed_count,
                    'attempts_remaining': attempts_remaining
                }
            )
            self._log_access(
                "login_failed",
                username,
                False,
                {
                    'reason': 'Wrong password',
                    'failed_attempts': failed_count,
                    'attempts_remaining': attempts_remaining
                }
            )
            
            if attempts_remaining > 0:
                message = (
                    f"Usuario o contraseña incorrectos.\n"
                    f"Intentos restantes: {attempts_remaining}"
                )
            else:
                message = "Usuario o contraseña incorrectos."
            
            raise AuthenticationError(message, details={'username': username})
        
        # En login exitoso, resetear contador de intentos
        self.lockout_manager.record_successful_login(username)
        
        # Actualizar último login
        user["last_login"] = datetime.now().isoformat()
        users_data["users"][username] = user
        self._save_users(users_data)
        
        self.current_user = user
        self.logger.security_event("login_success", username, True, {'role': user.get('role')})
        self._log_access("login_success", username, True, {'role': user.get('role')})
        self.logger.operation_end("authenticate", success=True)
        return True, "Login exitoso."
    
    @returns_result_tuple("create_user")
    def create_user(self, username, password, role="admin", created_by=None, **kwargs):
        return self.user_management_service.create_user(
            username,
            password,
            role=role,
            created_by=created_by,
            **kwargs,
        )

    @returns_result_tuple("create_tenant_web_user")
    def create_tenant_web_user(self, username, password, role, tenant_id, admin_web_password):
        return self.user_tenant_web_service.create_tenant_web_user(
            username,
            password,
            role,
            tenant_id,
            admin_web_password,
        )

    @handle_errors("fetch_tenant_web_users", reraise=True, default_return=[])
    def fetch_tenant_web_users(self, admin_web_password, tenant_id=None):
        """Listar usuarios web de D1 (opcionalmente filtrados por tenant_id)."""
        return self.user_tenant_web_service.fetch_tenant_web_users(
            admin_web_password,
            tenant_id=tenant_id,
        )

    @returns_result_tuple("change_password")
    def change_password(self, username, old_password, new_password):
        return self.user_management_service.change_password(username, old_password, new_password)

    @handle_errors("get_users", reraise=True, default_return=[])
    def get_users(self):
        """Obtener lista de usuarios"""
        self.logger.operation_start("get_users")
        if not self.current_user:
            self.logger.warning("Attempt to get users without authentication")
            raise AuthenticationError("No autenticado.")
        
        users_data = self._load_users()
        if not users_data or not isinstance(users_data.get("users"), dict):
            self.logger.operation_end("get_users", success=True, count=0)
            return []
        users_list = []
        
        for username, user in users_data["users"].items():
            users_list.append({
                "username": username,
                "role": user.get("role", "admin"),
                "source": "local",
                "tenant_id": user.get("tenant_id"),
                "created_at": user.get("created_at"),
                "last_login": user.get("last_login"),
                "active": user.get("active", True),
                "created_by": user.get("created_by"),
                "email": user.get("email"),
                "full_name": user.get("full_name"),
                "password_strength": user.get("password_strength_score", 0)
            })
        self.logger.operation_end("get_users", success=True)
        return users_list
    
    @returns_result_tuple("deactivate_user")
    def deactivate_user(self, username):
        return self.user_management_service.deactivate_user(username)

    def unlock_user_account(self, username):
        """
        Desbloquear cuenta manualmente (solo super_admin).
        
        SECURITY FEATURE (SEC-005): Manual account unlock capability.
        
        Args:
            username: Usuario a desbloquear
            
        Returns:
            tuple: (success, message)
        """
        if not self.current_user or self.current_user.get("role") != "super_admin":
            raise AuthenticationError("Solo super_admin puede desbloquear cuentas.")
        
        self.lockout_manager.unlock_account(username)
        
        self._log_access(
            "account_unlocked",
            self.current_user.get("username"),
            True,
            {'target_user': username}
        )
        
        return True, f"Cuenta de {username} desbloqueada exitosamente."
    
    @handle_errors("get_access_logs", reraise=True, default_return=[])
    def get_access_logs(self, limit=100):
        """Obtener logs de acceso"""
        return self.audit_service.get_access_logs(limit=limit)

    def logout(self):
        """Cerrar sesión"""
        self._logout_web_session_best_effort()
        if self.current_user:
            self._log_access("logout", self.current_user.get("username"), True)
            self.current_user = None
        self.current_web_token = None
        self.current_web_token_type = "Bearer"
    
    def has_permission(self, permission):
        """Verificar permiso"""
        if not self.current_user:
            return False
        
        permissions = self.current_user.get("permissions", [])
        return "all" in permissions or permission in permissions
    
    def is_super_admin(self):
        """Verificar si es super admin"""
        return (self.current_user and 
                self.current_user.get("role") == "super_admin")
    
    # Metodos de compatibilidad legacy
    def has_users(self):
        """Verificar si existen usuarios"""
        if self._should_try_web_auth():
            return True
        users_data = self._load_users()
        return users_data and len(users_data.get('users', {})) > 0
    
    def needs_initialization(self):
        """Verificar si el sistema necesita inicialización"""
        if self._should_try_web_auth():
            return False
        return not self.has_users()
