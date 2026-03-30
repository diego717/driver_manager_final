from pathlib import Path

from PyQt6.QtCore import (
    QAbstractListModel,
    QModelIndex,
    QObject,
    Qt,
    pyqtProperty,
    pyqtSignal,
    pyqtSlot,
)
from PyQt6.QtWidgets import QFileDialog, QMessageBox

from core.logger import get_logger
from ui.dialogs.quick_upload_dialog import QuickUploadDialog, UploadSuccessDialog

logger = get_logger()


class DriverListModel(QAbstractListModel):
    NameRole = Qt.ItemDataRole.UserRole + 1
    BrandRole = Qt.ItemDataRole.UserRole + 2
    VersionRole = Qt.ItemDataRole.UserRole + 3
    SummaryRole = Qt.ItemDataRole.UserRole + 4
    KeyRole = Qt.ItemDataRole.UserRole + 5

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
        if role == self.NameRole:
            return item.get("name", "")
        if role == self.BrandRole:
            return item.get("brand", "")
        if role == self.VersionRole:
            return item.get("version", "")
        if role == self.SummaryRole:
            return item.get("summary", "")
        if role == self.KeyRole:
            return item.get("key", "")
        return None

    def roleNames(self):
        return {
            self.NameRole: b"name",
            self.BrandRole: b"brand",
            self.VersionRole: b"version",
            self.SummaryRole: b"summary",
            self.KeyRole: b"key",
        }

    def set_items(self, items):
        self.beginResetModel()
        self._items = list(items or [])
        self.endResetModel()


