"""
Gestor de configuración para Driver Manager con Seguridad Avanzada y Soporte USB
"""
import sys
import os
import shutil
import json
from pathlib import Path
from PyQt6.QtWidgets import QMessageBox, QGroupBox, QPushButton, QLineEdit, QLabel

# --- IMPORTACIONES ACTUALIZADAS PARA LA NUEVA ESTRUCTURA ---
# Ahora buscamos los managers en la carpeta 'managers'
from managers.cloud_manager import CloudflareR2Manager
# Security manager está en la misma carpeta 'core', usamos import relativo o directo
from core.security_manager import SecurityManager
from core.master_password_vault import MasterPasswordVault
# Los diálogos ahora están en ui.dialogs
from ui.dialogs.master_password_dialog import show_master_password_dialog
# Logger y exceptions están en 'core'
from core.logger import get_logger
from core.exceptions import (
    handle_errors,
    returns_result_tuple,
    ConfigurationError,
    SecurityError,
    validate_not_empty
)

logger = get_logger()
MASTER_PASSWORD_ENV = "DRIVER_MANAGER_MASTER_PASSWORD"
LEGACY_MASTER_PASSWORD_ENV = "DRIVER_MANAGER_LEGACY_MASTER_PASSWORD"


class SecureString:
    """
    Wrapper mutable para datos sensibles en memoria.
    """

    def __init__(self, value=""):
        self._data = bytearray()
        if value:
            self.set(value)

    def set(self, value):
        self.clear()
        if value:
            self._data = bytearray(str(value).encode("utf-8"))

    def get(self):
        if not self._data:
            return None
        return self._data.decode("utf-8")

    def clear(self):
        for i in range(len(self._data)):
            self._data[i] = 0
        self._data = bytearray()

    def __bool__(self):
        return bool(self._data)

    def __del__(self):
        self.clear()

