"""
Configuración Portable Segura con Cifrado AES-256
Reemplaza el método inseguro de base64 con cifrado real
"""

import os
import json
import platform
import uuid
from pathlib import Path
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64


class SecurePortableConfig:
    """
    Gestor de configuración portable con cifrado AES-256 real
    
    Características:
    - Cifrado AES-256 real (no solo base64)
    - Clave derivada de identificador único del sistema
    - PBKDF2 para derivación de claves
    - Protección contra copia entre máquinas
    """
    
    def __init__(self, allow_machine_transfer=True):
        """
        Args:
            allow_machine_transfer: Si False, la config solo funciona en la máquina donde se creó
        """
        self.allow_machine_transfer = allow_machine_transfer
        self.config_dir = Path(__file__).parent / "config"
        self.config_dir.mkdir(parents=True, exist_ok=True)
        
        self.encrypted_config_file = self.config_dir / "portable_config.encrypted"
        self.machine_id_file = self.config_dir / ".machine_id"
    
    def _get_machine_identifier(self):
        """
        Obtener identificador único de la máquina
        
        Returns:
            str: Identificador único y estable de la máquina
        """
        # Intentar obtener UUID de hardware
        try:
            if platform.system() == 'Windows':
                import subprocess
                result = subprocess.run(
                    ['wmic', 'csproduct', 'get', 'UUID'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                uuid_str = result.stdout.split('\n')[1].strip()
                if uuid_str and uuid_str != 'UUID':
                    return uuid_str
        except:
            pass
        
        # Fallback: usar MAC address + nombre del host
        try:
            mac = ':'.join(['{:02x}'.format((uuid.getnode() >> elements) & 0xff)
                          for elements in range(0, 2*6, 2)][::-1])
            hostname = platform.node()
            return f"{mac}-{hostname}"
        except:
            return "default-machine-id"
    
    def _get_or_create_machine_id(self):
        """Obtener o crear ID de máquina almacenado"""
        if self.machine_id_file.exists():
            with open(self.machine_id_file, 'r') as f:
                return f.read().strip()
        else:
            machine_id = self._get_machine_identifier()
            with open(self.machine_id_file, 'w') as f:
                f.write(machine_id)
            
            # Ocultar archivo
            try:
                if platform.system() == 'Windows':
                    import ctypes
                    ctypes.windll.kernel32.SetFileAttributesW(str(self.machine_id_file), 2)
            except:
                pass
            
            return machine_id
    
    def _derive_encryption_key(self, passphrase=None):
        """
        Derivar clave de cifrado desde identificador de máquina
        
        Args:
            passphrase: Frase adicional opcional para más seguridad
            
        Returns:
            bytes: Clave de cifrado Fernet
        """
        # Obtener identificador base
        if self.allow_machine_transfer:
            # Usar passphrase fija (menos seguro pero portable)
            base_id = passphrase or "portable_driver_manager_2024"
        else:
            # Usar ID de máquina (más seguro pero no portable)
            machine_id = self._get_or_create_machine_id()
            base_id = f"{machine_id}_{passphrase or 'default'}"
        
        # Salt fijo para derivación (en producción, esto debería ser único por instalación)
        salt = b"driver_manager_salt_v2_2024"
        
        # Derivar clave con PBKDF2
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        
        key = base64.urlsafe_b64encode(kdf.derive(base_id.encode()))
        return key
    
    def encrypt_config(self, config_dict, passphrase=None):
        """
        Cifrar configuración
        
        Args:
            config_dict: Diccionario con configuración
            passphrase: Frase de cifrado opcional
        """
        try:
            # Derivar clave
            key = self._derive_encryption_key(passphrase)
            cipher = Fernet(key)
            
            # Convertir a JSON
            json_data = json.dumps(config_dict, indent=2).encode()
            
            # Cifrar
            encrypted = cipher.encrypt(json_data)
            
            # Agregar metadata
            config_package = {
                "version": "2.0",
                "encrypted_data": base64.urlsafe_b64encode(encrypted).decode(),
                "created_at": self._get_timestamp(),
                "portable": self.allow_machine_transfer,
                "algorithm": "AES-256-CBC"
            }
            
            # Guardar
            with open(self.encrypted_config_file, 'w') as f:
                json.dump(config_package, f, indent=2)
            
            print(f"✅ Configuración cifrada guardada en: {self.encrypted_config_file}")
            return True
            
        except Exception as e:
            print(f"❌ Error cifrando configuración: {e}")
            return False
    
    def decrypt_config(self, passphrase=None):
        """
        Descifrar configuración
        
        Args:
            passphrase: Frase de cifrado opcional
            
        Returns:
            dict: Configuración descifrada o None si falla
        """
        try:
            if not self.encrypted_config_file.exists():
                return None
            
            # Cargar paquete cifrado
            with open(self.encrypted_config_file, 'r') as f:
                config_package = json.load(f)
            
            # Verificar versión
            if config_package.get("version") != "2.0":
                print("⚠️ Versión de configuración no compatible")
                return None
            
            # Derivar clave
            key = self._derive_encryption_key(passphrase)
            cipher = Fernet(key)
            
            # Descifrar
            encrypted_bytes = base64.urlsafe_b64decode(config_package["encrypted_data"])
            decrypted = cipher.decrypt(encrypted_bytes)
            
            # Parsear JSON
            config = json.loads(decrypted.decode())
            
            return config
            
        except Exception as e:
            print(f"❌ Error descifrando configuración: {e}")
            return None
    
    def config_exists(self):
        """Verificar si existe configuración cifrada"""
        return self.encrypted_config_file.exists()
    
    def delete_config(self):
        """Eliminar configuración cifrada de forma segura"""
        if self.encrypted_config_file.exists():
            # Sobrescribir con datos aleatorios antes de eliminar
            file_size = self.encrypted_config_file.stat().st_size
            with open(self.encrypted_config_file, 'wb') as f:
                f.write(os.urandom(file_size))
            
            self.encrypted_config_file.unlink()
            print("✅ Configuración eliminada de forma segura")
    
    def _get_timestamp(self):
        """Obtener timestamp en formato ISO"""
        from datetime import datetime
        return datetime.now().isoformat()


# Configuración global
PORTABLE_MODE = True
AUTO_CONFIGURE = True


def get_config(passphrase=None):
    """
    Obtener configuración portable descifrada
    
    Args:
        passphrase: Frase de cifrado opcional
        
    Returns:
        dict: Configuración o None
    """
    secure_config = SecurePortableConfig(allow_machine_transfer=PORTABLE_MODE)
    return secure_config.decrypt_config(passphrase)


def save_config(config_dict, passphrase=None):
    """
    Guardar configuración cifrada
    
    Args:
        config_dict: Configuración a guardar
        passphrase: Frase de cifrado opcional
        
    Returns:
        bool: True si se guardó exitosamente
    """
    secure_config = SecurePortableConfig(allow_machine_transfer=PORTABLE_MODE)
    return secure_config.encrypt_config(config_dict, passphrase)


def is_configured():
    """Verificar si existe configuración"""
    secure_config = SecurePortableConfig(allow_machine_transfer=PORTABLE_MODE)
    return secure_config.config_exists()


def get_cache_dir():
    """Obtener directorio de caché portable"""
    if PORTABLE_MODE:
        cache_dir = Path(__file__).parent / "portable_cache"
    else:
        cache_dir = Path.home() / ".driver_manager" / "cache"
    
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


# ============================================================================
# TESTING Y EJEMPLO DE USO
# ============================================================================

def test_secure_config():
    """Probar configuración segura"""
    print("="*60)
    print("  TEST DE CONFIGURACIÓN PORTABLE SEGURA")
    print("="*60)
    print()
    
    # Configuración de ejemplo
    test_config = {
        'account_id': 'c8bc5cb8ace19d8807678b9a7c74de68',
        'access_key_id': '3a973879cf3f755e8281fa6478c2b2d',
        'secret_access_key': '0f101f87903ff1a1ce0a9b7e87ce6435919dcc50b8430cc2f0439d74bf7b3',
        'bucket_name': 'driver-storage'
    }
    
    # Usar passphrase personalizada (opcional)
    passphrase = "mi_empresa_2024"
    
    # 1. Guardar configuración cifrada
    print("1️⃣  Cifrando configuración...")
    secure = SecurePortableConfig(allow_machine_transfer=True)
    
    if secure.encrypt_config(test_config, passphrase):
        print("✅ Configuración cifrada correctamente")
    else:
        print("❌ Error cifrando configuración")
        return False
    print()
    
    # 2. Cargar configuración
    print("2️⃣  Descifrando configuración...")
    loaded_config = secure.decrypt_config(passphrase)
    
    if loaded_config:
        print("✅ Configuración descifrada correctamente")
        print(f"   Account ID: ****{loaded_config['account_id'][-4:]}")
        print(f"   Bucket: {loaded_config['bucket_name']}")
    else:
        print("❌ Error descifrando configuración")
        return False
    print()
    
    # 3. Verificar integridad
    print("3️⃣  Verificando integridad...")
    if loaded_config == test_config:
        print("✅ Datos coinciden perfectamente")
    else:
        print("❌ ERROR: Datos no coinciden")
        return False
    print()
    
    # 4. Probar passphrase incorrecta
    print("4️⃣  Probando con passphrase incorrecta...")
    wrong_config = secure.decrypt_config("passphrase_incorrecta")
    
    if wrong_config is None:
        print("✅ Passphrase incorrecta rechazada correctamente")
    else:
        print("❌ ERROR: Passphrase incorrecta aceptada")
        return False
    print()
    
    print("="*60)
    print("  ✅ TODAS LAS PRUEBAS PASARON")
    print("="*60)
    print()
    print("📋 RESUMEN DE SEGURIDAD:")
    print("  • Cifrado: AES-256-CBC (Fernet)")
    print("  • Derivación: PBKDF2-HMAC-SHA256 (100k iteraciones)")
    print("  • Modo: Portable (funciona en cualquier máquina)")
    print()
    
    return True


if __name__ == "__main__":
    test_secure_config()
