import json
import shutil
from datetime import datetime
from pathlib import Path

from PyQt6.QtCore import (
    QAbstractListModel,
    QModelIndex,
    QObject,
    Qt,
    QUrl,
    pyqtProperty,
    pyqtSignal,
    pyqtSlot,
)
from PyQt6.QtGui import QDesktopServices
from PyQt6.QtWidgets import QInputDialog, QLineEdit, QMessageBox


class AdminDriverListModel(QAbstractListModel):
    TitleRole = Qt.ItemDataRole.UserRole + 1
    MetaRole = Qt.ItemDataRole.UserRole + 2
    TagRole = Qt.ItemDataRole.UserRole + 3

    def __init__(self, parent=None):
        super().__init__(parent)
        self._items = []

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._items)

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid():
            return None
        row = index.row()
        if row < 0 or row >= len(self._items):
            return None
        item = self._items[row]
        if role == self.TitleRole:
            return item.get("title", "")
        if role == self.MetaRole:
            return item.get("meta", "")
        if role == self.TagRole:
            return item.get("tag", "")
        return None

    def roleNames(self):
        return {
            self.TitleRole: b"title",
            self.MetaRole: b"meta",
            self.TagRole: b"tag",
        }

    def set_items(self, items):
        self.beginResetModel()
        self._items = list(items or [])
        self.endResetModel()


