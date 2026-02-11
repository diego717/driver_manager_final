"""
Módulo de Seguridad Avanzada para Driver Manager
Implementa cifrado AES-256, HMAC y protección de credenciales
"""

import os
import sys
import json
import hmac
import hashlib
import base64
from pathlib import Path
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from core.logger import get_logger
from core.exceptions import (
    handle_errors,
    SecurityError,
    ValidationError,
    PermissionError
)

logger = get_logger()


class SecurityManager:
    """Gestor de seguridad con cifrado AES-256 y HMAC"""
    
    def __init__(self):
        self.master_key = None
        self.fernet = None
    
    def _get_config_dir(self) -> Path:
        """Obtener directorio de configuración (Portable o Usuario)"""
        if getattr(sys, 'frozen', False):
            base_path = Path(sys.executable).parent
        else:
            base_path = Path(__file__).parent
            
        # 1. Verificar directorio 'config' (Usado por ConfigManager)
        if (base_path / "config").exists():
            return base_path / "config"
            
        # Priorizar modo portable si existe archivo de configuración portable
        if (base_path / "portable_config.json").exists():
            config_dir = base_path / "data"
            config_dir.mkdir(parents=True, exist_ok=True)
            return config_dir
            
        config_dir = Path.home() / ".driver_manager"
        config_dir.mkdir(parents=True, exist_ok=True)
        return config_dir

    def _derive_key(self, password: str, salt: bytes) -> bytes:
        """Derivar clave de cifrado desde contraseña"""
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        return base64.urlsafe_b64encode(kdf.derive(password.encode()))
    
    @handle_errors("initialize_master_key", reraise=False, default_return=False)
    def initialize_master_key(self, password: str) -> bool:
        """Inicializar clave maestra"""
        logger.operation_start("initialize_master_key")
        if not password:
            raise ValidationError("La contraseña no puede estar vacía.")

        config_dir = self._get_config_dir()
        salt_file = config_dir / ".security_salt"
        
        if salt_file.exists():
            with open(salt_file, 'rb') as f:
                salt = f.read()
        else:
            # MIGRACIÓN: Intentar recuperar salt del usuario si existe en la ubicación antigua
            user_salt = Path.home() / ".driver_manager" / ".security_salt"
            if user_salt.exists():
                try:
                    import shutil
                    shutil.copy2(user_salt, salt_file)
                    with open(salt_file, 'rb') as f:
                        salt = f.read()
                    logger.info(f"Salt de seguridad migrado correctamente desde {user_salt}")
                except Exception as e:
                    logger.warning(f"Error migrando salt: {e}")
                    salt = os.urandom(16)
                    with open(salt_file, 'wb') as f:
                        f.write(salt)
            else:
                salt = os.urandom(16)
                with open(salt_file, 'wb') as f:
                    f.write(salt)
            
            # Ocultar archivo en Windows
            try:
                import ctypes
                ctypes.windll.kernel32.SetFileAttributesW(str(salt_file), 2)
            except (ImportError, AttributeError, OSError) as e:
                logger.warning(f"No se pudo ocultar el archivo salt: {e}")
        
        self.master_key = self._derive_key(password, salt)
        self.fernet = Fernet(self.master_key)
        logger.info("Clave maestra inicializada correctamente.")
        logger.operation_end("initialize_master_key", success=True)
        return True
    
    @handle_errors("encrypt_data")
    def encrypt_data(self, data: dict) -> str:
        """Cifrar datos con AES-256"""
        if not self.fernet:
            raise SecurityError("Clave maestra no inicializada para cifrado.")
        
        json_data = json.dumps(data, separators=(',', ':'))
        encrypted = self.fernet.encrypt(json_data.encode())
        return base64.urlsafe_b64encode(encrypted).decode()
    
    @handle_errors("decrypt_data")
    def decrypt_data(self, encrypted_data: str) -> dict:
        """Descifrar datos"""
        if not self.fernet:
            raise SecurityError("Clave maestra no inicializada para descifrado.")
        
        try:
            encrypted_bytes = base64.urlsafe_b64decode(encrypted_data.encode())
            decrypted = self.fernet.decrypt(encrypted_bytes)
            return json.loads(decrypted.decode())
        except Exception as e:
            raise SecurityError("Fallo el descifrado. La clave puede ser incorrecta o los datos están corruptos.", original_error=e)
    
    @handle_errors("generate_hmac")
    def generate_hmac(self, data: str) -> str:
        """Generar HMAC para validar integridad"""
        if not self.master_key:
            raise SecurityError("Clave maestra no inicializada para HMAC.")
        
        return hmac.new(
            self.master_key,
            data.encode(),
            hashlib.sha256
        ).hexdigest()
    
    @handle_errors("verify_hmac", reraise=False, default_return=False)
    def verify_hmac(self, data: str, expected_hmac: str) -> bool:
        """Verificar integridad con HMAC"""
        calculated_hmac = self.generate_hmac(data)
        return hmac.compare_digest(calculated_hmac, expected_hmac)
    
    @handle_errors("encrypt_config_file", reraise=False, default_return=False)
    def encrypt_config_file(self, config_data: dict, password: str, file_path: Path = None) -> bool:
        """Cifrar archivo de configuración"""
        logger.operation_start("encrypt_config_file", file_path=str(file_path))
        if not self.initialize_master_key(password):
            return False
        
        if file_path is None:
            config_dir = self._get_config_dir()
            config_file = config_dir / "config.enc"
        else:
            config_file = file_path
            config_dir = config_file.parent
        
        config_dir.mkdir(parents=True, exist_ok=True)
        
        if not os.access(config_dir, os.W_OK):
            raise PermissionError(f"Sin permisos de escritura en: {config_dir}", details={'path': str(config_dir)})
        
        encrypted_data = self.encrypt_data(config_data)
        hmac_value = self.generate_hmac(encrypted_data)
        
        secure_config = {
            "data": encrypted_data,
            "hmac": hmac_value,
            "version": "1.0"
        }
        
        temp_file = config_file.with_suffix('.tmp')
        with open(temp_file, 'w') as f:
            json.dump(secure_config, f)
        
        temp_file.replace(config_file)
        
        try:
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(str(config_file), 2)
        except (ImportError, AttributeError, OSError) as e:
            logger.warning(f"No se pudo ocultar el archivo de configuración: {e}")
        
        logger.info("Archivo de configuración cifrado correctamente.", file_path=str(config_file))
        logger.operation_end("encrypt_config_file", success=True)
        return True
    
    @handle_errors("decrypt_config_file", reraise=False, default_return=None)
    def decrypt_config_file(self, password: str, file_path: Path = None) -> dict:
        """Descifrar archivo de configuración"""
        logger.operation_start("decrypt_config_file", file_path=str(file_path))
        if not self.initialize_master_key(password):
            return None
        
        if file_path is None:
            config_dir = self._get_config_dir()
            config_file = config_dir / "config.enc"
        else:
            config_file = file_path
        
        if not config_file.exists():
            logger.warning("Archivo de configuración no encontrado.", path=str(config_file))
            return None
        
        with open(config_file, 'r') as f:
            secure_config = json.load(f)
        
        encrypted_data = secure_config["data"]
        expected_hmac = secure_config["hmac"]
        
        # Verificar HMAC
        if not self.verify_hmac(encrypted_data, expected_hmac):
            # Si falla, intentar recuperar salt legacy si existe
            config_dir = self._get_config_dir()
            current_salt_file = config_dir / ".security_salt"
            
            if self._try_recover_salt(password, encrypted_data, expected_hmac, current_salt_file):
                logger.info("Salt recuperado exitosamente. Reintentando descifrado.")
                # Re-verificar con la clave recuperada
                if not self.verify_hmac(encrypted_data, expected_hmac):
                    raise SecurityError("Integridad de datos comprometida incluso tras recuperación.")
            else:
                raise SecurityError("Integridad de datos comprometida (HMAC no coincide).")
        
        decrypted_data = self.decrypt_data(encrypted_data)
        logger.operation_end("decrypt_config_file", success=True)
        return decrypted_data
    
    def _try_recover_salt(self, password, encrypted_data, expected_hmac, current_salt_file):
        """Intentar recuperar el salt correcto desde la ubicación legacy"""
        user_salt = Path.home() / ".driver_manager" / ".security_salt"
        if not user_salt.exists():
            return False
            
        try:
            with open(user_salt, 'rb') as f:
                legacy_salt = f.read()
            
            # Derivar clave temporal con el salt legacy
            temp_key = self._derive_key(password, legacy_salt)
            
            # Verificar si este salt genera el HMAC correcto
            hmac_val = hmac.new(temp_key, encrypted_data.encode(), hashlib.sha256).hexdigest()
            
            if hmac.compare_digest(hmac_val, expected_hmac):
                # ¡Encontrado! Sobrescribir el salt actual con el correcto
                import shutil
                shutil.copy2(user_salt, current_salt_file)
                
                # Actualizar la instancia actual
                self.master_key = temp_key
                self.fernet = Fernet(self.master_key)
                return True
        except Exception as e:
            logger.error(f"Error intentando recuperar salt: {e}")
            
        return False

    @handle_errors("secure_delete_file", reraise=False)
    def secure_delete_file(self, file_path: Path):
        """Eliminación segura de archivos"""
        if file_path.exists():
            logger.info(f"Iniciando eliminación segura de {file_path}")
            file_size = file_path.stat().st_size
            with open(file_path, 'wb') as f:
                f.write(os.urandom(file_size))
            file_path.unlink()
            logger.info(f"Eliminación segura de {file_path} completada.")


