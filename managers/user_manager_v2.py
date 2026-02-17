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
from datetime import datetime, timedelta
from pathlib import Path
import socket
import platform

from core.logger import get_logger
from core.exceptions import (
    handle_errors,
    returns_result_tuple,
    AuthenticationError,
    ValidationError,
    ConfigurationError,
    CloudStorageError,
    validate_min_length
)


class PasswordValidator:
    """
    Validador de contraseñas con políticas de seguridad robustas.
    
    SECURITY IMPROVEMENT (SEC-004): Comprehensive password validation.
    """
    
    # Configuración de política de contraseñas
    MIN_LENGTH = 12
    REQUIRE_UPPERCASE = True
    REQUIRE_LOWERCASE = True
    REQUIRE_DIGIT = True
    REQUIRE_SPECIAL = True
    SPECIAL_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?"
    
    # Password history
    PASSWORD_HISTORY_SIZE = 5
    
    @classmethod
    def validate_password_strength(cls, password, username=None):
        """
        Validar fortaleza de contraseña según política.
        
        Args:
            password: Contraseña a validar
            username: Username (para verificar que no esté contenido)
            
        Returns:
            tuple: (is_valid: bool, message: str, score: int)
        """
        errors = []
        score = 0
        
        # 1. Longitud mínima
        if len(password) < cls.MIN_LENGTH:
            errors.append(f"Debe tener al menos {cls.MIN_LENGTH} caracteres")
        else:
            score += 20
            
            # Bonus por longitud adicional
            if len(password) >= 16:
                score += 10
            if len(password) >= 20:
                score += 10
        
        # 2. Mayúsculas
        if cls.REQUIRE_UPPERCASE:
            if not re.search(r'[A-Z]', password):
                errors.append("Debe contener al menos una letra mayúscula")
            else:
                score += 15
        
        # 3. Minúsculas
        if cls.REQUIRE_LOWERCASE:
            if not re.search(r'[a-z]', password):
                errors.append("Debe contener al menos una letra minúscula")
            else:
                score += 15
        
        # 4. Dígitos
        if cls.REQUIRE_DIGIT:
            if not re.search(r'\d', password):
                errors.append("Debe contener al menos un número")
            else:
                score += 15
        
        # 5. Caracteres especiales
        if cls.REQUIRE_SPECIAL:
            if not re.search(f'[{re.escape(cls.SPECIAL_CHARS)}]', password):
                errors.append(f"Debe contener al menos un carácter especial ({cls.SPECIAL_CHARS[:10]}...)")
            else:
                score += 15
        
        # 6. No debe contener el username
        if username and username.lower() in password.lower():
            errors.append("No debe contener el nombre de usuario")
            score -= 20
        
        # 7. Verificar patrones comunes débiles
        weak_patterns = [
            (r'(.)\1{2,}', "No debe tener caracteres repetidos consecutivos (AAA, 111)"),
            (r'(012|123|234|345|456|567|678|789|890)', "No debe contener secuencias numéricas simples"),
            (r'(abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)', 
             "No debe contener secuencias alfabéticas simples"),
            (r'(password|contraseña|admin|user|login|welcome|qwerty|asdfgh)', 
             "No debe contener palabras comunes")
        ]
        
        for pattern, message in weak_patterns:
            if re.search(pattern, password.lower()):
                errors.append(message)
                score -= 15
        
        # 8. Diversidad de caracteres
        unique_chars = len(set(password))
        if unique_chars < len(password) * 0.6:  # Menos del 60% de chars únicos
            errors.append("La contraseña debe tener mayor diversidad de caracteres")
            score -= 10
        else:
            score += 10
        
        # Calcular score final (0-100)
        final_score = max(0, min(100, score))
        
        # Determinar si es válida
        is_valid = len(errors) == 0 and final_score >= 50
        
        if errors:
            message = "Contraseña no cumple con los requisitos:\n• " + "\n• ".join(errors)
        else:
            strength = "Débil" if final_score < 60 else "Media" if final_score < 80 else "Fuerte"
            message = f"Contraseña válida. Fortaleza: {strength} ({final_score}/100)"
        
        return is_valid, message, final_score
    
    @classmethod
    def check_password_history(cls, new_password, password_history):
        """
        Verificar que la contraseña no esté en el historial.
        
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
            except:
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
            ip_address: IP desde donde se intentó (opcional)
            
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
        
        # Si alcanzó el máximo, bloquear cuenta
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
        
        # Verificar si el bloqueo ya expiró
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
            int: Número de intentos fallidos
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
    
    def __init__(self, cloud_manager=None, security_manager=None, local_mode=False):
        """
        Args:
            cloud_manager: Gestor de nube (opcional)
            security_manager: Gestor de seguridad para cifrado
            local_mode: Si True, usa almacenamiento local
        """
        self.cloud_manager = cloud_manager
        self.security_manager = security_manager
        self.local_mode = local_mode or (cloud_manager is None)
        self.current_user = None
        
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
            
            # SECURITY FIX (SEC-004): Validar contraseña del primer usuario
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
            
            # Log de creación
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
        except:
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
        except:
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
        except:
            return {
                'computer_name': 'Unknown',
                'username': 'Unknown',
                'platform': 'Unknown',
                'ip': 'Unknown'
            }
    
    def _load_users(self):
        """Cargar usuarios desde almacenamiento"""
        self.logger.operation_start("_load_users")
        try:
            if self.local_mode:
                if not self.users_file.exists():
                    return None
                
                with open(self.users_file, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f)
                
                return self._normalize_users_data(data)
            else:
                content = self.cloud_manager.download_file_content(self.users_file)
                if not content:
                    self.logger.warning("No content found for users file in cloud.", file=self.users_file)
                    fallback_users = self._load_users_disk_fallback()
                    if fallback_users:
                        self.logger.warning("Usando copia local de usuarios por ausencia de archivo en nube.")
                        return fallback_users
                    return None

                if isinstance(content, bytes):
                    content = content.decode('utf-8-sig')
                elif isinstance(content, str):
                    content = content.lstrip('\ufeff')
                cloud_payload = json.loads(content)
                data, recovered = self._decode_cloud_users_payload(cloud_payload)

                if recovered and data:
                    self.logger.warning(
                        "Se recuperaron usuarios con estrategia best-effort; normalizando y resincronizando."
                    )
                    try:
                        self._save_users(data)
                    except Exception as sync_error:
                        self.logger.warning(
                            f"No se pudo resincronizar usuarios recuperados a la nube: {sync_error}"
                        )

                if not data or not data.get("users"):
                    fallback_users = self._load_users_disk_fallback()
                    if fallback_users and fallback_users.get("users"):
                        self.logger.warning(
                            "Recuperando base de usuarios desde copia local y subiendo a la nube."
                        )
                        try:
                            self._save_users(fallback_users)
                        except Exception as sync_error:
                            self.logger.warning(
                                f"No se pudo subir copia local de usuarios a la nube: {sync_error}"
                            )
                        data = fallback_users
            
            self.logger.operation_end("_load_users", success=True)
            return data
        except Exception as e:
            self.logger.error(f"Error loading users: {e}", exc_info=True)
            self.logger.operation_end("_load_users", success=False, reason=str(e))
            raise CloudStorageError(f"Error loading users: {str(e)}", original_error=e)

    def _normalize_users_data(self, users_data):
        """Asegurar formato válido para base de usuarios."""
        if not isinstance(users_data, dict):
            return {"users": {}, "created_at": datetime.now().isoformat(), "version": "2.1"}

        normalized = dict(users_data)
        users = normalized.get("users")

        # Compatibilidad con estructuras legacy basadas en listas.
        if isinstance(users, list):
            rebuilt_users = {}
            for entry in users:
                if isinstance(entry, dict):
                    username = entry.get("username")
                    if username:
                        rebuilt_users[username] = entry
            users = rebuilt_users

        if not isinstance(users, dict):
            users = {}

        normalized["users"] = users
        normalized.setdefault("created_at", datetime.now().isoformat())
        normalized.setdefault("version", "2.1")
        return normalized

    def _decode_cloud_users_payload(self, cloud_payload):
        """
        Decodificar payload de usuarios desde nube con estrategia best-effort.

        Returns:
            tuple(dict | None, bool): (users_data_normalizado, recovered_with_fallback)
        """
        if not isinstance(cloud_payload, dict):
            return None, False

        fallback_recovered = False
        payload_copy = dict(cloud_payload)

        if self.cloud_encryption:
            decrypted = self.cloud_encryption.decrypt_cloud_data(dict(payload_copy))
            if isinstance(decrypted, dict) and isinstance(decrypted.get("users"), dict):
                return self._normalize_users_data(decrypted), fallback_recovered

        # Fallback para payload legacy o con HMAC inválido.
        fallback_recovered = True

        if isinstance(payload_copy.get("users"), dict):
            self.logger.warning(
                "Recuperando usuarios desde payload legacy sin validación HMAC completa."
            )
            payload_copy.pop("_hmac", None)
            payload_copy.pop("_encrypted", None)
            return self._normalize_users_data(payload_copy), fallback_recovered

        if (
            self.security_manager
            and self.security_manager.fernet
            and isinstance(payload_copy.get("users"), str)
        ):
            try:
                decrypted_users = self.security_manager.decrypt_data(payload_copy["users"])
                if isinstance(decrypted_users, dict):
                    recovered_payload = dict(payload_copy)
                    recovered_payload["users"] = decrypted_users
                    recovered_payload.pop("_hmac", None)
                    recovered_payload.pop("_encrypted", None)
                    self.logger.warning(
                        "Recuperación best-effort aplicada para usuarios con HMAC inválido."
                    )
                    return self._normalize_users_data(recovered_payload), fallback_recovered
            except Exception:
                pass

        self.logger.warning("No fue posible recuperar payload de usuarios desde nube.")
        return None, fallback_recovered

    def _load_users_disk_fallback(self):
        """Intentar recuperar usuarios desde copias locales."""
        fallback_paths = self._candidate_users_fallback_paths()

        for path in fallback_paths:
            try:
                if not path.exists():
                    continue
                with open(path, 'r', encoding='utf-8-sig') as file:
                    data = json.load(file)
                normalized = self._normalize_users_data(data)
                if normalized.get("users"):
                    self.logger.warning(f"Copia local de usuarios encontrada en: {path}")
                    return normalized
            except Exception as error:
                self.logger.warning(f"No se pudo leer fallback de usuarios en {path}: {error}")

        self.logger.warning("No se encontraron copias locales de usuarios para recuperación.")
        return None

    def _candidate_users_fallback_paths(self):
        """Construir lista de rutas posibles para recuperar users.json."""
        candidates = []

        def add_candidate(path):
            if not path:
                return
            if path not in candidates:
                candidates.append(path)

        add_candidate(self.config_dir / "users.json")
        add_candidate(Path.home() / ".driver_manager" / "users.json")
        add_candidate(Path.home() / ".driver_manager_backup" / "users.json")

        try:
            if self.security_manager and hasattr(self.security_manager, "_get_config_dir"):
                config_dir = self.security_manager._get_config_dir()
                if config_dir:
                    add_candidate(Path(config_dir) / "users.json")
        except Exception:
            pass

        runtime_roots = [Path.cwd(), Path(__file__).resolve().parents[1]]
        if getattr(sys, "frozen", False):
            runtime_roots.append(Path(sys.executable).resolve().parent)

        for root in runtime_roots:
            add_candidate(root / "users.json")
            add_candidate(root / "config" / "users.json")
            add_candidate(root / "data" / "users.json")

        return candidates
    
    @handle_errors("_save_users", reraise=True)
    def _save_users(self, users_data):
        """Guardar usuarios en almacenamiento"""
        self.logger.operation_start("_save_users")
        try:
            if self.local_mode:
                with open(self.users_file, 'w') as f:
                    json.dump(users_data, f, indent=2)
            else:
                if self.cloud_encryption:
                    encrypted_data = self.cloud_encryption.encrypt_cloud_data(users_data)
                    content = json.dumps(encrypted_data, indent=2)
                else:
                    content = json.dumps(users_data, indent=2)
                
                self.cloud_manager.upload_file_content(self.users_file, content)
            self.logger.operation_end("_save_users", success=True)
        except Exception as e:
            self.logger.error(f"Error saving users: {e}", exc_info=True)
            self.logger.operation_end("_save_users", success=False, reason=str(e))
            raise CloudStorageError(f"Error saving users: {str(e)}", original_error=e)

    def _normalize_logs_data(self, logs_data):
        """
        Asegurar formato válido para logs de auditoría.
        """
        if not isinstance(logs_data, dict):
            self.logger.warning("Formato de logs inválido. Reinicializando estructura de logs.")
            return {"logs": [], "created_at": datetime.now().isoformat()}

        normalized = dict(logs_data)
        logs = normalized.get("logs")

        # Compatibilidad con estructuras legacy.
        if logs is None and isinstance(normalized.get("access_logs"), list):
            logs = normalized.get("access_logs")
            normalized["logs"] = logs

        if not isinstance(logs, list):
            self.logger.warning("Estructura de logs corrupta o incompatible. Se usará lista vacía.")
            normalized["logs"] = []

        if "created_at" not in normalized:
            normalized["created_at"] = datetime.now().isoformat()

        return normalized

    def _decode_cloud_logs_payload(self, cloud_payload):
        """
        Decodificar payload de logs de nube con estrategia best-effort.

        Returns:
            tuple(dict, bool): (logs_data_normalizado, recovered_with_fallback)
        """
        if not isinstance(cloud_payload, dict):
            return {"logs": [], "created_at": datetime.now().isoformat()}, False

        fallback_recovered = False
        payload_copy = dict(cloud_payload)

        if self.cloud_encryption:
            decrypted = self.cloud_encryption.decrypt_cloud_data(dict(payload_copy))
            if isinstance(decrypted, dict) and (
                isinstance(decrypted.get("logs"), list) or
                isinstance(decrypted.get("access_logs"), list)
            ):
                return self._normalize_logs_data(decrypted), fallback_recovered

        # Fallback específico para logs legacy/corruptos:
        # intentamos rescatar campos útiles aun con HMAC inválido.
        fallback_recovered = True

        if isinstance(payload_copy.get("logs"), list) or isinstance(payload_copy.get("access_logs"), list):
            self.logger.warning(
                "Recuperando logs desde payload legacy sin validación HMAC completa."
            )
            return self._normalize_logs_data(payload_copy), fallback_recovered

        encrypted_candidates = []
        if isinstance(payload_copy.get("access_logs"), str):
            encrypted_candidates.append(("access_logs", payload_copy.get("access_logs")))
        if isinstance(payload_copy.get("logs"), str):
            encrypted_candidates.append(("logs", payload_copy.get("logs")))

        if self.security_manager and self.security_manager.fernet:
            for field_name, encrypted_blob in encrypted_candidates:
                try:
                    decrypted_blob = self.security_manager.decrypt_data(encrypted_blob)
                    if isinstance(decrypted_blob, list):
                        self.logger.warning(
                            f"Recuperación best-effort aplicada para '{field_name}' con HMAC inválido."
                        )
                        return self._normalize_logs_data({
                            "logs": decrypted_blob,
                            "created_at": payload_copy.get("created_at", datetime.now().isoformat())
                        }), fallback_recovered
                    if isinstance(decrypted_blob, dict):
                        self.logger.warning(
                            f"Recuperación best-effort aplicada para '{field_name}' en formato dict."
                        )
                        return self._normalize_logs_data(decrypted_blob), fallback_recovered
                except Exception:
                    continue

        self.logger.warning("No fue posible recuperar contenido histórico de logs; se usará estructura vacía.")
        return self._normalize_logs_data({}), fallback_recovered

    def _persist_logs_data(self, logs_data):
        """Persistir logs normalizados en almacenamiento local o nube."""
        if self.local_mode:
            with open(self.logs_file, 'w') as f:
                json.dump(logs_data, f, indent=2)
            return

        if self.cloud_encryption:
            encrypted_logs = self.cloud_encryption.encrypt_cloud_data(logs_data)
            logs_content = json.dumps(encrypted_logs, indent=2)
        else:
            logs_content = json.dumps(logs_data, indent=2)

        self.cloud_manager.upload_file_content(self.logs_file, logs_content)

    @returns_result_tuple("repair_access_logs")
    def repair_access_logs(self):
        """
        Reparar archivo de logs de auditoría.

        Solo super_admin puede ejecutar esta operación.
        """
        self.logger.operation_start("repair_access_logs")

        if not self.current_user or self.current_user.get("role") != "super_admin":
            raise AuthenticationError("Solo super_admin puede reparar logs de auditoría.")

        logs_data = {"logs": [], "created_at": datetime.now().isoformat()}

        try:
            if self.local_mode:
                if self.logs_file.exists():
                    with open(self.logs_file, 'r') as f:
                        logs_data = json.load(f)
            else:
                logs_content = self.cloud_manager.download_file_content(self.logs_file)
                if logs_content:
                    cloud_payload = json.loads(logs_content)
                    logs_data, recovered = self._decode_cloud_logs_payload(cloud_payload)
                    if recovered:
                        self.logger.warning("Se detectó formato legacy/corrupto en logs; se persistirá versión reparada.")
                        self._persist_logs_data(logs_data)
        except Exception as e:
            self.logger.warning(f"No se pudo leer logs actuales para reparar: {e}. Se recreará archivo limpio.")

        logs_data = self._normalize_logs_data(logs_data)
        self._persist_logs_data(logs_data)

        total_logs = len(logs_data.get("logs", []))
        self.logger.operation_end("repair_access_logs", success=True, total_logs=total_logs)
        return True, f"Logs reparados correctamente. Registros disponibles: {total_logs}"
    
    @handle_errors("_log_access", reraise=False, log_errors=False)
    def _log_access(self, action, username, success, details=None):
        """Registrar acceso en log de auditoría"""
        try:
            try:
                if self.local_mode:
                    if self.logs_file.exists():
                        with open(self.logs_file, 'r') as f:
                            logs_data = json.load(f)
                    else:
                        logs_data = {"logs": [], "created_at": datetime.now().isoformat()}
                else:
                    logs_content = self.cloud_manager.download_file_content(self.logs_file)
                    if logs_content:
                        cloud_payload = json.loads(logs_content)
                        logs_data, recovered = self._decode_cloud_logs_payload(cloud_payload)
                        if recovered:
                            self.logger.warning("Se recuperaron logs históricos con fallback; normalizando archivo.")
                            self._persist_logs_data(logs_data)
                    else:
                        logs_data = {"logs": [], "created_at": datetime.now().isoformat()}
            except:
                logs_data = {"logs": [], "created_at": datetime.now().isoformat()}

            logs_data = self._normalize_logs_data(logs_data)
            
            system_info = self._get_system_info()
            log_entry = {
                "timestamp": datetime.now().isoformat(),
                "action": action,
                "username": username,
                "success": success,
                "details": details,
                "system_info": system_info
            }
            
            logs_data["logs"].append(log_entry)
            
            # Mantener solo últimos 1000 logs
            if len(logs_data["logs"]) > 1000:
                logs_data["logs"] = logs_data["logs"][-1000:]
            
            self._persist_logs_data(logs_data)
            
            self.logger.operation_end("_log_access", success=True)
        except Exception as e:
            self.logger.error(f"Critical failure logging access: {e}", exc_info=True)
            self.logger.operation_end("_log_access", success=False, reason=str(e))
    
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
        
        # SECURITY FIX (SEC-005): Check if account is locked out
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
            # SECURITY FIX (SEC-005): Record failed attempt even for non-existent users
            self.lockout_manager.record_failed_attempt(username)
            
            self.logger.security_event("login_failed", username, False, {'reason': 'User not found'})
            self._log_access("login_failed", username, False, {'reason': 'User not found'})
            raise AuthenticationError("Usuario o contraseña incorrectos.", details={'username': username})
        
        user = users_data["users"][username]
        
        # Verificar que el usuario esté activo
        if not user.get("active", True):
            self.logger.security_event("login_failed", username, False, {'reason': 'User inactive'})
            self._log_access("login_failed", username, False, {'reason': 'User inactive'})
            raise AuthenticationError("Usuario inactivo.", details={'username': username})
        
        # Verificar contraseña
        if not self._verify_password(password, user["password_hash"]):
            # SECURITY FIX (SEC-005): Record failed attempt
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
        
        # SECURITY FIX (SEC-005): Login exitoso, resetear contador
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
        """
        Crear nuevo usuario con validación de contraseña robusta.
        
        SECURITY FIX (SEC-004): Enforces strong password policy.
        
        Args:
            username: Nombre de usuario
            password: Contraseña
            role: Rol del usuario
            created_by: Usuario creador
            **kwargs: Parámetros adicionales
            
        Returns:
            (success: bool, message: str)
        """
        self.logger.operation_start("create_user", username=username, role=role)
        current_username = self.current_user.get("username", "N/A") if self.current_user else "N/A"
        
        if not self.current_user or self.current_user.get("role") != "super_admin":
            self.logger.security_event("user_creation_failed", current_username, False, {'reason': 'Insufficient permissions'})
            raise AuthenticationError("Solo super_admin puede crear usuarios.")
        
        # Validar username
        validate_min_length(username, 3, "username")
        if not re.match(r'^[a-zA-Z0-9_-]+$', username):
            raise ValidationError("Nombre de usuario inválido (solo letras, números, guiones y guiones bajos).", details={'username': username})
        
        # SECURITY FIX (SEC-004): Validar contraseña con política robusta
        is_valid, message, score = PasswordValidator.validate_password_strength(password, username)
        
        if not is_valid:
            raise ValidationError(
                f"La contraseña no cumple con los requisitos de seguridad:\n{message}",
                details={'username': username, 'password_score': score}
            )
        
        users_data = self._load_users()
        try:
            if not users_data:
                users_data = {"users": {}, "created_at": datetime.now().isoformat(), "version": "2.1"}
            
            if username in users_data["users"]:
                self.logger.warning("Attempt to create duplicate user", username=username)
                raise ValidationError("El usuario ya existe.", details={'username': username})
            
            # Asignar permisos según rol
            if role == "super_admin":
                permissions = ["all"]
            elif role == "admin":
                permissions = ["read", "write"]
            else:
                permissions = ["read"]
            
            new_user = {
                "username": username,
                "password_hash": self._hash_password(password),
                "password_history": [],
                "role": role,
                "created_at": datetime.now().isoformat(),
                "created_by": created_by or self.current_user.get("username"),
                "last_login": None,
                "last_password_change": datetime.now().isoformat(),
                "active": True,
                "permissions": permissions,
                "email": kwargs.get("email"),
                "full_name": kwargs.get("full_name"),
                "password_strength_score": score
            }
            
            users_data["users"][username] = new_user
            self._save_users(users_data)
            
            self.logger.security_event(
                "user_created",
                self.current_user.get("username"),
                True,
                {
                    'new_user': username,
                    'role': role,
                    'password_strength': score
                }
            )
            self._log_access(
                "user_created",
                self.current_user.get("username"),
                True,
                {
                    'new_user': username,
                    'role': role,
                    'password_strength': score
                }
            )
            self.logger.operation_end("create_user", success=True)
            return True, f"Usuario creado exitosamente.\nFortaleza de contraseña: {score}/100"
        
        except (AuthenticationError, ValidationError, ConfigurationError, CloudStorageError) as e:
            self.logger.error(f"Error creating user: {e.message}", exc_info=False, username=username, role=role, details=e.details)
            self.logger.operation_end("create_user", success=False, reason=e.message)
            raise
        except Exception as e:
            self.logger.error(f"Unexpected error creating user: {e}", exc_info=True, username=username, role=role)
            self.logger.operation_end("create_user", success=False, reason=str(e))
            raise
    
    @returns_result_tuple("change_password")
    def change_password(self, username, old_password, new_password):
        """
        Cambiar contraseña con validación y historial.
        
        SECURITY IMPROVEMENTS:
        - SEC-004: Enforces strong password policy
        - Checks password history to prevent reuse
        
        Args:
            username: Usuario
            old_password: Contraseña actual
            new_password: Nueva contraseña
            
        Returns:
            (success: bool, message: str)
        """
        self.logger.operation_start("change_password", username=username)
        
        users_data = self._load_users()
        
        if not users_data or username not in users_data["users"]:
            self.logger.security_event("password_change_failed", username, False, {'reason': 'User not found'})
            raise AuthenticationError("Usuario no encontrado.")
        
        user = users_data["users"][username]
        
        # Verificar contraseña actual
        if not self._verify_password(old_password, user["password_hash"]):
            self.logger.security_event("password_change_failed", username, False, {'reason': 'Wrong old password'})
            raise AuthenticationError("Contraseña actual incorrecta.")
        
        # SECURITY FIX (SEC-004): Validar nueva contraseña
        is_valid, message, score = PasswordValidator.validate_password_strength(new_password, username)
        
        if not is_valid:
            raise ValidationError(
                f"La nueva contraseña no cumple con los requisitos:\n{message}",
                details={'username': username, 'password_score': score}
            )
        
        # SECURITY IMPROVEMENT: Verificar historial de contraseñas
        password_history = user.get("password_history", [])
        if not PasswordValidator.check_password_history(new_password, password_history):
            raise ValidationError(
                f"No puedes reutilizar una de tus últimas {PasswordValidator.PASSWORD_HISTORY_SIZE} contraseñas.\n"
                "Por favor, elige una contraseña diferente.",
                details={'username': username}
            )
        
        # Actualizar contraseña
        new_hash = self._hash_password(new_password)
        
        # Agregar hash actual al historial
        if user["password_hash"] not in password_history:
            password_history.append(user["password_hash"])
        
        # Mantener solo las últimas N contraseñas
        if len(password_history) > PasswordValidator.PASSWORD_HISTORY_SIZE:
            password_history = password_history[-PasswordValidator.PASSWORD_HISTORY_SIZE:]
        
        user["password_hash"] = new_hash
        user["password_history"] = password_history
        user["password_changed_at"] = datetime.now().isoformat()
        user["last_password_change"] = datetime.now().isoformat()
        user["password_strength_score"] = score
        
        users_data["users"][username] = user
        self._save_users(users_data)
        
        self.logger.security_event(
            "password_changed",
            username,
            True,
            {'password_strength': score}
        )
        self._log_access(
            "password_changed",
            username,
            True,
            {'password_strength': score}
        )
        self.logger.operation_end("change_password", success=True)
        return True, f"Contraseña cambiada exitosamente.\nFortaleza: {score}/100"
    
    @handle_errors("get_users", reraise=True, default_return=[])
    def get_users(self):
        """Obtener lista de usuarios"""
        self.logger.operation_start("get_users")
        if not self.current_user:
            self.logger.warning("Attempt to get users without authentication")
            raise AuthenticationError("No autenticado.")
        
        users_data = self._load_users()
        users_list = []
        
        for username, user in users_data["users"].items():
            users_list.append({
                "username": username,
                "role": user.get("role", "admin"),
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
        """Desactivar usuario"""
        self.logger.operation_start("deactivate_user", target_username=username)
        current_username = self.current_user.get("username", "N/A") if self.current_user else "N/A"
        
        if not self.current_user or self.current_user.get("role") != "super_admin":
            self.logger.security_event("user_deactivation_failed", current_username, False, {'reason': 'Insufficient permissions'})
            raise AuthenticationError("Solo super_admin puede desactivar usuarios.")
        
        if username == "admin":
            self.logger.warning("Attempt to deactivate main admin user", target_username=username)
            raise ValidationError("No se puede desactivar el usuario admin principal.")
        
        users_data = self._load_users()
        
        if not users_data or username not in users_data["users"]:
            self.logger.security_event("user_deactivation_failed", current_username, False, {'reason': 'User not found', 'target_username': username})
            raise AuthenticationError("Usuario no encontrado.")
        
        users_data["users"][username]["active"] = False
        users_data["users"][username]["deactivated_at"] = datetime.now().isoformat()
        users_data["users"][username]["deactivated_by"] = self.current_user.get("username")
        self._save_users(users_data)
        
        self.logger.security_event("user_deactivated", self.current_user.get("username"),
                                   True, {'deactivated_user': username})
        self._log_access("user_deactivated", self.current_user.get("username"),
                                   True, {'deactivated_user': username})
        self.logger.operation_end("deactivate_user", success=True)
        return True, "Usuario desactivado."
    
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
        self.logger.operation_start("get_access_logs")
        if not self.current_user:
            self.logger.warning("Attempt to get logs without authentication")
            raise AuthenticationError("No autenticado.")
        
        try:
            if self.local_mode:
                if not self.logs_file.exists():
                    return []
                
                with open(self.logs_file, 'r') as f:
                    logs_data = json.load(f)
            else:
                logs_content = self.cloud_manager.download_file_content(self.logs_file)
                if not logs_content:
                    return []

                if isinstance(logs_content, bytes):
                    logs_content = logs_content.decode('utf-8-sig')
                elif isinstance(logs_content, str):
                    logs_content = logs_content.lstrip('\ufeff')
                cloud_payload = json.loads(logs_content)
                logs_data, recovered = self._decode_cloud_logs_payload(cloud_payload)
                if recovered:
                    self.logger.warning("Se detectó payload legacy/corrupto en get_access_logs; persistiendo reparación.")
                    self._persist_logs_data(logs_data)

            logs_data = self._normalize_logs_data(logs_data)
            logs = logs_data["logs"]
            
            self.logger.operation_end("get_access_logs", success=True)
            return logs[-limit:] if len(logs) > limit else logs
            
        except Exception as e:
            self.logger.error(f"Error getting access logs: {e}", exc_info=True)
            return []
    
    def logout(self):
        """Cerrar sesión"""
        if self.current_user:
            self._log_access("logout", self.current_user.get("username"), True)
            self.current_user = None
    
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
    
    # Métodos de compatibilidad legacy
    def has_users(self):
        """Verificar si existen usuarios"""
        users_data = self._load_users()
        return users_data and len(users_data.get('users', {})) > 0
    
    def needs_initialization(self):
        """Verificar si el sistema necesita inicialización"""
        return not self.has_users()