class ConfigManager:
    def __init__(self, main_window):
        self.main = main_window
        
        # Detectar ruta base unica para ejecucion en script y .exe.
        if getattr(sys, 'frozen', False):
            # Si es .exe, usar la ruta del ejecutable
            self.base_path = Path(sys.executable).parent
        else:
            # Si es script .py, subir un nivel porque estamos dentro de 'core/'
            # self.base_path = Path(__file__).parent.parent 
            # O mejor, usamos sys.argv[0] para asegurar la raíz del proyecto
            self.base_path = Path(sys.argv[0]).parent
            
        # Definir rutas
        self.config_dir = self.base_path / "config"
        self.config_dir.mkdir(parents=True, exist_ok=True) 
        
        self.config_file = self.config_dir / "config.json"       
        self.encrypted_config_file = self.config_dir / "config.enc" 
        self.portable_json_path = self.base_path / "portable_config.json"
        
        # Componentes
        self.security = SecurityManager()
        self.password_vault = MasterPasswordVault()
        self._secure_master_password = None
        self._secure_vault_password_cache = None
        self._vault_password_loaded = False
        self._config_loaded = False
        self._applying_portable = False

        env_master_password = os.getenv(MASTER_PASSWORD_ENV)
        if env_master_password:
            self._set_master_password(env_master_password)

    def _set_master_password(self, password):
        """Guardar contraseña maestra en buffer mutable."""
        if not password:
            self._clear_master_password()
            return
        if self._secure_master_password is None:
            self._secure_master_password = SecureString(password)
            return
        self._secure_master_password.set(password)

    def _get_master_password(self):
        """Obtener contraseña maestra como string temporal."""
        if not self._secure_master_password:
            return None
        return self._secure_master_password.get()

    def _clear_master_password(self):
        if self._secure_master_password:
            self._secure_master_password.clear()
        self._secure_master_password = None

    def _set_vault_password_cache(self, password):
        """Guardar cache del vault en buffer mutable."""
        if not password:
            self._clear_vault_password_cache()
            return
        if self._secure_vault_password_cache is None:
            self._secure_vault_password_cache = SecureString(password)
            return
        self._secure_vault_password_cache.set(password)

    def _get_vault_password_cache(self):
        if not self._secure_vault_password_cache:
            return None
        return self._secure_vault_password_cache.get()

    def _clear_vault_password_cache(self):
        if self._secure_vault_password_cache:
            self._secure_vault_password_cache.clear()
        self._secure_vault_password_cache = None

    def _clear_sensitive_caches(self):
        self._clear_master_password()
        self._clear_vault_password_cache()

    def __del__(self):
        try:
            self._clear_sensitive_caches()
        except Exception:
            pass

    def _get_password_candidates(self):
        """Construir lista de contraseñas candidatas sin duplicados."""
        candidates = []
        master_password = self._get_master_password()
        env_password = os.getenv(MASTER_PASSWORD_ENV)
        legacy_env_password = os.getenv(LEGACY_MASTER_PASSWORD_ENV)
        vault_password = self._get_vault_password()

        for candidate in [master_password, env_password, legacy_env_password, vault_password]:
            if candidate and candidate not in candidates:
                candidates.append(candidate)

        return candidates

    def _get_vault_password(self):
        """Obtener contraseña guardada localmente (si existe)."""
        if self._vault_password_loaded:
            return self._get_vault_password_cache()

        self._set_vault_password_cache(self.password_vault.load_password())
        self._vault_password_loaded = True
        return self._get_vault_password_cache()

    def _save_vault_password(self, password):
        """Guardar contraseña maestra en almacenamiento seguro local."""
        if not password:
            return
        if self.password_vault.save_password(password):
            self._set_vault_password_cache(password)
            self._vault_password_loaded = True

    def _clear_vault_password(self):
        """Eliminar contraseña maestra local guardada en vault."""
        self.password_vault.clear_password()
        self._clear_vault_password_cache()
        self._vault_password_loaded = True

    def _apply_vault_preference(self, password, remember_choice):
        """
        Aplicar preferencia de guardado local:
        - True: guardar en vault
        - False: limpiar vault
        - None: no cambiar
        """
        if remember_choice is True:
            self._save_vault_password(password)
        elif remember_choice is False:
            self._clear_vault_password()

    def _migrate_master_password_if_needed(self, decrypted_config, used_password):
        """
        Si se abrió con clave legacy y existe una clave nueva, recifrar config.enc
        automáticamente con la clave nueva.
        """
        legacy_password = os.getenv(LEGACY_MASTER_PASSWORD_ENV)
        target_password = os.getenv(MASTER_PASSWORD_ENV)

        if not (legacy_password and target_password):
            return

        if used_password != legacy_password or legacy_password == target_password:
            return

        migrated = self.security.encrypt_config_file(
            decrypted_config,
            target_password,
            self.encrypted_config_file
        )
        if migrated:
            self._set_master_password(target_password)
            logger.info("Migracion de clave maestra completada usando variable de entorno.")
        else:
            logger.warning("No se pudo migrar config.enc a la nueva clave maestra.")

    def _request_master_password(self, is_first_time=False):
        """Solicitar contraseña maestra y preferencia de guardado local."""
        password, remember_choice = show_master_password_dialog(
            self.main,
            is_first_time=is_first_time,
            allow_remember_option=self.password_vault.is_supported(),
            return_metadata=True,
        )
        if password:
            self._set_master_password(password)
        return password, remember_choice

    @handle_errors("load_config_data", reraise=False, default_return=None)
    def load_config_data(self):
        """Carga la configuración."""
        logger.operation_start("load_config_data")
        
        # ESCENARIO A: PRIMERA VEZ (Con JSON Portable)
        if self.portable_json_path.exists():
            try:
                # Accept JSON files saved with or without UTF-8 BOM.
                with open(self.portable_json_path, 'r', encoding='utf-8-sig') as f:
                    portable_data = json.load(f)
                
                if portable_data.get('account_id'):
                    logger.info("📂 Configuración portable detectada en USB.")
                    self._config_loaded = True
                    return portable_data
            except Exception as e:
                logger.error(f"Error leyendo JSON portable: {e}")

        # ESCENARIO B: USO DIARIO (Desde Archivo Cifrado en USB)
        if self.encrypted_config_file.exists():
            passwords_to_try = self._get_password_candidates()
            vault_password = self._get_vault_password()
            vault_password_failed = False
            
            for pwd in passwords_to_try:
                try:
                    config = self.security.decrypt_config_file(pwd, self.encrypted_config_file)
                    if config:
                        self._migrate_master_password_if_needed(config, pwd)
                        if not self._get_master_password():
                            self._set_master_password(pwd)
                        self._config_loaded = True
                        logger.info("✅ Configuración cargada desde 'config.enc' en USB.")
                        return config
                except Exception:
                    if vault_password and pwd == vault_password:
                        vault_password_failed = True
                    continue

            if vault_password_failed:
                logger.warning("La contraseña maestra guardada en este equipo es inválida. Se eliminará.")
                self._clear_vault_password()

            prompted_password, remember_choice = self._request_master_password(is_first_time=False)
            if prompted_password and prompted_password not in passwords_to_try:
                try:
                    config = self.security.decrypt_config_file(prompted_password, self.encrypted_config_file)
                    if config:
                        self._apply_vault_preference(prompted_password, remember_choice)
                        self._config_loaded = True
                        logger.info("Configuración cargada desde 'config.enc' con contraseña manual.")
                        return config
                except Exception:
                    pass
            elif prompted_password:
                self._apply_vault_preference(prompted_password, remember_choice)
            
            logger.warning("No se pudo descifrar el archivo config.enc.")
        return None

    @handle_errors("save_config_data", reraise=False, default_return=False)
    def save_config_data(self, config):
        """Guarda la configuración cifrada en el USB."""
        logger.operation_start("save_config_data")
        
        if not config:
            return False

        self.config_dir.mkdir(parents=True, exist_ok=True)
        remember_choice = None
        
        # DETERMINAR CONTRASEÑA DE CIFRADO
        if not self._get_master_password():
            env_password = os.getenv(MASTER_PASSWORD_ENV)
            if env_password:
                self._set_master_password(env_password)

        if not self._get_master_password():
            password, remember_choice = self._request_master_password(
                is_first_time=not self.encrypted_config_file.exists()
            )
            if not password:
                return False
            self._set_master_password(password)
        
        success = self.security.encrypt_config_file(
            config,
            self._get_master_password(),
            self.encrypted_config_file,
        )
        
        if success:
            self._apply_vault_preference(self._get_master_password(), remember_choice)
            self._config_loaded = True
            logger.info(f"✅ Guardado exitoso en: {self.encrypted_config_file}")
            if self.config_file.exists():
                try:
                    self.config_file.unlink()
                except Exception:
                    pass
            return True
        return False

    @handle_errors("apply_portable_config", reraise=False)
    def apply_portable_config(self, portable_config):
        """Aplica la configuración, guarda y PROTEGE LA UI."""
        logger.operation_start("apply_portable_config")

        if not isinstance(portable_config, dict):
            logger.error("Config portable inválida: se esperaba un objeto JSON.")
            if hasattr(self.main, "statusBar"):
                self.main.statusBar().showMessage("❌ Configuración portable inválida")
            return False

        required_fields = ["account_id", "access_key_id", "secret_access_key", "bucket_name"]
        missing_fields = [field for field in required_fields if not portable_config.get(field)]
        if missing_fields:
            logger.error(
                "Config portable incompleta",
                missing_fields=missing_fields,
            )
            if hasattr(self.main, "statusBar"):
                self.main.statusBar().showMessage("❌ Configuración portable incompleta")
            return False

        self._applying_portable = True
        try:
            success = self.save_config_data(portable_config)
        finally:
            self._applying_portable = False

        if not success:
            logger.error("Fallo al guardar config portable.")
            if hasattr(self.main, "statusBar"):
                self.main.statusBar().showMessage("❌ Error guardando configuración portable")
            return False

        self.init_cloud_connection()
        
        # ACTUALIZAR UI Y OCULTAR CREDENCIALES
        if hasattr(self.main, 'admin_tab'):
            self.main.is_admin = True
            
            try:
                self.main.admin_tab.admin_account_id_input.setText(portable_config.get('account_id', ''))
                self.main.admin_tab.admin_access_key_input.setText(portable_config.get('access_key_id', ''))
                self.main.admin_tab.admin_secret_key_input.setText(portable_config.get('secret_access_key', ''))
                self.main.admin_tab.admin_bucket_name_input.setText(portable_config.get('bucket_name', ''))
                api = portable_config.get('api_url') or portable_config.get('history_api_url', '')
                self.main.admin_tab.admin_history_api_url_input.setText(api)
                if hasattr(self.main.admin_tab, 'admin_api_token_input'):
                    self.main.admin_tab.admin_api_token_input.setText(portable_config.get('api_token', ''))
                if hasattr(self.main.admin_tab, 'admin_api_secret_input'):
                    self.main.admin_tab.admin_api_secret_input.setText(portable_config.get('api_secret', ''))
            except:
                pass

            # OCULTAR EL PANEL DE CREDENCIALES
            for widget in self.main.admin_tab.findChildren(QGroupBox):
                title = widget.title().lower()
                if "cloudflare" in title or "credenciales" in title or "conexión" in title:
                    widget.setVisible(False)
                else:
                    widget.setVisible(True)

            # GESTIONAR BOTONES
            for widget in self.main.admin_tab.findChildren(QPushButton):
                text = widget.text().lower()
                if "guardar" in text or "probar" in text or "conectar" in text:
                    widget.setVisible(False)
                elif any(k in text for k in ["seleccionar", "subir", "eliminar", "crear", "usuario"]):
                    widget.setVisible(True)

            self.main.admin_tab.auth_status.setText("🔓 Modo Portable (Seguro)")
            self.main.admin_tab.login_btn.setVisible(False)
            self.main.admin_tab.admin_content.setVisible(True)

            # REACTIVAR GESTIÓN DE USUARIOS
            if hasattr(self.main, 'user_manager') and self.main.user_manager:
                self.main.user_manager.cloud_manager = self.main.cloud_manager
                if hasattr(self.main.user_manager, 'sync_users'):
                    self.main.user_manager.sync_users()
                elif hasattr(self.main.admin_tab, 'refresh_users_list'):
                    self.main.admin_tab.refresh_users_list()

        self.main.statusBar().showMessage("✅ Configuración portable aplicada y protegida")
        logger.operation_end("apply_portable_config", success=True)
        return True
    
    @handle_errors("init_cloud_connection", reraise=False)
    def init_cloud_connection(self):
        """Inicializar conexión con Cloudflare R2"""
        logger.operation_start("init_cloud_connection")
        config = self.load_config_data()

        if not config:
            logger.warning("No hay configuración disponible para iniciar conexión R2.")
            self.main.cloud_manager = None
            self.main.statusBar().showMessage("❌ Configuración de nube faltante")
            return False

        try:
            self.main.cloud_manager = CloudflareR2Manager(
                account_id=config.get('account_id'),
                access_key_id=config.get('access_key_id'),
                secret_access_key=config.get('secret_access_key'),
                bucket_name=config.get('bucket_name')
            )
            
            if hasattr(self.main, 'refresh_drivers_list'):
                self.main.refresh_drivers_list()
            
            if hasattr(self.main, 'user_manager') and self.main.user_manager:
                self.main.user_manager.cloud_manager = self.main.cloud_manager

            self.main.statusBar().showMessage("✅ Conectado a Cloudflare R2")
            logger.info("Conexión a Cloudflare R2 establecida.")
            return True
            
        except Exception as e:
            logger.error(f"Error de conexión R2: {e}", exc_info=True)
            self.main.statusBar().showMessage("❌ Error conectando a la nube")
            return False

    # Probar conexion a R2 con credenciales proporcionadas.
    @returns_result_tuple("test_cloud_connection")
    def test_cloud_connection(self, account_id, access_key_id, secret_access_key, bucket_name):
        logger.operation_start("test_cloud_connection", bucket=bucket_name)
        try:
            test_manager = CloudflareR2Manager(
                account_id=account_id,
                access_key_id=access_key_id,
                secret_access_key=secret_access_key,
                bucket_name=bucket_name
            )
            test_manager.list_drivers()
            logger.operation_end("test_cloud_connection", success=True)
            return True, "✅ Conexión exitosa a Cloudflare R2"
        except Exception as e:
            return False, str(e)