class CloudDataEncryption:
    """Cifrado adicional para datos en la nube"""
    
    def __init__(self, security_manager: SecurityManager):
        self.security = security_manager
    
    def encrypt_cloud_data(self, data: dict) -> dict:
        """Cifrar datos antes de subir a R2"""
        if not self.security.fernet:
            logger.warning("No se puede cifrar para la nube, clave maestra no inicializada.")
            return data  # Sin cifrado si no hay clave
        
        try:
            # Cifrar campos sensibles
            encrypted_data = data.copy()
            
            if 'users' in data:
                encrypted_data['users'] = self.security.encrypt_data(data['users'])
            
            if 'access_logs' in data:
                encrypted_data['access_logs'] = self.security.encrypt_data(data['access_logs'])
            
            # Agregar HMAC
            data_str = json.dumps(encrypted_data, separators=(',', ':'))
            encrypted_data['_hmac'] = self.security.generate_hmac(data_str)
            encrypted_data['_encrypted'] = True
            
            return encrypted_data
        except Exception as e:
            logger.error(f"Error cifrando datos para la nube: {e}", exc_info=True)
            return data
    
    @handle_errors("decrypt_cloud_data", reraise=False, default_return={})
    def decrypt_cloud_data(self, data: dict) -> dict:
        """Descifrar datos descargados de R2"""
        if not data.get('_encrypted') or not self.security.fernet:
            return data
        
        # Verificar HMAC
        hmac_value = data.pop('_hmac', '')
        data.pop('_encrypted', None)
        
        data_str = json.dumps(data, separators=(',', ':'))
        if not self.security.verify_hmac(data_str, hmac_value):
            raise SecurityError("Integridad de datos de la nube comprometida (HMAC no coincide).")
        
        # Descifrar campos
        decrypted_data = data.copy()
        
        if 'users' in data and isinstance(data['users'], str):
            decrypted_data['users'] = self.security.decrypt_data(data['users'])
        
        if 'access_logs' in data and isinstance(data['access_logs'], str):
            decrypted_data['access_logs'] = self.security.decrypt_data(data['access_logs'])
        
        return decrypted_data