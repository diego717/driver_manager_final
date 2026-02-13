"""
Sistema Mejorado de Gestión de Usuarios Multi-Admin
Incluye migración automática del sistema legacy
"""

import json
import hashlib
import secrets
import bcrypt
import re
from datetime import datetime
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


class UserManagerV2:
    """
    Gestor de usuarios mejorado con:
    - Migración automática desde auth_manager legacy
    - Validación robusta de datos
    - Manejo de errores mejorado
    - Auditoría completa
    """
    
    logger = get_logger()
    
    def __init__(self, cloud_manager=None, security_manager=None, local_mode=False):
        """
        Args:
            cloud_manager: Gestor de nube (opcional, para modo en nube)
            security_manager: Gestor de seguridad para cifrado
            local_mode: Si True, usa almacenamiento local en lugar de R2
        """
        self.cloud_manager = cloud_manager
        self.security_manager = security_manager
        self.local_mode = local_mode or (cloud_manager is None)
        self.current_user = None
        
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
        Inicializar sistema con primer usuario super_admin
        
        Se asume que este método solo se llama cuando el sistema no tiene usuarios.
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
            
            # Crear primer usuario
            first_user = {
                "username": first_user_username,
                "password_hash": self._hash_password(first_user_password),
                "role": "super_admin",
                "created_at": datetime.now().isoformat(),
                "created_by": "system",
                "last_login": None,
                "active": True,
                "permissions": ["all"],
                "email": None,
                "full_name": None
            }
            
            users_data = {
                "users": {
                    first_user_username: first_user
                },
                "created_at": datetime.now().isoformat(),
                "version": "2.0",
                "migrated_from_legacy": False
            }
            
            # Guardar
            self._save_users(users_data)
            
            # Log de creación
            self.logger.security_event(
                event_type="system_initialized",
                username=first_user_username,
                success=True,
                details={'message': f"First user created: {first_user_username}"}
            )
            
            self.logger.operation_end("initialize_system", success=True)
            return True, "Sistema inicializado correctamente."
        except Exception as e:
            return False, f"Error inicializando sistema: {str(e)}"
    
    def migrate_from_legacy(self, old_password):
        """
        Migrar desde sistema legacy (auth_manager.py)
        
        Args:
            old_password: Contraseña del sistema legacy
            
        Returns:
            (success: bool, message: str)
        """
        self.logger.operation_start("migrate_from_legacy")
        try:
            # Importar auth_manager legacy
            from auth_manager import AuthManager
            auth_manager = AuthManager() # auth_manager.py no está en el contexto, se asume que existe.
            
            # Verificar contraseña legacy
            if not auth_manager.verify_password(old_password):
                return False, "Contraseña del sistema legacy incorrecta"
            
            # Verificar que no existan usuarios nuevos
            users_data = self._load_users()
            if users_data and len(users_data.get('users', {})) > 0:
                return False, "El sistema nuevo ya tiene usuarios"
            
            # Crear usuario admin con la misma contraseña
            success, message = self.initialize_system("admin", old_password)
            
            if success:
                # Marcar como migrado
                users_data = self._load_users()
                users_data['migrated_from_legacy'] = True
                users_data['migrated_at'] = datetime.now().isoformat()
                self._save_users(users_data)
                
                # Log de migración
                self.logger.security_event(
                    event_type="legacy_migration",
                    username="admin",
                    success=True,
                    details={'message': "Migrated from auth_manager legacy system"}
                )
                self.logger.operation_end("migrate_from_legacy", success=True)
                return True, "Migración completada. Usuario 'admin' creado con tu contraseña actual."
            
            self.logger.operation_end("migrate_from_legacy", success=False, reason=message)
            raise ConfigurationError(message)
            
        except ImportError:
            self.logger.error("Sistema legacy (auth_manager.py) no encontrado para migración.", exc_info=True)
            self.logger.operation_end("migrate_from_legacy", success=False, reason="Sistema legacy no encontrado")
            raise ConfigurationError("Sistema legacy no encontrado.")
        except Exception as e:
            self.logger.error(f"Error durante migración: {e}", exc_info=True)
            self.logger.operation_end("migrate_from_legacy", success=False, reason=str(e))
            raise MigrationError(f"Error durante migración: {str(e)}", original_error=e)
    
    @handle_errors("has_users", reraise=True, default_return=False)
    def has_users(self):
        """Verificar si existen usuarios en el sistema"""
        users_data = self._load_users()
        return users_data and len(users_data.get('users', {})) > 0
    
    def needs_initialization(self):
        """Verificar si el sistema necesita inicialización"""
        return not self.has_users()
    
    def can_migrate_from_legacy(self):
        """Verificar si existe sistema legacy para migrar"""
        self.logger.operation_start("can_migrate_from_legacy")
        legacy_file = self.config_dir / "auth.json" # auth.json no está en el contexto, se asume que existe.
        result = legacy_file.exists() and not self.has_users()
        self.logger.operation_end("can_migrate_from_legacy", success=True, result=result)
        return result
    
    def _hash_password(self, password, salt=None):
        """Hash seguro de contraseña con salt usando bcrypt"""
        # Usar bcrypt directamente (más seguro que el método anterior)
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
        try: # No se usa handle_errors aquí para evitar recursión si el logger falla al cargar usuarios.
            if self.local_mode:
                # Modo local: leer de archivo JSON
                if not self.users_file.exists():
                    return None
                
                with open(self.users_file, 'r') as f:
                    data = json.load(f)
                
                return data
            else:
                # Modo nube: leer de R2
                content = self.cloud_manager.download_file_content(self.users_file)
                if not content:
                    self.logger.warning("No content found for users file in cloud.", file=self.users_file)
                    return None
                data = json.loads(content)
                
                # Descifrar si está disponible
                if self.cloud_encryption:
                    data = self.cloud_encryption.decrypt_cloud_data(data)
                
            self.logger.operation_end("_load_users", success=True)
            return data
        except Exception as e:
            self.logger.error(f"Error cargando usuarios: {e}", exc_info=True)
            self.logger.operation_end("_load_users", success=False, reason=str(e))
            raise CloudStorageError(f"Error cargando usuarios desde la nube: {str(e)}", original_error=e)
    
    @handle_errors("_save_users", reraise=True)
    def _save_users(self, users_data):
        """Guardar usuarios en almacenamiento"""
        self.logger.operation_start("_save_users")
        try: # No se usa handle_errors aquí para evitar recursión si el logger falla al guardar usuarios.
            if self.local_mode:
                # Modo local: guardar en archivo JSON
                with open(self.users_file, 'w') as f:
                    json.dump(users_data, f, indent=2)
            else:
                # Modo nube: cifrar y subir a R2
                if self.cloud_encryption:
                    encrypted_data = self.cloud_encryption.encrypt_cloud_data(users_data)
                    content = json.dumps(encrypted_data, indent=2)
                else:
                    content = json.dumps(users_data, indent=2)
                
                self.cloud_manager.upload_file_content(self.users_file, content)
            self.logger.operation_end("_save_users", success=True)
        except Exception as e:
            self.logger.error(f"Error guardando usuarios: {e}", exc_info=True)
            self.logger.operation_end("_save_users", success=False, reason=str(e))
            raise CloudStorageError(f"Error guardando usuarios: {str(e)}", original_error=e)
    
    @handle_errors("_log_access", reraise=False, log_errors=False) # No reraise ni loguear errores para evitar bucles infinitos
    def _log_access(self, action, username, success, details=None):
        """Registrar acceso en log de auditoría"""
        try:
            # Cargar logs existentes
            try:
                if self.local_mode:
                    if self.logs_file.exists():
                        with open(self.logs_file, 'r') as f:
                            logs_data = json.load(f)
                    else:
                        logs_data = {"logs": [], "created_at": datetime.now().isoformat()}
                else:
                    logs_content = self.cloud_manager.download_file_content(self.logs_file)
                    logs_data = json.loads(logs_content)
                    
                    if self.cloud_encryption:
                        logs_data = self.cloud_encryption.decrypt_cloud_data(logs_data)
            except:
                logs_data = {"logs": [], "created_at": datetime.now().isoformat()}
            
            # Agregar nuevo log
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
            
            # Guardar
            if self.local_mode:
                with open(self.logs_file, 'w') as f:
                    json.dump(logs_data, f, indent=2)
            else:
                if self.cloud_encryption:
                    encrypted_logs = self.cloud_encryption.encrypt_cloud_data(logs_data)
                    logs_content = json.dumps(encrypted_logs, indent=2)
                else:
                    logs_content = json.dumps(logs_data, indent=2)
                
                self.cloud_manager.upload_file_content(self.logs_file, logs_content)
            
            self.logger.operation_end("_log_access", success=True)
        except Exception as e:
            # Si el logger falla, al menos intentamos imprimir
            self.logger.error(f"Fallo crítico al registrar acceso: {e}", exc_info=True)
            self.logger.operation_end("_log_access", success=False, reason=str(e))
    
    # Métodos públicos (mantienen compatibilidad con código existente)
    
    @returns_result_tuple("authenticate")
    def authenticate(self, username, password):
        """Autenticar usuario - compatible con versión anterior"""
        self.logger.operation_start("authenticate", username=username)
        
        users_data = self._load_users()
        if not users_data or not users_data.get("users"):
            self.logger.security_event("login_failed", username, False, {'reason': 'No users database'})
            self._log_access("login_failed", username, False, {'reason': 'No users database'})
            raise ConfigurationError("No hay base de datos de usuarios.")
        
        if username not in users_data["users"]:
            self.logger.security_event("login_failed", username, False, {'reason': 'User not found'})
            self._log_access("login_failed", username, False, {'reason': 'User not found'})
            raise AuthenticationError("Usuario no encontrado.", details={'username': username})
        
        user = users_data["users"][username]
        
        if not user.get("active", True):
            self.logger.security_event("login_failed", username, False, {'reason': 'User inactive'})
            self._log_access("login_failed", username, False, {'reason': 'User inactive'})
            raise AuthenticationError("Usuario inactivo.", details={'username': username})
        
        if not self._verify_password(password, user["password_hash"]):
            self.logger.security_event("login_failed", username, False, {'reason': 'Wrong password'})
            self._log_access("login_failed", username, False, {'reason': 'Wrong password'})
            raise AuthenticationError("Contraseña incorrecta.", details={'username': username})
        
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
        """Crear nuevo usuario - compatible con versión anterior"""
        self.logger.operation_start("create_user", username=username, role=role)
        
        if not self.current_user or self.current_user.get("role") != "super_admin":
            self.logger.security_event("user_creation_failed", self.current_user.get("username", "N/A"), False, {'reason': 'Insufficient permissions'})
            raise AuthenticationError("Solo super_admin puede crear usuarios.")
        
        # Validar username
        validate_min_length(username, 3, "username")
        if not re.match(r'^[a-zA-Z0-9_-]+$', username): # re importado arriba
            raise ValidationError("Nombre de usuario inválido (solo letras, números, guiones y guiones bajos).", details={'username': username})
        
        # Validar password
        validate_min_length(password, 8, "password")
        
        users_data = self._load_users()
        try:
            if not users_data:
                users_data = {"users": {}, "created_at": datetime.now().isoformat(), "version": "2.0"}

            if username in users_data["users"]:
                self.logger.warning("Intento de crear usuario duplicado.", username=username)
                raise ValidationError("El usuario ya existe.", details={'username': username})

            # Asignar permisos según rol
            if role == "super_admin":
                permissions = ["all"]
            elif role == "admin":
                permissions = ["read", "write"]
            else: # viewer y otros
                permissions = ["read"]

            new_user = {
                "username": username,
                "password_hash": self._hash_password(password),
                "role": role,
                "created_at": datetime.now().isoformat(),
                "created_by": created_by or self.current_user.get("username"),
                "last_login": None,
                "active": True,
                "permissions": permissions,
                "email": kwargs.get("email"),
                "full_name": kwargs.get("full_name")
            }

            users_data["users"][username] = new_user
            self._save_users(users_data)

            self.logger.security_event("user_created", self.current_user.get("username"),
                                       True, {'new_user': username, 'role': role})
            self._log_access("user_created", self.current_user.get("username"),
                                       True, {'new_user': username, 'role': role})
            self.logger.operation_end("create_user", success=True)
            return True, "Usuario creado exitosamente."

        except (AuthenticationError, ValidationError, ConfigurationError, CloudStorageError) as e:
            self.logger.error(f"Error creando usuario: {e.message}", exc_info=False, username=username, role=role, details=e.details)
            self.logger.operation_end("create_user", success=False, reason=e.message)
            raise # Re-lanzar para que returns_result_tuple lo capture
        except Exception as e:
            self.logger.error(f"Error inesperado creando usuario: {e}", exc_info=True, username=username, role=role)
            self.logger.operation_end("create_user", success=False, reason=str(e))
            raise # Re-lanzar para que returns_result_tuple lo capture
    
    @returns_result_tuple("change_password")
    def change_password(self, username, old_password, new_password):
        """Cambiar contraseña - compatible con versión anterior"""
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
        
        # Validar nueva contraseña
        validate_min_length(new_password, 8, "new_password")
        
        # Cambiar contraseña
        user["password_hash"] = self._hash_password(new_password)
        user["password_changed_at"] = datetime.now().isoformat()
        users_data["users"][username] = user
        self._save_users(users_data)
        
        self.logger.security_event("password_changed", username, True)
        self._log_access("password_changed", username, True)
        self.logger.operation_end("change_password", success=True)
        return True, "Contraseña cambiada exitosamente."
            
    @handle_errors("get_users", reraise=True, default_return=[])
    def get_users(self):
        """Obtener lista de usuarios - compatible con versión anterior"""
        self.logger.operation_start("get_users")
        if not self.current_user:
            self.logger.warning("Intento de obtener usuarios sin autenticación.")
            raise AuthenticationError("No autenticado para obtener la lista de usuarios.")
        
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
                "full_name": user.get("full_name")
            })
        self.logger.operation_end("get_users", success=True)
        return users_list
    
    @returns_result_tuple("deactivate_user")
    def deactivate_user(self, username):
        """Desactivar usuario - compatible con versión anterior"""
        self.logger.operation_start("deactivate_user", target_username=username)
        
        if not self.current_user or self.current_user.get("role") != "super_admin":
            self.logger.security_event("user_deactivation_failed", self.current_user.get("username", "N/A"), False, {'reason': 'Insufficient permissions'})
            raise AuthenticationError("Solo super_admin puede desactivar usuarios.")
        
        if username == "admin":
            self.logger.warning("Intento de desactivar el usuario admin principal.", target_username=username)
            raise ValidationError("No se puede desactivar el usuario admin principal.")
        
        users_data = self._load_users()
        
        if not users_data or username not in users_data["users"]:
            self.logger.security_event("user_deactivation_failed", self.current_user.get("username", "N/A"), False, {'reason': 'User not found', 'target_username': username})
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
            
    @handle_errors("get_access_logs", reraise=True, default_return=[])
    def get_access_logs(self, limit=100):
        """Obtener logs de acceso - compatible con versión anterior"""
        self.logger.operation_start("get_access_logs")
        if not self.current_user:
            self.logger.warning("Intento de obtener logs sin autenticación.")
            raise AuthenticationError("No autenticado para obtener logs de acceso.")
        
        try: # Este try-except es para el manejo de la lectura del archivo/cloud
            if self.local_mode:
                if not self.logs_file.exists():
                    return []
                
                with open(self.logs_file, 'r') as f:
                    logs_data = json.load(f)
            else:
                logs_content = self.cloud_manager.download_file_content(self.logs_file)
                logs_data = json.loads(logs_content)
                
                if self.cloud_encryption:
                    logs_data = self.cloud_encryption.decrypt_cloud_data(logs_data)
            
            self.logger.operation_end("get_access_logs", success=True)
            return logs_data["logs"][-limit:] if len(logs_data["logs"]) > limit else logs_data["logs"]
            
        except Exception as e:
            self.logger.error(f"Error obteniendo logs de acceso: {e}", exc_info=True)
            raise CloudStorageError(f"Error obteniendo logs de acceso: {str(e)}", original_error=e)
    
    def logout(self):
        """Cerrar sesión - compatible con versión anterior"""
        if self.current_user:
            self._log_access("logout", self.current_user.get("username"), True)
            self.current_user = None
    
    def has_permission(self, permission):
        """Verificar permiso - compatible con versión anterior"""
        if not self.current_user:
            return False
        
        permissions = self.current_user.get("permissions", [])
        return "all" in permissions or permission in permissions
    
    def is_super_admin(self):
        """Verificar si es super admin - compatible con versión anterior"""
        return (self.current_user and 
                self.current_user.get("role") == "super_admin")