class AdminBridge(QObject):
    stateChanged = pyqtSignal()
    statusMessageChanged = pyqtSignal()
    driversChanged = pyqtSignal()
    currentDriverIndexChanged = pyqtSignal()

    def __init__(self, window, parent=None):
        super().__init__(parent)
        self.window = window
        self.driverCatalogModel = AdminDriverListModel(self)
        self.auditLogModel = AdminDriverListModel(self)
        self._status_message = "Panel de administracion listo."
        self._account_id = ""
        self._access_key_id = ""
        self._secret_access_key = ""
        self._bucket_name = ""
        self._history_api_url = ""
        self._api_token = ""
        self._api_secret = ""
        self._drivers = []
        self._selected_driver = None
        self._current_driver_index = -1
        self._audit_logs = []

    @pyqtProperty(str, notify=stateChanged)
    def currentUsername(self):
        user = getattr(self.window.user_manager, "current_user", {}) or {}
        return str(user.get("username") or "Sin sesion")

    @pyqtProperty(str, notify=stateChanged)
    def currentRole(self):
        user = getattr(self.window.user_manager, "current_user", {}) or {}
        role = str(user.get("role") or "viewer").strip()
        return role or "viewer"

    @pyqtProperty(str, notify=stateChanged)
    def currentTenant(self):
        user = getattr(self.window.user_manager, "current_user", {}) or {}
        return str(user.get("tenant_id") or "tenant-default")

    @pyqtProperty(bool, notify=stateChanged)
    def canManageUsers(self):
        return bool(getattr(self.window, "is_super_admin", False))

    @pyqtProperty(bool, notify=stateChanged)
    def canManageAssets(self):
        return bool(getattr(self.window, "is_admin", False))

    @pyqtProperty(bool, notify=stateChanged)
    def canManagePlatform(self):
        return bool(getattr(self.window, "is_admin", False))

    @pyqtProperty(str, notify=stateChanged)
    def authSummary(self):
        role = self.currentRole
        if role == "super_admin":
            return "Control total de plataforma y usuarios."
        if role == "admin":
            return "Gestion operativa y configuracion permitida."
        return "Sesion con permisos acotados."

    @pyqtProperty(str, notify=statusMessageChanged)
    def statusMessage(self):
        return self._status_message

    @pyqtProperty(str, notify=stateChanged)
    def currentThemeLabel(self):
        theme_name = str(self.window.theme_manager.get_current_theme() or "light").strip().lower()
        return "Oscuro" if theme_name == "dark" else "Claro"

    @pyqtProperty(str, notify=stateChanged)
    def accountId(self):
        return self._account_id

    @pyqtProperty(str, notify=stateChanged)
    def accessKeyId(self):
        return self._access_key_id

    @pyqtProperty(str, notify=stateChanged)
    def secretAccessKey(self):
        return self._secret_access_key

    @pyqtProperty(str, notify=stateChanged)
    def bucketName(self):
        return self._bucket_name

    @pyqtProperty(str, notify=stateChanged)
    def historyApiUrl(self):
        return self._history_api_url

    @pyqtProperty(str, notify=stateChanged)
    def apiToken(self):
        return self._api_token

    @pyqtProperty(str, notify=stateChanged)
    def apiSecret(self):
        return self._api_secret

    @pyqtProperty(QObject, constant=True)
    def driversListModel(self):
        return self.driverCatalogModel

    @pyqtProperty(QObject, constant=True)
    def auditLogsModel(self):
        return self.auditLogModel

    @pyqtProperty(int, notify=currentDriverIndexChanged)
    def currentDriverIndex(self):
        return self._current_driver_index

    @pyqtProperty(bool, notify=driversChanged)
    def canDeleteDrivers(self):
        return bool(self.canManagePlatform and self._selected_driver)

    @pyqtProperty(str, notify=driversChanged)
    def selectedDriverTitle(self):
        driver = self._selected_driver or {}
        if not driver:
            return "Selecciona un driver"
        return f"{driver.get('brand', 'Driver')} v{driver.get('version', 'N/A')}"

    @pyqtProperty(str, notify=driversChanged)
    def selectedDriverMeta(self):
        driver = self._selected_driver or {}
        if not driver:
            return "El catalogo administrativo te deja revisar y eliminar paquetes publicados."
        return str(driver.get("description") or "Paquete publicado en catalogo.")

    @pyqtProperty(str, notify=driversChanged)
    def selectedDriverDetails(self):
        driver = self._selected_driver or {}
        if not driver:
            return "Sin seleccion."
        return (
            f"Marca: {driver.get('brand', 'N/A')}\n"
            f"Version: {driver.get('version', 'N/A')}\n"
            f"Tamano: {driver.get('size_mb', 'N/A')} MB\n"
            f"Fecha: {driver.get('last_modified', 'N/A')}\n"
            f"Key: {driver.get('key', 'N/A')}"
        )

    @pyqtProperty(str, notify=driversChanged)
    def auditSummary(self):
        if not self._audit_logs:
            return "Sin eventos cargados."
        return f"{len(self._audit_logs)} eventos recientes cargados."

    def _set_status(self, message):
        normalized = str(message or "").strip()
        if self._status_message == normalized:
            return
        self._status_message = normalized
        self.statusMessageChanged.emit()
        try:
            self.window.statusBar().showMessage(normalized, 5000)
        except Exception:
            pass

    def _load_platform_config(self):
        config = self.window.load_config_data() or {}
        self._account_id = str(config.get("account_id") or "")
        self._access_key_id = str(config.get("access_key_id") or "")
        self._secret_access_key = str(config.get("secret_access_key") or "")
        self._bucket_name = str(config.get("bucket_name") or "")
        self._history_api_url = str(config.get("history_api_url") or config.get("api_url") or "")
        self._api_token = str(config.get("api_token") or "")
        self._api_secret = str(config.get("api_secret") or "")

    def _serialize_driver(self, driver):
        return {
            "title": f"{driver.get('brand', 'Driver')} v{driver.get('version', 'N/A')}",
            "meta": str(driver.get("description") or "Sin descripcion."),
            "tag": str(driver.get("last_modified") or "Sin fecha"),
        }

    def _refresh_driver_catalog(self):
        backend = self.window.resolve_driver_backend()
        if not backend:
            self._drivers = []
            self._selected_driver = None
            self._current_driver_index = -1
            self.driverCatalogModel.set_items([])
            self.currentDriverIndexChanged.emit()
            self.driversChanged.emit()
            return

        current_key = str((self._selected_driver or {}).get("key") or "")
        drivers = backend.list_drivers() or []
        self._drivers = [driver for driver in drivers if isinstance(driver, dict)]
        self.driverCatalogModel.set_items([self._serialize_driver(driver) for driver in self._drivers])

        selected_index = -1
        if current_key:
            for index, driver in enumerate(self._drivers):
                if str(driver.get("key") or "") == current_key:
                    selected_index = index
                    break
        if selected_index < 0 and self._drivers:
            selected_index = 0

        if selected_index >= 0:
            self._selected_driver = self._drivers[selected_index]
            self._current_driver_index = selected_index
        else:
            self._selected_driver = None
            self._current_driver_index = -1

        self.currentDriverIndexChanged.emit()
        self.driversChanged.emit()

    def _get_audit_logs(self, limit=100):
        user_manager = getattr(self.window, "user_manager", None)
        if user_manager and hasattr(user_manager, "get_access_logs"):
            try:
                return user_manager.get_access_logs(limit=limit) or []
            except Exception:
                pass

        history_manager = getattr(self.window, "history_manager", None)
        if history_manager and hasattr(history_manager, "_make_request"):
            try:
                return history_manager._make_request(
                    "get",
                    "audit-logs",
                    params={"limit": max(1, int(limit or 100))},
                ) or []
            except Exception:
                pass
        return []

    def _extract_timestamp_value(self, log):
        direct_value = log.get("timestamp")
        if direct_value:
            return direct_value
        for key, value in log.items():
            if not isinstance(key, str):
                continue
            lowered = key.lower()
            if "timestamp" in lowered or (lowered.startswith("timest") and "mp" in lowered):
                return value
        return None

    def _format_timestamp_value(self, raw_value):
        if not raw_value:
            return "N/A"
        try:
            parsed = datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
            return parsed.strftime("%d/%m/%Y %H:%M:%S")
        except Exception:
            return str(raw_value)

    def _serialize_audit_log(self, log):
        timestamp_text = self._format_timestamp_value(self._extract_timestamp_value(log))
        username = str(log.get("username") or log.get("user") or "N/A")
        action = str(log.get("action") or "N/A")
        success_value = log.get("success")
        if success_value is True:
            tag = "OK"
        elif success_value is False:
            tag = "ERROR"
        else:
            tag = "N/A"
        return {
            "title": action,
            "meta": f"{username} · {timestamp_text}",
            "tag": tag,
        }

    def _refresh_audit_logs(self):
        logs = self._get_audit_logs(limit=120)
        self._audit_logs = [log for log in logs if isinstance(log, dict)]
        self.auditLogModel.set_items([self._serialize_audit_log(log) for log in self._audit_logs])
        self.driversChanged.emit()

    @pyqtSlot()
    def refreshState(self):
        self._load_platform_config()
        self._refresh_driver_catalog()
        self._refresh_audit_logs()
        self.stateChanged.emit()
        self._set_status("Estado administrativo sincronizado.")

    @pyqtSlot()
    def openUserManagement(self):
        if not self.canManageUsers:
            self._set_status("La sesion actual no puede gestionar usuarios.")
            return
        self.window.show_user_management()
        self._set_status("Gestion de usuarios abierta.")

    @pyqtSlot()
    def openAssetManagement(self):
        if not self.canManageAssets:
            self._set_status("La sesion actual no puede gestionar activos.")
            return
        self.window.show_asset_management_dialog()
        self._set_status("Gestion de equipos abierta.")

    @pyqtSlot()
    def openQrGenerator(self):
        self.window.show_qr_generator_dialog()
        self._set_status("Generador QR abierto.")

    @pyqtSlot()
    def openDownloadsFolder(self):
        opened = QDesktopServices.openUrl(QUrl.fromLocalFile(str(Path.home() / "Downloads")))
        if not opened:
            self._set_status("No se pudo abrir Descargas.")

    @pyqtSlot()
    def openCacheFolder(self):
        cache_dir = getattr(self.window, "cache_dir", None)
        if cache_dir is None:
            self._set_status("No se encontro la carpeta de cache.")
            return
        opened = QDesktopServices.openUrl(QUrl.fromLocalFile(str(cache_dir)))
        if not opened:
            self._set_status("No se pudo abrir la carpeta de cache.")

    @pyqtSlot(str)
    def changeTheme(self, theme_label):
        selected = str(theme_label or "").strip()
        if selected not in {"Claro", "Oscuro"}:
            return
        theme_name = "dark" if selected == "Oscuro" else "light"
        try:
            self.window.theme_manager.set_theme(theme_name)
        except Exception:
            pass
        self.stateChanged.emit()
        self._set_status(f"Tema actualizado a {selected}.")

    @pyqtSlot()
    def clearCache(self):
        reply = QMessageBox.question(
            self.window,
            "Limpiar cache",
            "Estas segura de que quieres limpiar la cache local?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return
        try:
            shutil.rmtree(self.window.cache_dir)
            self.window.cache_dir.mkdir(parents=True, exist_ok=True)
            self._set_status("Cache local limpiada.")
        except Exception as error:
            self._set_status(f"No se pudo limpiar la cache: {error}")

    @pyqtSlot()
    def changePassword(self):
        user_manager = getattr(self.window, "user_manager", None)
        current_user = getattr(user_manager, "current_user", None) or {}
        current_username = str(current_user.get("username") or "").strip()
        if not user_manager or not current_username:
            self._set_status("No hay sesion activa para cambiar contrasena.")
            return

        old_password, ok = QInputDialog.getText(
            self.window,
            "Cambiar contrasena",
            "Ingresa la contrasena actual:",
            QLineEdit.EchoMode.Password,
        )
        if not ok:
            return

        new_password, ok = QInputDialog.getText(
            self.window,
            "Cambiar contrasena",
            "Ingresa la nueva contrasena:",
            QLineEdit.EchoMode.Password,
        )
        if not ok or not new_password:
            return

        confirm_password, ok = QInputDialog.getText(
            self.window,
            "Cambiar contrasena",
            "Confirma la nueva contrasena:",
            QLineEdit.EchoMode.Password,
        )
        if not ok:
            return
        if new_password != confirm_password:
            QMessageBox.warning(self.window, "Error", "Las contrasenas no coinciden.")
            return

        success, message = user_manager.change_password(current_username, old_password, new_password)
        if success:
            QMessageBox.information(self.window, "Exito", message)
            self._set_status("Contrasena actualizada.")
        else:
            QMessageBox.warning(self.window, "Error", message)
            self._set_status(message)

    @pyqtSlot(str, str, str, str)
    def testPlatformConnection(self, account_id, access_key_id, secret_access_key, bucket_name):
        success, message = self.window.config_manager.test_cloud_connection(
            str(account_id or "").strip(),
            str(access_key_id or "").strip(),
            str(secret_access_key or "").strip(),
            str(bucket_name or "").strip(),
        )
        if success:
            QMessageBox.information(self.window, "Conexion", message)
            self._set_status("Conexion de plataforma validada.")
        else:
            QMessageBox.critical(self.window, "Error", message)
            self._set_status(f"No se pudo validar la conexion: {message}")

    @pyqtSlot(str, str, str, str, str, str, str)
    def savePlatformConfig(
        self,
        account_id,
        access_key_id,
        secret_access_key,
        bucket_name,
        history_api_url,
        api_token,
        api_secret,
    ):
        if not self.canManageUsers:
            self._set_status("Solo super_admin puede guardar configuracion sensible.")
            return

        updated = {
            "account_id": str(account_id or "").strip(),
            "access_key_id": str(access_key_id or "").strip(),
            "secret_access_key": str(secret_access_key or "").strip(),
            "bucket_name": str(bucket_name or "").strip(),
            "history_api_url": str(history_api_url or "").strip(),
            "api_url": str(history_api_url or "").strip(),
            "api_token": str(api_token or "").strip(),
            "api_secret": str(api_secret or "").strip(),
        }
        missing = [
            key for key in ("account_id", "access_key_id", "secret_access_key", "bucket_name", "history_api_url")
            if not updated.get(key)
        ]
        if missing:
            self._set_status("Faltan campos obligatorios para guardar la configuracion.")
            return

        config = self.window.load_config_data() or {}
        config.update(updated)
        saved = self.window.config_manager.save_config_data(config)
        if not saved:
            self._set_status("No se pudo guardar la configuracion cifrada.")
            return

        self._load_platform_config()
        self.stateChanged.emit()
        self.window.init_cloud_connection()
        self._refresh_driver_catalog()
        self.driversChanged.emit()
        self._set_status("Configuracion de plataforma guardada y conexion reinicializada.")

    @pyqtSlot(int)
    def selectDriver(self, index):
        if index < 0 or index >= len(self._drivers):
            return
        self._selected_driver = self._drivers[index]
        if self._current_driver_index != index:
            self._current_driver_index = index
            self.currentDriverIndexChanged.emit()
        self.driversChanged.emit()

    @pyqtSlot()
    def refreshDriverCatalog(self):
        self._refresh_driver_catalog()
        self._set_status("Catalogo administrativo sincronizado.")

    @pyqtSlot()
    def deleteSelectedDriver(self):
        if not self.canManagePlatform:
            self._set_status("La sesion actual no puede eliminar drivers.")
            return
        driver = self._selected_driver or {}
        driver_key = str(driver.get("key") or "").strip()
        if not driver_key:
            self._set_status("No hay driver seleccionado para eliminar.")
            return

        reply = QMessageBox.question(
            self.window,
            "Confirmar eliminacion",
            f"Eliminar {driver.get('brand', 'Driver')} v{driver.get('version', 'N/A')} del catalogo?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        try:
            backend = self.window.resolve_driver_backend()
            if not backend:
                raise RuntimeError("No hay backend disponible.")
            backend.delete_driver(driver_key)
            self._refresh_driver_catalog()
            self._set_status("Driver eliminado del catalogo.")
        except Exception as error:
            self._set_status(f"No se pudo eliminar el driver: {error}")

    @pyqtSlot()
    def refreshAuditLogs(self):
        self._refresh_audit_logs()
        self._set_status("Log de auditoria sincronizado.")

    @pyqtSlot()
    def exportAuditLog(self):
        if not self._audit_logs:
            self._set_status("No hay logs de auditoria para exportar.")
            return
        try:
            output_path = Path.home() / "Downloads" / f"audit_log_{datetime.now().strftime('%Y%m%d')}.txt"
            with open(output_path, "w", encoding="utf-8") as file_handle:
                file_handle.write("=" * 80 + "\n")
                file_handle.write("LOG DE AUDITORIA - DRIVER MANAGER\n")
                file_handle.write(f"Exportado: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
                file_handle.write("=" * 80 + "\n\n")
                for log in self._audit_logs:
                    timestamp_text = self._format_timestamp_value(self._extract_timestamp_value(log))
                    username = log.get("username") or log.get("user") or "N/A"
                    action = log.get("action") or "N/A"
                    success_value = log.get("success")
                    if success_value is True:
                        success_text = "OK"
                    elif success_value is False:
                        success_text = "ERROR"
                    else:
                        success_text = "N/A"
                    details = log.get("details", {})
                    if isinstance(details, (dict, list)):
                        details_text = json.dumps(details, ensure_ascii=False)
                    else:
                        details_text = str(details)
                    file_handle.write(f"Fecha: {timestamp_text}\n")
                    file_handle.write(f"Usuario: {username}\n")
                    file_handle.write(f"Accion: {action}\n")
                    file_handle.write(f"Resultado: {success_text}\n")
                    file_handle.write(f"Detalles: {details_text}\n")
                    file_handle.write("-" * 80 + "\n\n")
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(output_path)))
            self._set_status(f"Log exportado en {output_path}.")
        except Exception as error:
            self._set_status(f"No se pudo exportar el log: {error}")

    @pyqtSlot()
    def exportHistoryJson(self):
        try:
            output_path = Path.home() / "Downloads" / f"historial_export_{datetime.now().strftime('%Y%m%d')}.json"
            records = self.window.history.get_installations() or []
            payload = {
                "exported_at": datetime.now().isoformat(),
                "total_records": len(records),
                "records": records,
            }
            with open(output_path, "w", encoding="utf-8") as file_handle:
                json.dump(payload, file_handle, ensure_ascii=False, indent=2)
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(output_path)))
            self._set_status(f"Historial exportado en {output_path}.")
        except Exception as error:
            self._set_status(f"No se pudo exportar el historial: {error}")