class DriversBridge(QObject):
    brandsChanged = pyqtSignal()
    statusMessageChanged = pyqtSignal()
    selectedChanged = pyqtSignal()
    filterChanged = pyqtSignal()
    currentIndexChanged = pyqtSignal()
    busyChanged = pyqtSignal()
    uploadProgressChanged = pyqtSignal()

    def __init__(self, window, parent=None):
        super().__init__(parent)
        self.window = window
        self.driverModel = DriverListModel(self)
        self._all_drivers = []
        self._brands = ["Todas"]
        self._current_filter = "Todas"
        self._selected_driver = None
        self._current_index = -1
        self._status_message = "Listo para cargar el catalogo."
        self._busy = False
        self._upload_progress = -1

    @pyqtProperty("QStringList", notify=brandsChanged)
    def brands(self):
        return self._brands

    @pyqtProperty(QObject, constant=True)
    def driverListModel(self):
        return self.driverModel

    @pyqtProperty(str, notify=statusMessageChanged)
    def statusMessage(self):
        return self._status_message

    @pyqtProperty(str, notify=filterChanged)
    def currentFilter(self):
        return self._current_filter

    @pyqtProperty(int, notify=currentIndexChanged)
    def currentIndex(self):
        return self._current_index

    @pyqtProperty(bool, notify=busyChanged)
    def busy(self):
        return self._busy

    @pyqtProperty(int, notify=uploadProgressChanged)
    def uploadProgress(self):
        return self._upload_progress

    @pyqtProperty(str, notify=selectedChanged)
    def selectedTitle(self):
        driver = self._selected_driver or {}
        if not driver:
            return "Selecciona un paquete"
        return f"{driver.get('brand', 'Driver')} v{driver.get('version', 'N/A')}"

    @pyqtProperty(str, notify=selectedChanged)
    def selectedMeta(self):
        driver = self._selected_driver or {}
        if not driver:
            return "Explora el catalogo para ver detalle tecnico, fecha, tamano y acciones."
        return driver.get("description") or "Paquete listo para descarga o instalacion."

    @pyqtProperty(str, notify=selectedChanged)
    def selectedDetails(self):
        driver = self._selected_driver or {}
        if not driver:
            return "Sin seleccion"

        backend = self.window.resolve_driver_backend()
        size_mb = driver.get("size_mb")
        if size_mb in (None, "", "N/A") and backend and hasattr(backend, "get_driver_size_mb"):
            try:
                resolved = backend.get_driver_size_mb(driver)
                if resolved is not None:
                    size_mb = resolved
            except Exception:
                pass

        size_text = "N/A"
        try:
            if size_mb not in (None, "", "N/A"):
                size_text = f"{float(size_mb):.2f} MB"
        except Exception:
            size_text = "N/A"

        return (
            f"Marca: {driver.get('brand', 'N/A')}\n"
            f"Version: {driver.get('version', 'N/A')}\n"
            f"Descripcion: {driver.get('description', 'N/A')}\n"
            f"Fecha: {driver.get('last_modified', 'N/A')}\n"
            f"Tamano: {size_text}\n"
            f"Key: {driver.get('key', 'N/A')}"
        )

    @pyqtProperty(bool, notify=selectedChanged)
    def canRunActions(self):
        return bool(self._selected_driver)

    def _set_busy(self, value):
        normalized = bool(value)
        if self._busy == normalized:
            return
        self._busy = normalized
        self.busyChanged.emit()

    def _set_upload_progress(self, value):
        normalized = int(value)
        if self._upload_progress == normalized:
            return
        self._upload_progress = normalized
        self.uploadProgressChanged.emit()

    def _set_status(self, message):
        value = str(message or "").strip()
        if self._status_message == value:
            return
        self._status_message = value
        self.statusMessageChanged.emit()
        try:
            self.window.statusBar().showMessage(value, 5000)
        except Exception:
            pass

    def _serialize_driver(self, driver):
        brand = str(driver.get("brand") or "N/A")
        version = str(driver.get("version") or "N/A")
        description = str(driver.get("description") or "").strip()
        summary = description or "Sin descripcion corta."
        return {
            "name": f"{brand} / v{version}",
            "brand": brand,
            "version": version,
            "summary": summary,
            "key": str(driver.get("key") or ""),
        }

    def _rebuild_filters(self):
        brands = sorted(
            {
                str(driver.get("brand") or "").strip()
                for driver in self._all_drivers
                if isinstance(driver, dict) and str(driver.get("brand") or "").strip()
            }
        )
        self._brands = ["Todas", *brands]
        if self._current_filter not in self._brands:
            self._current_filter = "Todas"
            self.filterChanged.emit()
        self.brandsChanged.emit()

    def _apply_filter(self):
        current_key = ""
        if self._selected_driver:
            current_key = str(self._selected_driver.get("key") or "")

        filtered = []
        selected_index = -1
        for index, driver in enumerate(self._all_drivers):
            if not isinstance(driver, dict):
                continue
            brand = str(driver.get("brand") or "").strip()
            if self._current_filter != "Todas" and brand != self._current_filter:
                continue
            if current_key and current_key == str(driver.get("key") or ""):
                selected_index = len(filtered)
            filtered.append(driver)

        self.driverModel.set_items([self._serialize_driver(driver) for driver in filtered])
        if filtered:
            if selected_index < 0:
                selected_index = 0
            self._selected_driver = filtered[selected_index]
            self._current_index = selected_index
        else:
            self._selected_driver = None
            self._current_index = -1

        self.currentIndexChanged.emit()
        self.selectedChanged.emit()

    def _selected_driver_defaults(self):
        driver = self._selected_driver or {}
        brand = str(driver.get("brand") or "").strip()
        version = str(driver.get("version") or "").strip()
        if brand or version:
            return f"{brand}-{version}".strip("-")
        return ""

    @pyqtSlot()
    def refreshDrivers(self):
        self._set_upload_progress(-1)
        backend = self.window.resolve_driver_backend()
        if not backend:
            self._all_drivers = []
            self.driverModel.set_items([])
            self._selected_driver = None
            self._current_index = -1
            self.brandsChanged.emit()
            self.currentIndexChanged.emit()
            self.selectedChanged.emit()
            self._set_status("No hay backend de drivers configurado.")
            return

        self._set_busy(True)
        try:
            drivers = backend.list_drivers()
            self._all_drivers = list(drivers or [])
            self._rebuild_filters()
            self._apply_filter()
            self._set_status(f"{len(self._all_drivers)} drivers cargados.")
        except Exception as error:
            logger.error("Error cargando drivers en v2", details=str(error), exc_info=True)
            self._all_drivers = []
            self.driverModel.set_items([])
            self._selected_driver = None
            self._current_index = -1
            self.currentIndexChanged.emit()
            self.selectedChanged.emit()
            self._set_status(f"Error cargando drivers: {error}")
        finally:
            self._set_busy(False)

    @pyqtSlot(str)
    def setBrandFilter(self, brand):
        value = str(brand or "Todas").strip() or "Todas"
        if value not in self._brands:
            value = "Todas"
        if self._current_filter == value:
            return
        self._current_filter = value
        self.filterChanged.emit()
        self._apply_filter()

    @pyqtSlot(int)
    def selectDriver(self, row):
        if row < 0:
            self._selected_driver = None
            self._current_index = -1
            self.currentIndexChanged.emit()
            self.selectedChanged.emit()
            return

        filtered = []
        for driver in self._all_drivers:
            if not isinstance(driver, dict):
                continue
            brand = str(driver.get("brand") or "").strip()
            if self._current_filter != "Todas" and brand != self._current_filter:
                continue
            filtered.append(driver)

        if row >= len(filtered):
            return

        self._selected_driver = filtered[row]
        self._current_index = row
        self.currentIndexChanged.emit()
        self.selectedChanged.emit()
        self._set_status(f"Seleccionado {self.selectedTitle}.")

    @pyqtSlot()
    def downloadSelected(self):
        driver = self._selected_driver
        backend = self.window.resolve_driver_backend()
        if not driver or not backend:
            self._set_status("Selecciona un driver antes de descargar.")
            return

        default_name = f"{driver.get('brand', 'driver')}_v{driver.get('version', 'N/A')}.exe"
        file_path, _ = QFileDialog.getSaveFileName(
            self.window,
            "Guardar driver",
            default_name,
            "Executable (*.exe);;All Files (*.*)"
        )
        if not file_path:
            return

        self._set_busy(True)
        try:
            backend.download_driver(driver.get("key"), file_path)
            self._set_status(f"Descarga completada: {Path(file_path).name}")
        except Exception as error:
            logger.error("Error descargando driver en v2", details=str(error), exc_info=True)
            QMessageBox.critical(self.window, "Error", f"No se pudo descargar el driver:\n{error}")
            self._set_status(f"Error de descarga: {error}")
        finally:
            self._set_busy(False)

    @pyqtSlot()
    def installSelected(self):
        driver = self._selected_driver
        backend = self.window.resolve_driver_backend()
        if not driver or not backend:
            self._set_status("Selecciona un driver antes de instalar.")
            return

        reply = QMessageBox.question(
            self.window,
            "Instalar driver",
            f"Se descargara e instalara {driver.get('brand', 'Driver')} v{driver.get('version', 'N/A')}.\n\n¿Deseas continuar?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        target = self.window.cache_dir / f"{driver.get('brand', 'driver')}_v{driver.get('version', 'N/A')}.exe"
        self._set_busy(True)
        try:
            backend.download_driver(driver.get("key"), str(target))
            self.window.installer.install_driver(str(target))
            self._set_status(f"Instalacion lanzada para {target.name}")
        except Exception as error:
            logger.error("Error instalando driver en v2", details=str(error), exc_info=True)
            QMessageBox.critical(self.window, "Error", f"No se pudo instalar el driver:\n{error}")
            self._set_status(f"Error de instalacion: {error}")
        finally:
            self._set_busy(False)

    @pyqtSlot()
    def openQrGenerator(self):
        self.window.show_qr_generator_dialog()

    @pyqtSlot()
    def associateAsset(self):
        self.window.show_asset_link_dialog()

    @pyqtSlot()
    def manageAssets(self):
        self.window.show_asset_management_dialog()

    @pyqtSlot()
    def uploadDriver(self):
        if not bool(getattr(self.window, "is_admin", False)):
            QMessageBox.warning(
                self.window,
                "Acceso denegado",
                "La carga administrativa requiere un usuario administrador.",
            )
            self._set_status("Carga cancelada: requiere permisos de administracion.")
            return

        backend = self.window.resolve_driver_backend()
        if not backend:
            self._set_status("No hay backend disponible para subir drivers.")
            return

        file_path, _ = QFileDialog.getOpenFileName(
            self.window,
            "Seleccionar driver",
            "",
            "Drivers (*.exe *.zip *.msi);;Executables (*.exe);;ZIP Files (*.zip);;MSI Files (*.msi);;All Files (*.*)",
        )
        if not file_path:
            return

        metadata_dialog = QuickUploadDialog(file_path, self.window)
        if metadata_dialog.exec() != metadata_dialog.DialogCode.Accepted:
            return

        payload = metadata_dialog.get_data()
        self._set_busy(True)
        self._set_upload_progress(0)
        try:
            backend.upload_driver(
                file_path,
                payload["brand"],
                payload["version"],
                payload.get("description", ""),
                progress_callback=self._set_upload_progress,
            )
            self.refreshDrivers()
            self._set_status(
                f"Driver publicado: {payload['brand']} v{payload['version']}"
            )
            if getattr(self.window, "user_manager", None) and self.window.user_manager.current_user:
                self.window.user_manager._log_access(
                    action="upload_driver_success",
                    username=self.window.user_manager.current_user.get("username"),
                    success=True,
                    details={
                        "driver_brand": payload["brand"],
                        "driver_version": payload["version"],
                        "driver_description": payload.get("description", ""),
                    },
                )
            UploadSuccessDialog(payload, self.window).exec()
        except Exception as error:
            logger.error("Error subiendo driver en v2", details=str(error), exc_info=True)
            if getattr(self.window, "user_manager", None) and self.window.user_manager.current_user:
                self.window.user_manager._log_access(
                    action="upload_driver_failed",
                    username=self.window.user_manager.current_user.get("username"),
                    success=False,
                    details={
                        "driver_brand": payload.get("brand", ""),
                        "driver_version": payload.get("version", ""),
                        "error": str(error),
                    },
                )
            QMessageBox.critical(self.window, "Error", f"No se pudo subir el driver:\n{error}")
            self._set_status(f"Error de carga: {error}")
        finally:
            self._set_upload_progress(-1)
            self._set_busy(False)
