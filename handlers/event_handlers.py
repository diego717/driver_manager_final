"""
Manejadores de eventos para Driver Manager
"""

import os
import json
from pathlib import Path
from datetime import datetime
from PyQt6.QtWidgets import (QMessageBox, QInputDialog, QFileDialog, 
                             QListWidgetItem, QGroupBox, QLineEdit)
from PyQt6.QtCore import Qt

from core.logger import get_logger
from core.exceptions import (
    DriverManagerException,
    InstallationError,
    DownloadError
)

logger = get_logger()


class EventHandlers:
    """Clase que contiene todos los manejadores de eventos"""
    
    def __init__(self, main_window):
        self.main = main_window
    
    def on_driver_selected(self):
        """Cuando se selecciona un driver"""
        selected_items = self.main.drivers_tab.drivers_list.selectedItems()
        if selected_items:
            driver = selected_items[0].data(Qt.ItemDataRole.UserRole)
            details = f"Marca: {driver['brand']}\n"
            details += f"Versión: {driver['version']}\n"
            details += f"Descripción: {driver.get('description', 'N/A')}\n"
            details += f"Fecha: {driver.get('last_modified', 'N/A')}\n"
            details += f"Tamaño: {driver.get('size_mb', 'N/A')} MB"
            
            self.main.drivers_tab.driver_details.setText(details)
            self.main.drivers_tab.download_btn.setEnabled(True)
            self.main.drivers_tab.install_btn.setEnabled(True)
        else:
            self.main.drivers_tab.driver_details.clear()
            self.main.drivers_tab.download_btn.setEnabled(False)
            self.main.drivers_tab.install_btn.setEnabled(False)
    
    def on_driver_double_click(self, item):
        """Doble click para instalar"""
        self.download_and_install()
    
    def download_driver(self):
        """Descargar driver seleccionado"""
        selected_items = self.main.drivers_tab.drivers_list.selectedItems()
        if not selected_items:
            return
        
        driver = selected_items[0].data(Qt.ItemDataRole.UserRole)
        
        file_path, _ = QFileDialog.getSaveFileName(
            self.main,
            "Guardar driver",
            f"{driver['brand']}_v{driver['version']}.exe",
            "Executable (*.exe);;All Files (*.*)"
        )
        
        if file_path:
            self.main.download_manager.start_download(driver, file_path, install=False)
    
    def download_and_install(self):
        """Descargar e instalar driver"""
        selected_items = self.main.drivers_tab.drivers_list.selectedItems()
        if not selected_items:
            return
        
        driver = selected_items[0].data(Qt.ItemDataRole.UserRole)
        cache_path = self.main.cache_dir / f"{driver['brand']}_v{driver['version']}.exe"
        self.main.download_manager.start_download(driver, str(cache_path), install=True)
    
    def on_download_finished(self, file_path, install, driver):
        """Callback cuando termina la descarga"""
        logger.info("Descarga finalizada correctamente", file_path=file_path, 
                   driver=f"{driver.get('brand')} {driver.get('version')}")
        self.main.progress_bar.setVisible(False)
        self.main.statusBar().showMessage("✅ Descarga completada")
        
        if install:
            client_name, ok = QInputDialog.getText(
                self.main,
                "Información del Cliente",
                f"Cliente (opcional - presiona Enter para omitir):\n\n"
                f"Driver: {driver['brand']} v{driver['version']}",
                QLineEdit.EchoMode.Normal,
                ""
            )
            
            if not ok:
                client_name = None
            elif client_name.strip() == "":
                client_name = None
            else:
                client_name = client_name.strip()
            
            reply = QMessageBox.question(
                self.main,
                "Instalar Driver",
                f"¿Deseas instalar el driver {driver['brand']} v{driver['version']}?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )
            
            if reply == QMessageBox.StandardButton.Yes:
                self._install_driver(file_path, driver, client_name)
        else:
            QMessageBox.information(
                self.main,
                "Descarga Completa",
                f"Driver descargado en:\n{file_path}"
            )
    
    def _install_driver(self, file_path, driver, client_name):
        """Instalar driver y registrar en historial"""
        logger.operation_start("install_driver", 
        driver=driver['brand'], 
        version=driver['version'])
        self.main.installation_start_time = datetime.now()
        
        try:
            # Leer hash esperado
            file_path_obj = Path(file_path)
            hash_file = file_path_obj.with_suffix(file_path_obj.suffix + ".sha256")
            expected_hash = None
            if hash_file.exists():
                with open(hash_file, "r") as f:
                    expected_hash = f.read().strip()

            self.main.installer.install_driver(file_path, expected_hash=expected_hash)
            
            installation_time = None
            if self.main.installation_start_time:
                time_diff = datetime.now() - self.main.installation_start_time
                installation_time = int(time_diff.total_seconds())
            
            success = self.main.history.add_installation(
                driver_brand=driver['brand'],
                driver_version=driver['version'],
                status='success',
                client_name=client_name,
                driver_description=driver.get('description'),
                installation_time=installation_time,
                notes=None
            )
            
            logger.operation_end("install_driver", success=True)
            
            msg_text = "El instalador del driver se ha ejecutado.\n\n" \
                       "Si aparece la ventana de Control de Cuentas de Usuario (UAC),\n" \
                       "haz clic en 'Sí' para permitir la instalación.\n\n" \
                       f"Archivo: {Path(file_path).name}\n"
            
            if success:
                msg_text += "✅ Registrado en historial"
            else:
                msg_text += "⚠️ No se pudo registrar en la nube (Error de conexión)"

            QMessageBox.information(
                self.main,
                "Instalación Iniciada",
                msg_text
            )
        except InstallationError as e:
            logger.error("Error de instalación controlado", 
                        driver=driver['brand'],
                        details=e.details)
            self._handle_installation_error(e, file_path, driver, client_name)
        except Exception as e:
            logger.error("Error inesperado durante la instalación", 
                        exc_info=True)
            self._handle_installation_error(e, file_path, driver, client_name)
    
    def _handle_installation_error(self, error, file_path, driver, client_name):
        """Manejar errores de instalación"""
        error_msg = str(error)
        
        installation_time = None
        if self.main.installation_start_time:
            time_diff = datetime.now() - self.main.installation_start_time
            installation_time = int(time_diff.total_seconds())
        
        self.main.history.add_installation(
            driver_brand=driver['brand'],
            driver_version=driver['version'],
            status='failed',
            client_name=client_name,
            driver_description=driver.get('description'),
            installation_time=installation_time,
            error_message=error_msg,
            notes=None
        )
        
        if "740" in error_msg or "elevación" in error_msg.lower():
            detailed_error = (
                "⚠️ Se requieren permisos de Administrador\n\n"
                "SOLUCIONES:\n\n"
                "Opción 1 - Reiniciar como Administrador:\n"
                "  1. Cierra Driver Manager\n"
                "  2. Clic derecho en DriverManager.exe (o main.py)\n"
                "  3. Selecciona 'Ejecutar como administrador'\n"
                "  4. Intenta instalar nuevamente\n\n"
                "Opción 2 - Instalación Manual:\n"
                f"  1. Ve a: {Path(file_path).parent}\n"
                f"  2. Clic derecho en: {Path(file_path).name}\n"
                "  3. 'Ejecutar como administrador'\n\n"
                "❌ Registrado como fallido en historial"
            )
        else:
            detailed_error = (
                f"❌ Error al instalar:\n\n{error_msg}\n\n"
                f"Archivo descargado en:\n{file_path}\n\n"
                "❌ Registrado como fallido en historial"
            )
        
        QMessageBox.warning(self.main, "Error de Instalación", detailed_error)
        self.main.refresh_history_view()
    
    def on_download_error(self, error_msg):
        """Callback cuando hay error en descarga"""
        logger.error(f"Error en descarga: {error_msg}")
        self.main.progress_bar.setVisible(False)
        self.main.statusBar().showMessage("❌ Error en descarga")
        QMessageBox.critical(self.main, "Error", f"Error al descargar:\n{error_msg}")
    
    def admin_login(self):
        """Login de administrador"""
        password, ok = QInputDialog.getText(
            self.main,
            "Autenticación",
            "Ingrese contraseña de administrador:",
            QLineEdit.EchoMode.Password
        )
        
        if ok and password:
            if self.main.auth_manager.verify_password(password):
                logger.security_event("admin_login", "admin", True, details={'method': 'legacy'})
                self.main.is_admin = True
                self.main.admin_tab.auth_status.setText("🔓 Autenticado como Administrador")
                self.main.admin_tab.login_btn.setVisible(False)
                self.main.admin_tab.logout_btn.setVisible(True)
                self.main.admin_tab.admin_content.setVisible(True)
                
                # Cargar configuración R2 en el panel
                self.load_r2_config_to_admin_panel()
                
                # Cargar drivers en lista admin
                if hasattr(self.main, 'all_drivers'):
                    self.update_admin_drivers_list(self.main.all_drivers)
            else:
                logger.security_event("admin_login", "admin", False, details={'reason': 'wrong_password'})
                QMessageBox.warning(self.main, "Error", "Contraseña incorrecta")
    
    def admin_logout(self):
        """Logout de administrador"""
        # Logout del sistema multi-usuario si está disponible
        if hasattr(self.main, 'user_manager') and self.main.user_manager:
            self.main.user_manager.logout()
        else:
            logger.security_event("admin_logout", "admin", True)
        
        self.main.is_authenticated = False
        self.main.is_admin = False
        self.main.admin_tab.auth_status.setText("🔒 No autenticado")
        self.main.admin_tab.login_btn.setVisible(True)
        self.main.admin_tab.logout_btn.setVisible(False)
        self.main.admin_tab.admin_content.setVisible(False)
        
        # Ocultar botón de gestión de usuarios
        if hasattr(self.main.admin_tab, 'user_mgmt_btn'):
            self.main.admin_tab.user_mgmt_btn.setVisible(False)
        
        # Mostrar de nuevo el warning en HistoryTab si existe
        if hasattr(self.main.history_tab, 'warning'):
            self.main.history_tab.warning.setVisible(True)

        # Ocultar las credenciales de nuevo
        self.main.admin_tab.show_account_btn.setChecked(False)
        self.main.admin_tab.show_access_btn.setChecked(False)
        self.main.admin_tab.show_secret_btn.setChecked(False)
        self.toggle_visibility(self.main.admin_tab.admin_account_id_input, self.main.admin_tab.show_account_btn)
        self.toggle_visibility(self.main.admin_tab.admin_access_key_input, self.main.admin_tab.show_access_btn)
        self.toggle_visibility(self.main.admin_tab.admin_secret_key_input, self.main.admin_tab.show_secret_btn)
        
        # Actualizar (limpiar) la vista de logs
        self.main.refresh_audit_logs()
    
    def toggle_visibility(self, line_edit, button):
        """Alternar visibilidad de campo de texto"""
        if button.isChecked():
            line_edit.setEchoMode(QLineEdit.EchoMode.Normal)
            button.setText("🙈")
        else:
            line_edit.setEchoMode(QLineEdit.EchoMode.Password)
            button.setText("👁️")
    
    def save_r2_config(self):
        """
        Guardar configuración R2
        ⚠️ SOLO ACCESIBLE POR SUPER_ADMIN
        """
        logger.operation_start("save_r2_config")
        
        # VERIFICACIÓN: Solo super_admin puede modificar R2
        if hasattr(self.main, 'user_manager') and self.main.user_manager and self.main.user_manager.current_user:
            current_role = self.main.user_manager.current_user.get('role')
            current_username = self.main.user_manager.current_user.get('username')
            
            if current_role != "super_admin":
                logger.security_event(
                    event_type="r2_config_modification_denied",
                    username=current_username,
                    success=False,
                    details={'role': current_role},
                    severity='WARNING'
                )
                self.main.user_manager._log_access(
                    action="r2_config_modification_denied",
                    username=current_username,
                    success=False,
                    details={'role': current_role}
                )
                QMessageBox.warning(
                    self.main,
                    "Permisos Insuficientes",
                    "❌ Solo super_admin puede modificar la configuración de Cloudflare R2."
                )
                logger.operation_end("save_r2_config", success=False,
                                    reason="insufficient_permissions")
                return
        
        config = {
            'account_id': self.main.admin_tab.admin_account_id_input.text(),
            'access_key_id': self.main.admin_tab.admin_access_key_input.text(),
            'secret_access_key': self.main.admin_tab.admin_secret_key_input.text(),
            'bucket_name': self.main.admin_tab.admin_bucket_name_input.text(),
            'history_api_url': self.main.admin_tab.admin_history_api_url_input.text()
        }
        
        if not all(config.values()):
            logger.warning("Intento de guardar R2 con campos vacíos")
            QMessageBox.warning(
                self.main,
                "Campos Vacíos",
                "Por favor completa todos los campos de configuración R2."
            )
            logger.operation_end("save_r2_config", success=False, reason="empty_fields")
            return
        
        # Guardar usando el sistema de cifrado
        if self.main.config_manager.save_config_data(config):
            logger.info("Configuración R2 guardada correctamente")
            
            # Evento de seguridad: configuración modificada
            if hasattr(self.main, 'user_manager') and self.main.user_manager and self.main.user_manager.current_user:
                logger.security_event(
                    event_type="r2_config_modified",
                    username=self.main.user_manager.current_user.get('username'),
                    success=True,
                    details={
                        'bucket': config.get('bucket_name'),
                        'account_id_last4': config.get('account_id', '')[-4:]
                    },
                    severity='WARNING'
                )
                self.main.user_manager._log_access(
                    action="r2_config_modified",
                    username=self.main.user_manager.current_user.get('username'),
                    success=True,
                    details={
                        'bucket': config.get('bucket_name'),
                        'account_id_last4': config.get('account_id', '')[-4:]
                    }
                )
            
            QMessageBox.information(
                self.main,
                "Configuración Guardada",
                "✅ Configuración de Cloudflare R2 guardada correctamente.\n\n"
                "Reinicia la conexión para aplicar los cambios."
            )
            
            self.main.init_cloud_connection()
            logger.operation_end("save_r2_config", success=True)
        else:
            logger.error("Fallo al guardar configuración R2")
            logger.operation_end("save_r2_config", success=False, reason="save_failed")
            QMessageBox.critical(
                self.main,
                "Error al Guardar",
                "❌ No se pudo guardar la configuración cifrada."
            )
    
    def load_r2_config_to_admin_panel(self):
        """
        Cargar configuración R2 en el panel de administración
        ⚠️ SOLO ACCESIBLE POR SUPER_ADMIN
        """
        logger.operation_start("load_r2_config_to_admin_panel")
        
        # VERIFICACIÓN CRÍTICA: Solo super_admin puede acceder
        if not hasattr(self.main, 'user_manager') or not self.main.user_manager:
            logger.warning("Intento de cargar R2 sin user_manager inicializado")
            logger.operation_end("load_r2_config_to_admin_panel", success=False, 
                                reason="no_user_manager")
            return
        
        if not self.main.user_manager.current_user:
            logger.warning("Intento de cargar R2 sin usuario autenticado")
            logger.operation_end("load_r2_config_to_admin_panel", success=False,
                                reason="not_authenticated")
            return
        
        current_role = self.main.user_manager.current_user.get('role')
        current_username = self.main.user_manager.current_user.get('username')
        
        # SOLO super_admin puede ver credenciales R2
        if current_role != "super_admin":
            logger.security_event(
                event_type="r2_credentials_access_denied",
                username=current_username,
                success=False,
                details={'role': current_role, 'reason': 'insufficient_permissions'},
                severity='WARNING'
            )
            logger.warning(f"Usuario {current_username} ({current_role}) intentó acceder a credenciales R2")
            logger.operation_end("load_r2_config_to_admin_panel", success=False,
                                reason="insufficient_permissions")
            return
        
        # Cargar configuración
        config = self.main.load_config_data()
        if config:
            logger.info(f"Cargando credenciales R2 para super_admin: {current_username}")
            
            self.main.admin_tab.admin_account_id_input.setText(config.get('account_id', ''))
            self.main.admin_tab.admin_access_key_input.setText(config.get('access_key_id', ''))
            self.main.admin_tab.admin_secret_key_input.setText(config.get('secret_access_key', ''))
            self.main.admin_tab.admin_bucket_name_input.setText(config.get('bucket_name', ''))
            self.main.admin_tab.admin_history_api_url_input.setText(config.get('history_api_url', ''))
            
            # Evento de seguridad: credenciales accedidas
            logger.security_event(
                event_type="r2_credentials_loaded",
                username=current_username,
                success=True,
                details={
                    'role': current_role,
                    'account_id_last4': config.get('account_id', '')[-4:] if config.get('account_id') else 'N/A'
                },
                severity='INFO'
            )
            
            logger.operation_end("load_r2_config_to_admin_panel", success=True)
        else:
            logger.warning("No se encontró configuración R2 para cargar")
            logger.operation_end("load_r2_config_to_admin_panel", success=False,
                                reason="no_config_found")
    
    def update_admin_drivers_list(self, drivers):
        """Actualizar lista de drivers en panel admin"""
        self.main.admin_tab.admin_drivers_list.clear()
        for driver in drivers:
            item = QListWidgetItem(
                f"{driver['brand']} - v{driver['version']} ({driver.get('size_mb', '?')} MB)"
            )
            item.setData(Qt.ItemDataRole.UserRole, driver)
            self.main.admin_tab.admin_drivers_list.addItem(item)
    
    def change_admin_password(self):
        """Cambiar contraseña de administrador"""
        # Para sistema multi-usuario, usar su propio sistema
        if hasattr(self.main, 'user_manager') and self.main.user_manager and self.main.user_manager.current_user:
            current_username = self.main.user_manager.current_user.get('username')
            
            old_password, ok = QInputDialog.getText(
                self.main,
                "Cambiar Contraseña",
                "Ingrese contraseña actual:",
                QLineEdit.EchoMode.Password
            )
            
            if not ok:
                return
            
            new_password, ok = QInputDialog.getText(
                self.main,
                "Cambiar Contraseña",
                "Ingrese nueva contraseña:",
                QLineEdit.EchoMode.Password
            )
            
            if ok and new_password:
                confirm_password, ok = QInputDialog.getText(
                    self.main,
                    "Cambiar Contraseña",
                    "Confirme nueva contraseña:",
                    QLineEdit.EchoMode.Password
                )
                
                if ok and new_password == confirm_password:
                    success, message = self.main.user_manager.change_password(
                        current_username, old_password, new_password
                    )
                    
                    if success:
                        QMessageBox.information(self.main, "Éxito", message)
                    else:
                        QMessageBox.warning(self.main, "Error", message)
                else:
                    QMessageBox.warning(self.main, "Error", "Las contraseñas no coinciden")
            return
        
        # Sistema legacy
        old_password, ok = QInputDialog.getText(
            self.main,
            "Cambiar Contraseña",
            "Ingrese contraseña actual:",
            QLineEdit.EchoMode.Password
        )
        
        if not ok:
            return
        
        if not self.main.auth_manager.verify_password(old_password):
            QMessageBox.warning(self.main, "Error", "Contraseña actual incorrecta")
            return
        
        new_password, ok = QInputDialog.getText(
            self.main,
            "Cambiar Contraseña",
            "Ingrese nueva contraseña:",
            QLineEdit.EchoMode.Password
        )
        
        if ok and new_password:
            confirm_password, ok = QInputDialog.getText(
                self.main,
                "Cambiar Contraseña",
                "Confirme nueva contraseña:",
                QLineEdit.EchoMode.Password
            )
            
            if ok and new_password == confirm_password:
                self.main.auth_manager.change_password(new_password)
                QMessageBox.information(self.main, "Éxito", "Contraseña cambiada correctamente")
            else:
                QMessageBox.warning(self.main, "Error", "Las contraseñas no coinciden")
    
    def clear_cache(self):
        """Limpiar caché local"""
        reply = QMessageBox.question(
            self.main,
            "Limpiar Caché",
            "¿Está seguro que desea limpiar el caché local?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            import shutil
            try:
                logger.info(f"Limpiando caché en: {self.main.cache_dir}")
                shutil.rmtree(self.main.cache_dir)
                self.main.cache_dir.mkdir(parents=True, exist_ok=True)
                QMessageBox.information(self.main, "Éxito", "Caché limpiado correctamente")
                if self.main.user_manager and self.main.user_manager.current_user:
                    self.main.user_manager._log_access(
                        action="clear_cache_success",
                        username=self.main.user_manager.current_user.get('username'),
                        success=True
                    )
            except Exception as e:
                logger.error(f"Error limpiando caché: {e}", exc_info=True)
                QMessageBox.critical(self.main, "Error", f"Error al limpiar caché:\n{str(e)}")
                if self.main.user_manager and self.main.user_manager.current_user:
                    self.main.user_manager._log_access(
                        action="clear_cache_failed",
                        username=self.main.user_manager.current_user.get('username'),
                        success=False,
                        details={'error': str(e)}
                    )
    
    def on_upload_finished(self, upload_info):
        """Callback cuando termina la subida"""
        logger.info("Subida de driver finalizada correctamente")
        self.main.progress_bar.setVisible(False)
        self.main.statusBar().showMessage("✅ Driver subido correctamente")
        QMessageBox.information(self.main, "Éxito", "Driver subido a la nube correctamente")

        if self.main.user_manager and self.main.user_manager.current_user:
            self.main.user_manager._log_access(
                action="upload_driver_success",
                username=self.main.user_manager.current_user.get('username'),
                success=True,
                details=upload_info
            )
        
        self.main.admin_tab.upload_version.clear()
        self.main.admin_tab.upload_description.clear()
        self.main.admin_tab.selected_file_label.setText("No se ha seleccionado archivo")
        if hasattr(self.main, 'selected_file_path'):
            delattr(self.main, 'selected_file_path')
        
        self.main.refresh_drivers_list()
        self.main.refresh_audit_logs()
    
    def on_upload_error(self, error_msg, upload_info):
        """Callback cuando hay error en subida"""
        logger.error(f"Error en subida: {error_msg}")
        self.main.progress_bar.setVisible(False)
        self.main.statusBar().showMessage("❌ Error en subida")
        QMessageBox.critical(self.main, "Error", f"Error al subir driver:\n{error_msg}")

        if self.main.user_manager and self.main.user_manager.current_user:
            details = upload_info
            details['error'] = error_msg
            self.main.user_manager._log_access(
                action="upload_driver_failed",
                username=self.main.user_manager.current_user.get('username'),
                success=False,
                details=details
            )
        self.main.refresh_audit_logs()