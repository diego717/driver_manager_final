"""
Gestor de descargas y subidas para Driver Manager
"""

from PyQt6.QtCore import QThread, pyqtSignal

from core.logger import get_logger

logger = get_logger()

class DownloadThread(QThread):
    """Thread para descargar drivers sin bloquear la UI"""
    progress = pyqtSignal(int)
    finished = pyqtSignal(str)
    error = pyqtSignal(str)
    
    def __init__(self, cloud_manager, driver_key, local_path):
        super().__init__()
        self.cloud_manager = cloud_manager
        self.driver_key = driver_key
        self.local_path = local_path
    
    def run(self):
        logger.operation_start("download_driver_thread", key=self.driver_key)
        try:
            if self.cloud_manager is None:
                raise ValueError("Cloud manager no configurado")
            self.cloud_manager.download_driver(
                self.driver_key, 
                self.local_path,
                progress_callback=lambda p: self.progress.emit(p)
            )
            logger.operation_end("download_driver_thread", success=True)
            self.finished.emit(self.local_path)
        except Exception as e:
            logger.error(f"Error en descarga: {e}", exc_info=True)
            self.error.emit(str(e))


class UploadThread(QThread):
    """Thread para subir drivers sin bloquear la UI"""
    progress = pyqtSignal(int)
    finished = pyqtSignal(dict)
    error = pyqtSignal(str, dict)
    
    def __init__(self, cloud_manager, local_file, brand, version, description):
        super().__init__()
        self.cloud_manager = cloud_manager
        self.local_file = local_file
        self.brand = brand
        self.version = version
        self.description = description
    
    def run(self):
        logger.operation_start("upload_driver_thread", file=self.local_file)
        upload_info = {
            'file_path': self.local_file,
            'brand': self.brand,
            'version': self.version,
            'description': self.description
        }
        try:
            if self.cloud_manager is None:
                raise ValueError("Cloud manager no configurado")
            self.cloud_manager.upload_driver(
                self.local_file,
                self.brand,
                self.version,
                self.description,
                progress_callback=lambda p: self.progress.emit(p)
            )
            logger.operation_end("upload_driver_thread", success=True)
            self.finished.emit(upload_info)
        except Exception as e:
            logger.error(f"Error en subida: {e}", exc_info=True)
            self.error.emit(str(e), upload_info)


class DownloadManager:
    """Gestor de descargas y subidas"""
    
    def __init__(self, parent):
        self.parent = parent
        self.download_thread = None
        self.upload_thread = None
    
    def start_download(self, driver, local_path, install=False):
        """Iniciar descarga en thread separado"""
        if self.parent.cloud_manager is None:
            error_msg = "Cloud manager no configurado"
            logger.error(error_msg, driver_key=driver.get('key') if isinstance(driver, dict) else None)
            self.parent.progress_bar.setVisible(False)
            self.parent.statusBar().showMessage("❌ Error de descarga")
            self.parent.on_download_error(error_msg)
            return False

        logger.info(f"Iniciando descarga: {driver.get('brand')} {driver.get('version')}", 
                   driver_key=driver.get('key'))
        self.parent.progress_bar.setVisible(True)
        self.parent.progress_bar.setValue(0)
        self.parent.statusBar().showMessage("Descargando...")
        
        self.download_thread = DownloadThread(
            self.parent.cloud_manager,
            driver['key'],
            local_path
        )
        
        self.download_thread.progress.connect(self.parent.progress_bar.setValue)
        self.download_thread.finished.connect(
            lambda path: self.parent.on_download_finished(path, install, driver)
        )
        self.download_thread.error.connect(self.parent.on_download_error)
        self.download_thread.start()
        return True
    
    def start_upload(self, local_file, brand, version, description):
        """Iniciar subida en thread separado"""
        if self.parent.cloud_manager is None:
            error_msg = "Cloud manager no configurado"
            logger.error(error_msg, file=local_file, brand=brand, version=version)
            self.parent.progress_bar.setVisible(False)
            self.parent.statusBar().showMessage("❌ Error en subida")
            try:
                self.parent.on_upload_error(error_msg, {
                    'file_path': local_file,
                    'brand': brand,
                    'version': version,
                    'description': description
                })
            except TypeError:
                self.parent.on_upload_error(error_msg)
            return False

        logger.info(f"Iniciando subida: {local_file}", brand=brand, version=version)
        self.parent.progress_bar.setVisible(True)
        self.parent.progress_bar.setValue(0)
        self.parent.statusBar().showMessage("Subiendo driver...")
        
        self.upload_thread = UploadThread(
            self.parent.cloud_manager,
            local_file,
            brand,
            version,
            description
        )
        
        self.upload_thread.progress.connect(self.parent.progress_bar.setValue)
        self.upload_thread.finished.connect(self.parent.on_upload_finished)
        self.upload_thread.error.connect(self.parent.on_upload_error)
        self.upload_thread.start()
        return True

    def cancel_download(self):
        """Cancelar descarga en progreso."""
        if not self.download_thread:
            return False

        try:
            if self.download_thread.isRunning():
                self.download_thread.requestInterruption()
                self.download_thread.terminate()
                self.download_thread.wait(2000)
            self.parent.progress_bar.setVisible(False)
            self.parent.statusBar().showMessage("Descarga cancelada")
            return True
        except Exception as e:
            logger.error(f"Error cancelando descarga: {e}", exc_info=True)
            return False
