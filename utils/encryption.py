"""
Módulo de Encriptación para Driver Manager
Encripta/desencripta archivos de configuración sensibles
"""

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64
import json
import os
from pathlib import Path


class SecureConfig:
    """
    Gestor de configuración encriptada
    Encripta credenciales usando clave derivada de contraseña maestra
    """
    
    def __init__(self, config_dir=None):
        """
        Inicializar gestor de configuración segura
        
        Args:
            config_dir: Directorio de configuración (opcional)
        """
        if config_dir is None:
            self.config_dir = Path.home() / ".driver_manager"
        else:
            self.config_dir = Path(config_dir)
        
        self.config_dir.mkdir(parents=True, exist_ok=True)
        
        # Archivos
        self.salt_file = self.config_dir / ".salt"
        self.config_file = self.config_dir / "config.encrypted"
        self.legacy_config = self.config_dir / "config.json"
        
        # Inicializar salt
        self._ensure_salt()
    
    def _ensure_salt(self):
        """Asegurar que existe el salt o crear uno nuevo"""
        if not self.salt_file.exists():
            salt = os.urandom(16)
            with open(self.salt_file, 'wb') as f:
                f.write(salt)
            
            # Ocultar archivo en Windows
            try:
                import subprocess
                subprocess.run(
                    ['attrib', '+H', str(self.salt_file)],
                    capture_output=True,
                    timeout=2
                )
            except:
                pass  # No crítico si falla
    
    def _load_salt(self):
        """Cargar salt existente"""
        with open(self.salt_file, 'rb') as f:
            return f.read()
    
    def _derive_key(self, password):
        """
        Derivar clave de encriptación desde contraseña
        
        Args:
            password: Contraseña maestra (string)
            
        Returns:
            Clave de encriptación Fernet
        """
        salt = self._load_salt()
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,  # 100k iteraciones para hacerlo más lento (más seguro)
        )
        
        key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
        return key
    
    def save_config(self, config_dict, password):
        """
        Guardar configuración encriptada
        
        Args:
            config_dict: Diccionario con configuración
            password: Contraseña maestra para encriptar
        """
        # Derivar clave
        key = self._derive_key(password)
        cipher = Fernet(key)
        
        # Convertir a JSON
        json_data = json.dumps(config_dict, indent=2).encode()
        
        # Encriptar
        encrypted = cipher.encrypt(json_data)
        
        # Guardar
        with open(self.config_file, 'wb') as f:
            f.write(encrypted)
        
        print(f"✅ Configuración encriptada guardada en: {self.config_file}")
    
    def load_config(self, password):
        """
        Cargar configuración desencriptada
        
        Args:
            password: Contraseña maestra para desencriptar
            
        Returns:
            Diccionario con configuración o None si no existe
        """
        if not self.config_file.exists():
            return None
        
        try:
            # Derivar clave
            key = self._derive_key(password)
            cipher = Fernet(key)
            
            # Leer archivo encriptado
            with open(self.config_file, 'rb') as f:
                encrypted = f.read()
            
            # Desencriptar
            decrypted = cipher.decrypt(encrypted)
            
            # Parsear JSON
            config = json.loads(decrypted.decode())
            
            return config
        
        except Exception as e:
            raise Exception(f"Error desencriptando configuración: {str(e)}\nVerifica que la contraseña sea correcta.")
    
    def change_password(self, old_password, new_password):
        """
        Cambiar contraseña de encriptación
        
        Args:
            old_password: Contraseña actual
            new_password: Nueva contraseña
        """
        # Cargar config con contraseña actual
        config = self.load_config(old_password)
        
        if config is None:
            raise Exception("No hay configuración guardada")
        
        # Guardar con nueva contraseña
        self.save_config(config, new_password)
        
        print("✅ Contraseña de encriptación cambiada")
    
    def migrate_from_plain_json(self, password):
        """
        Migrar desde config.json sin encriptar a config.encrypted
        
        Args:
            password: Contraseña maestra para la nueva configuración encriptada
            
        Returns:
            True si migró, False si no había config legacy
        """
        if not self.legacy_config.exists():
            return False
        
        print(f"📦 Migrando configuración desde {self.legacy_config}...")
        
        # Leer config antigua
        with open(self.legacy_config, 'r') as f:
            config = json.load(f)
        
        # Guardar encriptada
        self.save_config(config, password)
        
        # Hacer backup de la antigua
        backup_path = self.config_dir / "config.json.backup"
        self.legacy_config.rename(backup_path)
        
        print(f"✅ Migración completada")
        print(f"   Config encriptada: {self.config_file}")
        print(f"   Backup antigua: {backup_path}")
        
        return True
    
    def config_exists(self):
        """Verificar si existe configuración encriptada"""
        return self.config_file.exists()
    
    def delete_config(self):
        """Eliminar configuración encriptada"""
        if self.config_file.exists():
            self.config_file.unlink()
            print("✅ Configuración encriptada eliminada")


class ConfigEncryptionHelper:
    """Helper para facilitar uso de SecureConfig en la aplicación"""
    
    @staticmethod
    def setup_encryption(admin_password):
        """
        Configurar encriptación por primera vez
        
        Args:
            admin_password: Contraseña de administrador (usada como clave maestra)
            
        Returns:
            SecureConfig instance
        """
        secure_config = SecureConfig()
        
        # Migrar si existe config antigua
        if secure_config.legacy_config.exists():
            secure_config.migrate_from_plain_json(admin_password)
        
        return secure_config
    
    @staticmethod
    def verify_can_decrypt(admin_password):
        """
        Verificar que la contraseña puede desencriptar la config
        
        Args:
            admin_password: Contraseña de administrador
            
        Returns:
            True si puede desencriptar, False si no
        """
        secure_config = SecureConfig()
        
        if not secure_config.config_exists():
            return False
        
        try:
            config = secure_config.load_config(admin_password)
            return config is not None
        except:
            return False


# Funciones de utilidad para testing
def test_encryption():
    """Probar el sistema de encriptación"""
    print("="*60)
    print("  TEST DE ENCRIPTACIÓN")
    print("="*60)
    print()
    
    # Crear config de prueba
    test_config = {
        'account_id': 'test_account_123456789',
        'access_key_id': 'test_access_key',
        'secret_access_key': 'test_secret_key_very_long',
        'bucket_name': 'test-bucket'
    }
    
    # Contraseña de prueba
    password = 'TestPassword123!'
    
    # Crear directorio temporal
    import tempfile
    temp_dir = Path(tempfile.mkdtemp())
    print(f"📁 Usando directorio temporal: {temp_dir}")
    print()
    
    # 1. Guardar encriptado
    print("1️⃣  Guardando configuración encriptada...")
    secure = SecureConfig(temp_dir)
    secure.save_config(test_config, password)
    print()
    
    # 2. Verificar archivo encriptado
    encrypted_file = temp_dir / "config.encrypted"
    print("2️⃣  Contenido del archivo encriptado:")
    with open(encrypted_file, 'rb') as f:
        encrypted_content = f.read()
    print(f"   Primeros 50 bytes: {encrypted_content[:50]}")
    print(f"   Tamaño: {len(encrypted_content)} bytes")
    print()
    
    # 3. Cargar desencriptado
    print("3️⃣  Cargando configuración desencriptada...")
    loaded_config = secure.load_config(password)
    print(f"   ✅ Config cargada: {loaded_config}")
    print()
    
    # 4. Verificar que coinciden
    print("4️⃣  Verificando integridad...")
    if loaded_config == test_config:
        print("   ✅ Configuración coincide con la original")
    else:
        print("   ❌ ERROR: Configuración no coincide")
    print()
    
    # 5. Probar contraseña incorrecta
    print("5️⃣  Probando con contraseña incorrecta...")
    try:
        secure.load_config('WrongPassword123!')
        print("   ❌ ERROR: No debería haber funcionado")
    except Exception as e:
        print(f"   ✅ Correctamente rechazada: {str(e)[:50]}...")
    print()
    
    # 6. Cambiar contraseña
    print("6️⃣  Cambiando contraseña de encriptación...")
    new_password = 'NewPassword456!'
    secure.change_password(password, new_password)
    print()
    
    # 7. Verificar con nueva contraseña
    print("7️⃣  Verificando con nueva contraseña...")
    loaded_config2 = secure.load_config(new_password)
    if loaded_config2 == test_config:
        print("   ✅ Config cargada correctamente con nueva contraseña")
    else:
        print("   ❌ ERROR: No se pudo cargar con nueva contraseña")
    print()
    
    # Limpiar
    import shutil
    shutil.rmtree(temp_dir)
    print(f"🧹 Limpieza: {temp_dir} eliminado")
    print()
    
    print("="*60)
    print("  ✅ TEST COMPLETADO")
    print("="*60)


if __name__ == "__main__":
    test_encryption()
