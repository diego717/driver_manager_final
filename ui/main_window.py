
import sys
import json
import gc
from pathlib import Path
from datetime import datetime, timedelta

from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QTabWidget, QProgressBar, QMessageBox, QListWidgetItem, QLabel, QPushButton,
                             QDialog, QGroupBox, QLineEdit, QInputDialog, QFileDialog)
from PyQt6.QtCore import Qt, QObject, pyqtSignal, QRunnable, QThreadPool
from PyQt6.QtGui import QFont, QPixmap, QIcon

# Importar módulos personalizados
from managers.cloud_manager import CloudflareR2Manager
from managers.installer import DriverInstaller
from managers.history_manager import InstallationHistory
from reports.report_generator import ReportGenerator

# Importar módulos refactorizados
from core.security_manager import SecurityManager
from managers.download_manager import DownloadManager
from handlers.event_handlers import EventHandlers
from handlers.report_handlers import ReportHandlers
from managers.user_manager_v2 import UserManagerV2
from ui.dialogs.user_management_ui import UserManagementDialog, LoginDialog
from ui.ui_components import DriversTab, HistoryTab, AdminTab, EditInstallationDialog
from ui.theme_manager import ThemeManager
from core.config_manager import ConfigManager
from core.logger import get_logger

logger = get_logger()


class _ThumbnailWorkerSignals(QObject):
    """Señales para carga asíncrona de miniaturas."""

    loaded = pyqtSignal(int, bytes)
    failed = pyqtSignal(int, str)


class _ThumbnailWorker(QRunnable):
    """Worker de fondo para descargar bytes de foto sin bloquear UI."""

    def __init__(self, history, photo_id):
        super().__init__()
        self.history = history
        self.photo_id = photo_id
        self.signals = _ThumbnailWorkerSignals()

    def run(self):
        try:
            photo_bytes, _content_type = self.history.get_photo_content(self.photo_id)
            self.signals.loaded.emit(self.photo_id, photo_bytes)
        except Exception as e:
            self.signals.failed.emit(self.photo_id, str(e))



# Configuración portable
PORTABLE_CONFIG = None
PORTABLE_MODE = False

try:
    from utils.portable import (
        get_config, is_configured, AUTO_CONFIGURE, 
        PORTABLE_MODE as PM, get_cache_dir
    )
    if is_configured():
        PORTABLE_CONFIG = get_config()
        PORTABLE_MODE = PM
        logger.info("Configuración portable detectada y cargada")
except ImportError:
    logger.info("Sin configuración portable. Usando modo normal.")
except Exception as e:
    logger.warning(f"Error cargando configuración portable: {e}")
class MainWindow(QMainWindow):
    """Ventana principal de Driver Manager"""
    
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Driver Manager - Impresoras de Tarjetas")
        self.setGeometry(100, 100, 1000, 700)
        
        # 1. Crear ConfigManager
        self.config_manager = ConfigManager(self)
        
        # 2. Inicializar managers
        self._init_managers()
        
        # 3. Inicializar UI (Debe estar antes de aplicar la config para poder rellenar los campos)
        self._init_ui()
        
        # 4. Inicializar manejadores de eventos
        self._init_handlers()
        
        # 5. Configurar conexiones de señales
        self._setup_connections()
        
        # 6. Cargar configuracion portable al inicio
        self.check_portable_config_startup()
        
        # 7. Aplicar tema inicial
        self.apply_theme()
        
    def check_portable_config_startup(self):
        """
        Detecta el JSON portable, inyecta las credenciales de forma cifrada 
        en el USB y elimina el JSON original para no dejar rastro.
        """
        
        # Detectar ruta del USB (funciona en script y en .exe)
        if getattr(sys, 'frozen', False):
            root_dir = Path(sys.executable).parent
        else:
            root_dir = Path(sys.argv[0]).parent
            
        portable_path = root_dir / "portable_config.json"
        
        if portable_path.exists():
            try:
                # 1. Leer y cerrar el archivo inmediatamente para liberar el bloqueo de Windows
                # Accept JSON files saved with or without UTF-8 BOM.
                with open(portable_path, 'r', encoding='utf-8-sig') as f:
                    config_data = json.load(f)
                
                # 2. Validar datos mínimos
                if config_data and config_data.get('account_id'):
                    logger.info("🚀 Configuración portable detectada. Inyectando en el USB...")
                    
                    # 3. Inyectar y Guardar en config.enc
                    if self.config_manager.apply_portable_config(config_data):
                        
                        # 4. Asegurar que otros managers tengan la nueva conexión
                        if hasattr(self, 'user_manager') and self.user_manager:
                            self.user_manager.cloud_manager = self.cloud_manager
                        
                        # 5. 🔐 LIMPIEZA DE SEGURIDAD
                        # Forzamos al recolector de basura para soltar cualquier referencia al archivo
                        gc.collect() 
                        
                        try:
                            portable_path.unlink()
                            logger.info("🔐 SEGURIDAD: 'portable_config.json' eliminado tras inyección exitosa.")
                            self.statusBar().showMessage("✅ Configuración portable protegida en USB", 5000)
                        except Exception as e:
                            logger.warning(f"⚠️ El sistema inyectó los datos pero no pudo borrar el JSON: {e}")
                            logger.warning("👉 Por seguridad, borra 'portable_config.json' manualmente.")
                else:
                    logger.warning("⚠️ JSON portable encontrado pero incompleto.")
                    self.config_manager.init_cloud_connection()
                    
            except Exception as e:
                logger.critical(f"❌ Error crítico procesando configuración portable: {e}")
                self.config_manager.init_cloud_connection()
        else:
            # Si no existe el JSON, intentamos cargar la caja fuerte (.enc) que ya debería estar en el USB
            logger.info("ℹ️ Iniciando sin archivo portable. Buscando almacenamiento cifrado...")
            self.config_manager.init_cloud_connection()
    def _check_user_initialization(self):
        """Verificar y ejecutar configuración inicial de usuarios si es necesario"""
        # Usar modo local inicialmente (antes de tener cloud_manager)
        audit_client = self.history_manager or InstallationHistory(self.config_manager)
        temp_user_manager = UserManagerV2(cloud_manager=self.cloud_manager, 
                                   security_manager=self.security_manager,
                                   local_mode=False,
                                   audit_api_client=audit_client)  # Usar modo nube
        
        # Verificar si necesita inicialización
        if temp_user_manager.needs_initialization():
            self._show_setup_wizard(temp_user_manager)
    def _show_setup_wizard(self, user_manager, exit_on_cancel=True):
        """Mostrar wizard de configuración inicial"""
        from ui.dialogs.user_setup_wizard import show_user_setup_wizard
        
        user_data = show_user_setup_wizard(None)
        
        if user_data:
            success, message = user_manager.initialize_system(
                user_data['username'],
                user_data['password']
            )
            
            if success:
                QMessageBox.information(
                    None,
                    "Configuración Completa",
                    "✅ Sistema inicializado correctamente.\n\n"
                    "Ya puedes usar Driver Manager."
                )
            else:
                QMessageBox.critical(
                    None,
                    "Error",
                    f"❌ {message}"
                )
        else:
            # Usuario canceló el wizard
            if exit_on_cancel:
                sys.exit(0)
            logger.info("Wizard de configuración inicial cancelado por el usuario.")

    def _init_managers(self):
        """Inicializar todos los managers"""
        
        self.cloud_manager = None
        self.history_manager = None
        # Reusar la misma instancia de seguridad del ConfigManager para compartir
        # clave maestra/fernet ya inicializados al cargar config.enc.
        self.security_manager = self.config_manager.security
        self.theme_manager = ThemeManager()  # Gestor de temas
        self.user_manager = None  # Se inicializará después de cloud_manager
        self.installer = DriverInstaller()
        self.history = InstallationHistory(self.config_manager)
        self.report_gen = ReportGenerator(self.history)
        self.is_authenticated = False
        self.is_admin = False
        self.installation_start_time = None
        self._audit_logs_repair_attempted = False
        self._photo_thumbnail_cache = {}
        self._thumbnail_inflight = set()
        self._thumbnail_item_map = {}
        self._thumbnail_pool = QThreadPool.globalInstance()
        
        # Cache local
        if PORTABLE_MODE and PORTABLE_CONFIG:
            try:
                self.cache_dir = get_cache_dir()
                logger.info(f"Usando caché portable: {self.cache_dir}")
            except:
                self.cache_dir = Path.home() / ".driver_manager" / "cache"
        else:
            self.cache_dir = Path.home() / ".driver_manager" / "cache"
        
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def _init_ui(self):
        """Inicializar interfaz de usuario"""
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        
        # Header
        header = QLabel("🖨️ Gestor de Drivers - Impresoras de Tarjetas")
        header.setFont(QFont("Arial", 16, QFont.Weight.Bold))
        header.setAlignment(Qt.AlignmentFlag.AlignCenter)
        main_layout.addWidget(header)
        
        # Tabs
        self.tabs = QTabWidget()
        main_layout.addWidget(self.tabs)
        
        # Crear tabs usando los componentes refactorizados
        self.drivers_tab = DriversTab(self)
        self.tabs.addTab(self.drivers_tab, "📦 Drivers Disponibles")
        
        self.history_tab = HistoryTab(self)
        self.tabs.addTab(self.history_tab, "📊 Historial y Reportes")
        
        self.admin_tab = AdminTab(self)
        self.tabs.addTab(self.admin_tab, "🔐 Administración")
        
        # Status bar
        self.statusBar().showMessage("Listo")
        
        # Progress bar
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        main_layout.addWidget(self.progress_bar)
    
    def _init_handlers(self):
        """Inicializar manejadores"""
        self.download_manager = DownloadManager(self)
        self.event_handlers = EventHandlers(self)
        self.report_handlers = ReportHandlers(self)
        
    def _setup_connections(self):
        """Configurar conexiones de señales"""
        # Drivers tab
        self.drivers_tab.brand_filter.currentTextChanged.connect(self.filter_drivers)
        self.drivers_tab.drivers_list.itemDoubleClicked.connect(self.event_handlers.on_driver_double_click)
        self.drivers_tab.drivers_list.itemSelectionChanged.connect(self.event_handlers.on_driver_selected)
        self.drivers_tab.download_btn.clicked.connect(self.event_handlers.download_driver)
        self.drivers_tab.install_btn.clicked.connect(self.event_handlers.download_and_install)
        if hasattr(self.drivers_tab, "refresh_btn"):
            self.drivers_tab.refresh_btn.clicked.connect(self.refresh_drivers_list)
        
        # History tab
        self.history_tab.history_view_combo.currentTextChanged.connect(self.on_history_view_changed)
        self.history_tab.history_list.currentItemChanged.connect(self._on_history_item_changed)
        self.history_tab.create_manual_button.clicked.connect(self.create_manual_history_record)
        self.history_tab.edit_button.clicked.connect(self.show_edit_installation_dialog)
        if hasattr(self.history_tab, "view_incidents_button"):
            self.history_tab.view_incidents_button.clicked.connect(self.show_incidents_for_selected_record)
        if hasattr(self.history_tab, "incidents_installations_list"):
            self.history_tab.incidents_installations_list.currentItemChanged.connect(
                self._on_incidents_installation_changed
            )
        if hasattr(self.history_tab, "incidents_list"):
            self.history_tab.incidents_list.currentItemChanged.connect(self._on_incident_item_changed)
        if hasattr(self.history_tab, "incident_photos_list"):
            self.history_tab.incident_photos_list.itemDoubleClicked.connect(
                lambda _item: self.view_selected_incident_photo()
            )
            self.history_tab.incident_photos_list.currentItemChanged.connect(
                lambda current, _previous=None: self.history_tab.view_incident_photo_btn.setEnabled(current is not None)
            )
        if hasattr(self.history_tab, "refresh_incidents_view_btn"):
            self.history_tab.refresh_incidents_view_btn.clicked.connect(self.refresh_incidents_view)
        if hasattr(self.history_tab, "apply_incidents_filters_btn"):
            self.history_tab.apply_incidents_filters_btn.clicked.connect(self.apply_incidents_filters)
        if hasattr(self.history_tab, "incidents_severity_filter"):
            self.history_tab.incidents_severity_filter.currentTextChanged.connect(
                lambda _value: self.apply_incidents_filters()
            )
        if hasattr(self.history_tab, "incidents_period_filter"):
            self.history_tab.incidents_period_filter.currentTextChanged.connect(
                lambda _value: self.apply_incidents_filters()
            )
        if hasattr(self.history_tab, "create_incident_btn"):
            self.history_tab.create_incident_btn.clicked.connect(self.create_incident_from_incidents_view)
        if hasattr(self.history_tab, "upload_incident_photo_btn"):
            self.history_tab.upload_incident_photo_btn.clicked.connect(self.upload_photo_for_selected_incident)
        if hasattr(self.history_tab, "view_incident_photo_btn"):
            self.history_tab.view_incident_photo_btn.clicked.connect(self.view_selected_incident_photo)

        # Conexiones para la pestaña de gestion de registros
        self.history_tab.management_history_list.currentItemChanged.connect(
            lambda item: self.history_tab.delete_selected_btn.setEnabled(
                item is not None and self.user_manager and self.user_manager.is_super_admin()
            )
        )
        self.history_tab.delete_selected_btn.clicked.connect(self.delete_selected_history_record)
        
        # Conectar botón actualizar del historial
        for widget in self.history_tab.findChildren(QPushButton):
            if "Actualizar" in widget.text() and "Generar" not in widget.text():
                widget.clicked.connect(self.refresh_current_history_view)
        
        # Admin tab
        self.admin_tab.login_btn.clicked.connect(self.show_login_dialog)
        self.admin_tab.logout_btn.clicked.connect(self.on_admin_logout)
        
        # Conectar botones de visibilidad en admin tab
        self.admin_tab.show_account_btn.clicked.connect(
            lambda: self.event_handlers.toggle_visibility(
                self.admin_tab.admin_account_id_input, 
                self.admin_tab.show_account_btn
            )
        )
        self.admin_tab.show_access_btn.clicked.connect(
            lambda: self.event_handlers.toggle_visibility(
                self.admin_tab.admin_access_key_input, 
                self.admin_tab.show_access_btn
            )
        )
        self.admin_tab.show_secret_btn.clicked.connect(
            lambda: self.event_handlers.toggle_visibility(
                self.admin_tab.admin_secret_key_input, 
                self.admin_tab.show_secret_btn
            )
        )
        if hasattr(self.admin_tab, "show_api_token_btn"):
            self.admin_tab.show_api_token_btn.clicked.connect(
                lambda: self.event_handlers.toggle_visibility(
                    self.admin_tab.admin_api_token_input,
                    self.admin_tab.show_api_token_btn
                )
            )
        if hasattr(self.admin_tab, "show_api_secret_btn"):
            self.admin_tab.show_api_secret_btn.clicked.connect(
                lambda: self.event_handlers.toggle_visibility(
                    self.admin_tab.admin_api_secret_input,
                    self.admin_tab.show_api_secret_btn
                )
            )
        
        # CONEXIONES FALTANTES - Admin tab botones R2
        # Buscar y conectar botones por texto
        for widget in self.admin_tab.findChildren(QPushButton):
            if "Guardar Configuración R2" in widget.text():
                widget.clicked.connect(self.event_handlers.save_r2_config)
            elif "Probar Conexión" in widget.text():
                widget.clicked.connect(self.test_r2_connection)
            elif "❌ Eliminar Seleccionado" in widget.text():
                widget.clicked.connect(self.delete_driver)
            elif "Gestionar Usuarios" in widget.text():
                widget.clicked.connect(self.show_user_management)
            elif "Cambiar Contraseña" in widget.text():
                widget.clicked.connect(self.event_handlers.change_admin_password)
            elif "Limpiar Caché" in widget.text():
                widget.clicked.connect(self.event_handlers.clear_cache)
        
        # Conectar botones de subida en DriversTab
        for widget in self.drivers_tab.findChildren(QPushButton):
            if "📁 Seleccionar Archivo" in widget.text():
                widget.clicked.connect(self.select_driver_file)
            elif "☁️ Subir a la Nube" in widget.text():
                widget.clicked.connect(self.upload_driver)
        
        # Conectar selector de tema
        if hasattr(self.admin_tab, 'theme_combo'):
            self.admin_tab.theme_combo.currentTextChanged.connect(self.change_theme)
            # Establecer tema actual
            current_theme = "Oscuro" if self.theme_manager.get_current_theme() == "dark" else "Claro"
            self.admin_tab.theme_combo.setCurrentText(current_theme)
        
        # History tab - reportes
        if hasattr(self.history_tab, "daily_report_btn"):
            self.history_tab.daily_report_btn.clicked.connect(
                self.report_handlers.generate_daily_report_simple
            )
        if hasattr(self.history_tab, "monthly_report_btn"):
            self.history_tab.monthly_report_btn.clicked.connect(
                self.report_handlers.generate_monthly_report_simple
            )
        if hasattr(self.history_tab, "yearly_report_btn"):
            self.history_tab.yearly_report_btn.clicked.connect(
                self.report_handlers.generate_yearly_report_simple
            )
        if hasattr(self.history_tab, "report_month_combo"):
            self.history_tab.report_month_combo.currentIndexChanged.connect(
                lambda _idx: self.report_handlers.refresh_reports_preview()
            )
        if hasattr(self.history_tab, "report_year_combo"):
            self.history_tab.report_year_combo.currentIndexChanged.connect(
                lambda _idx: self.report_handlers.refresh_reports_preview()
            )
    
    def load_config_data(self):
        """Cargar configuración desde archivo"""
        return self.config_manager.load_config_data()
    
    def init_cloud_connection(self):
        """Inicializar conexión con Cloudflare R2 y D1 History"""
        config = self.load_config_data()
        
        if config:
            # 1. Conexión a R2 (Drivers y Usuarios)
            self.cloud_manager = CloudflareR2Manager(
                account_id=config.get('account_id'),
                access_key_id=config.get('access_key_id'),
                secret_access_key=config.get('secret_access_key'),
                bucket_name=config.get('bucket_name')
            )

            # 2. Inicializar cliente D1 para auditoría antes de crear UserManager
            # para evitar fallback legacy de logs en modo producción.
            self.history_manager = InstallationHistory(self.config_manager)
            
            # 3. Inicializar el UserManagerV2
            # Intentar modo nube primero, fallback a local
            self.user_manager = UserManagerV2(
                self.cloud_manager, 
                self.security_manager,
                local_mode=False,
                audit_api_client=self.history_manager
            )
            
            try:
                # Verificar si hay usuarios (load_users no existe en V2, usamos has_users o similar)
                # Nota: UserManagerV2 carga bajo demanda, aquí forzamos verificación
                if self.user_manager.has_users():
                    logger.info("✅ Usuarios detectados en la nube.")
                else:
                    raise Exception("No hay usuarios")
                logger.info("✅ Usuarios cargados desde la nube.")
            except Exception as e:
                logger.warning(
                    f"⚠️ No se pudo validar usuarios en la nube: {e}. "
                    "Se requiere configuración inicial por asistente."
                )
                if self.user_manager.needs_initialization():
                    self._show_setup_wizard(self.user_manager, exit_on_cancel=False)
                    if self.user_manager.needs_initialization():
                        logger.warning(
                            "Inicialización de usuarios pendiente. "
                            "No se continuará hasta completar el asistente."
                        )
                        self.statusBar().showMessage(
                            "⚠️ Completa la configuración inicial de usuarios."
                        )
                        return
                    logger.info("✅ Sistema de usuarios inicializado mediante asistente.")
            
            self.refresh_drivers_list()
            self.statusBar().showMessage("✅ Conectado a Cloudflare (R2 + D1 History)")
        else:
            self.statusBar().showMessage("❌ No se pudo cargar la configuración")

    def refresh_drivers_list(self):
        """Actualizar lista de drivers"""
        if not self.cloud_manager:
            return
        
        try:
            drivers = self.cloud_manager.list_drivers()
            self.all_drivers = drivers

            # Actualizar dinámicamente el filtro de marcas
            current_brand = self.drivers_tab.brand_filter.currentText()
            brands = sorted(list(set(d['brand'] for d in drivers if 'brand' in d)))

            self.drivers_tab.brand_filter.blockSignals(True)
            self.drivers_tab.brand_filter.clear()
            self.drivers_tab.brand_filter.addItem("Todas")
            self.drivers_tab.brand_filter.addItems(brands)

            # Intentar restaurar la selección previa
            index = self.drivers_tab.brand_filter.findText(current_brand)
            if index >= 0:
                self.drivers_tab.brand_filter.setCurrentIndex(index)
            else:
                self.drivers_tab.brand_filter.setCurrentIndex(0)
            self.drivers_tab.brand_filter.blockSignals(False)

            self.filter_drivers()
            self.statusBar().showMessage(f"✅ {len(drivers)} drivers encontrados")
            
            if self.is_admin:
                self.event_handlers.update_admin_drivers_list(drivers)
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Error al cargar drivers:\n{str(e)}")
    
    def filter_drivers(self):
        """Filtrar drivers por marca"""
        self.drivers_tab.drivers_list.clear()
        brand_filter = self.drivers_tab.brand_filter.currentText()
        
        if not hasattr(self, 'all_drivers'):
            return
        
        for driver in self.all_drivers:
            if brand_filter == "Todas" or driver['brand'] == brand_filter:
                item = QListWidgetItem(f"{driver['brand']} - v{driver['version']}")
                item.setData(Qt.ItemDataRole.UserRole, driver)
                self.drivers_tab.drivers_list.addItem(item)
    
    def on_history_view_changed(self, view_name):
        """Cambiar vista del historial."""
        _ = view_name
        current_index = self.history_tab.history_view_combo.currentIndex()
        self.history_tab.history_stack.setCurrentIndex(current_index)

        # 3: Incidencias, 4: Reportes, 5: Gestión de Registros
        if current_index == 5:
            self._update_management_stats()
            self.refresh_history_view()
        elif current_index == 4:
            self.report_handlers.refresh_reports_preview()
        elif current_index == 3:
            self.refresh_incidents_view()

    def _on_history_item_changed(self, item, _previous=None):
        """Sincronizar estado de botones según selección de historial."""
        has_selection = item is not None
        self.history_tab.edit_button.setEnabled(has_selection and self.is_admin)
        if hasattr(self.history_tab, "view_incidents_button"):
            self.history_tab.view_incidents_button.setEnabled(has_selection)

    def refresh_history_view(self):
        """Actualizar vista actual del historial"""
        try:
            installations = self.history.get_installations(limit=10)
            self.history_tab.history_list.clear()
            self.history_tab.edit_button.setEnabled(False)
            if hasattr(self.history_tab, "view_incidents_button"):
                self.history_tab.view_incidents_button.setEnabled(False)
            
            for inst in installations:
                timestamp = datetime.fromisoformat(inst['timestamp'])
                date_str = timestamp.strftime('%d/%m/%Y %H:%M')
                status = (inst.get('status') or '').lower()
                if status == 'success':
                    status_icon = "✓"
                elif status == 'failed':
                    status_icon = "✗"
                else:
                    status_icon = "•"
                
                brand = inst.get('driver_brand') or "N/A"
                version = inst.get('driver_version') or "N/A"
                text = f"{status_icon} {date_str} - {brand} v{version}"
                if inst['client_name']:
                    text += f" ({inst['client_name']})"
                
                item = QListWidgetItem(text)
                item.setData(Qt.ItemDataRole.UserRole, inst['id']) # Guardamos el ID
                self.history_tab.history_list.addItem(item)
        except Exception as e:
            logger.error(f"Error cargando historial: {e}", exc_info=True)
    
    def refresh_current_history_view(self):
        """Actualizar la vista actual del historial incluyendo estadísticas."""
        current_index = self.history_tab.history_view_combo.currentIndex()

        if current_index == 5:
            self._update_management_stats()
        elif current_index == 3:
            self.refresh_incidents_view()
        else:
            self.refresh_history_view()

    def _parse_limit_from_text(self, limit_text, default=10):
        """Convertir etiqueta de límite a entero."""
        if not limit_text:
            return default
        for token in ("10", "25", "50", "100", "200"):
            if token in str(limit_text):
                return int(token)
        return default

    def _parse_incident_datetime(self, raw_value):
        """Parsear fecha ISO de incidente de manera tolerante."""
        if not raw_value:
            return None
        raw = str(raw_value).strip()
        if raw.endswith("Z"):
            raw = f"{raw[:-1]}+00:00"
        try:
            dt = datetime.fromisoformat(raw)
        except ValueError:
            return None
        if dt.tzinfo is not None:
            return dt.astimezone().replace(tzinfo=None)
        return dt

    def _period_days_from_text(self, period_text):
        """Mapear etiqueta de periodo a días."""
        label = str(period_text or "").strip().lower()
        if "7" in label:
            return 7
        if "30" in label:
            return 30
        if "90" in label:
            return 90
        return None

    def apply_incidents_filters(self):
        """Aplicar filtros sobre incidencias de la instalación seleccionada."""
        if not hasattr(self.history_tab, "incidents_installations_list"):
            return
        current_installation = self.history_tab.incidents_installations_list.currentItem()
        self._on_incidents_installation_changed(current_installation)

    def _build_photo_thumbnail_icon(self, photo_id):
        """Obtener miniatura desde caché, sin bloquear UI."""
        return self._photo_thumbnail_cache.get(photo_id)

    def _icon_from_photo_bytes(self, photo_bytes):
        """Crear QIcon thumbnail a partir de bytes de imagen."""
        pixmap = QPixmap()
        if not pixmap.loadFromData(photo_bytes):
            return None
        thumb = pixmap.scaled(
            96,
            72,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        return QIcon(thumb)

    def _queue_thumbnail_load(self, photo_id):
        """Encolar descarga de miniatura si no está en caché ni en curso."""
        if photo_id in self._photo_thumbnail_cache:
            return
        if photo_id in self._thumbnail_inflight:
            return

        self._thumbnail_inflight.add(photo_id)
        worker = _ThumbnailWorker(self.history, photo_id)
        worker.signals.loaded.connect(self._on_thumbnail_loaded)
        worker.signals.failed.connect(self._on_thumbnail_failed)
        self._thumbnail_pool.start(worker)

    def _on_thumbnail_loaded(self, photo_id, photo_bytes):
        """Aplicar miniatura descargada en segundo plano."""
        self._thumbnail_inflight.discard(photo_id)
        icon = self._icon_from_photo_bytes(photo_bytes)
        if icon is None:
            return

        self._photo_thumbnail_cache[photo_id] = icon
        item = self._thumbnail_item_map.get(photo_id)
        if item is None:
            return

        try:
            if self.history_tab.incident_photos_list.row(item) >= 0:
                item.setIcon(icon)
        except Exception:
            # Si la lista cambió mientras cargaba la miniatura, no hacemos nada.
            pass

    def _on_thumbnail_failed(self, photo_id, _error):
        """Liberar estado de tareas fallidas para permitir reintento."""
        self._thumbnail_inflight.discard(photo_id)

    def refresh_incidents_view(self, preferred_record_id=None):
        """Cargar instalaciones para la vista de incidencias."""
        if not hasattr(self.history_tab, "incidents_installations_list"):
            return

        current_item = self.history_tab.incidents_installations_list.currentItem()
        if preferred_record_id is None and current_item is not None:
            current_data = current_item.data(Qt.ItemDataRole.UserRole)
            if isinstance(current_data, dict):
                preferred_record_id = current_data.get("id")

        limit_text = self.history_tab.incidents_installations_limit.currentText()
        limit = self._parse_limit_from_text(limit_text, default=25)

        self.history_tab.incidents_installations_list.clear()
        self.history_tab.incidents_list.clear()
        self.history_tab.incident_photos_list.clear()
        self._thumbnail_item_map.clear()
        self.history_tab.incident_detail.clear()
        self.history_tab.upload_incident_photo_btn.setEnabled(False)
        self.history_tab.view_incident_photo_btn.setEnabled(False)
        if hasattr(self.history_tab, "create_incident_btn"):
            self.history_tab.create_incident_btn.setEnabled(False)

        try:
            installations = self.history.get_installations(limit=limit)
        except Exception as e:
            self.history_tab.incident_detail.setText(f"Error cargando instalaciones: {e}")
            return

        selected_item = None
        for inst in installations:
            timestamp_raw = inst.get("timestamp")
            date_str = str(timestamp_raw or "")
            try:
                date_str = datetime.fromisoformat(str(timestamp_raw)).strftime("%d/%m/%Y %H:%M")
            except Exception:
                pass

            status = (inst.get("status") or "").lower()
            if status == "success":
                status_icon = "✓"
            elif status == "failed":
                status_icon = "✗"
            else:
                status_icon = "•"

            record_id = inst.get("id")
            brand = inst.get("driver_brand") or "N/A"
            version = inst.get("driver_version") or "N/A"
            client = inst.get("client_name") or "Sin cliente"
            text = f"#{record_id} {status_icon} {date_str} - {brand} v{version} ({client})"

            item = QListWidgetItem(text)
            item.setData(Qt.ItemDataRole.UserRole, inst)
            self.history_tab.incidents_installations_list.addItem(item)

            if preferred_record_id is not None and record_id == preferred_record_id:
                selected_item = item

        if selected_item is not None:
            self.history_tab.incidents_installations_list.setCurrentItem(selected_item)
        elif self.history_tab.incidents_installations_list.count() > 0:
            self.history_tab.incidents_installations_list.setCurrentRow(0)
        else:
            self.history_tab.incident_detail.setText("No hay instalaciones para mostrar en este rango.")

    def _on_incidents_installation_changed(self, current, _previous=None):
        """Recargar incidencias cuando cambia la instalación seleccionada."""
        self.history_tab.incidents_list.clear()
        self.history_tab.incident_photos_list.clear()
        self._thumbnail_item_map.clear()
        self.history_tab.incident_detail.clear()
        self.history_tab.upload_incident_photo_btn.setEnabled(False)
        self.history_tab.view_incident_photo_btn.setEnabled(False)

        has_installation = current is not None
        if hasattr(self.history_tab, "create_incident_btn"):
            self.history_tab.create_incident_btn.setEnabled(has_installation)
        if not has_installation:
            return

        installation = current.data(Qt.ItemDataRole.UserRole)
        if not isinstance(installation, dict):
            return

        record_id = installation.get("id")
        if record_id is None:
            return

        try:
            incidents = self.history.get_incidents_for_installation(record_id)
        except Exception as e:
            self.history_tab.incident_detail.setText(f"Error cargando incidencias: {e}")
            return

        severity_filter = "todas"
        if hasattr(self.history_tab, "incidents_severity_filter"):
            severity_filter = str(self.history_tab.incidents_severity_filter.currentText() or "Todas").strip().lower()

        period_days = None
        if hasattr(self.history_tab, "incidents_period_filter"):
            period_days = self._period_days_from_text(self.history_tab.incidents_period_filter.currentText())

        cutoff = None
        if period_days is not None:
            cutoff = datetime.now() - timedelta(days=period_days)

        filtered_incidents = []
        for incident in incidents:
            incident_severity = str(incident.get("severity") or "").strip().lower()
            if severity_filter != "todas" and incident_severity != severity_filter:
                continue

            if cutoff is not None:
                incident_dt = self._parse_incident_datetime(incident.get("created_at"))
                if incident_dt is None or incident_dt < cutoff:
                    continue

            filtered_incidents.append(incident)
            incident_id = incident.get("id")
            severity = str(incident.get("severity") or "N/A").upper()
            created_at = str(incident.get("created_at") or "")
            note_preview = (incident.get("note") or "").strip().replace("\n", " ")
            if len(note_preview) > 80:
                note_preview = note_preview[:77] + "..."
            text = f"#{incident_id} [{severity}] {created_at} - {note_preview or 'Sin nota'}"
            item = QListWidgetItem(text)
            item.setData(Qt.ItemDataRole.UserRole, incident)
            self.history_tab.incidents_list.addItem(item)

        if self.history_tab.incidents_list.count() > 0:
            self.history_tab.incidents_list.setCurrentRow(0)
        else:
            if incidents and not filtered_incidents:
                self.history_tab.incident_detail.setText(
                    "No hay incidencias que coincidan con los filtros actuales."
                )
            else:
                self.history_tab.incident_detail.setText(
                    f"No hay incidencias para la instalación #{record_id}."
                )

    def _on_incident_item_changed(self, current, _previous=None):
        """Actualizar detalle y fotos según la incidencia seleccionada."""
        self.history_tab.incident_photos_list.clear()
        self._thumbnail_item_map.clear()
        self.history_tab.view_incident_photo_btn.setEnabled(False)
        self.history_tab.upload_incident_photo_btn.setEnabled(current is not None)

        if current is None:
            self.history_tab.incident_detail.clear()
            return

        incident = current.data(Qt.ItemDataRole.UserRole)
        if not isinstance(incident, dict):
            self.history_tab.incident_detail.clear()
            return

        photos = incident.get("photos") or []
        details = (
            f"ID: {incident.get('id')}\n"
            f"Instalación: {incident.get('installation_id')}\n"
            f"Severidad: {incident.get('severity')}\n"
            f"Reportado por: {incident.get('reporter_username')}\n"
            f"Origen: {incident.get('source')}\n"
            f"Ajuste tiempo (s): {incident.get('time_adjustment_seconds')}\n"
            f"Fecha: {incident.get('created_at')}\n"
            f"Fotos: {len(photos)}\n\n"
            f"Nota:\n{incident.get('note') or ''}"
        )
        self.history_tab.incident_detail.setText(details)

        for photo in photos:
            photo_id = photo.get("id")
            file_name = photo.get("file_name") or f"photo_{photo_id}"
            content_type = photo.get("content_type") or "image/*"
            label = f"#{photo_id} - {file_name} ({content_type})"
            item = QListWidgetItem(label)
            item.setData(Qt.ItemDataRole.UserRole, photo)
            if photo_id is not None:
                icon = self._build_photo_thumbnail_icon(photo_id)
                if icon is not None:
                    item.setIcon(icon)
                else:
                    self._queue_thumbnail_load(photo_id)
                self._thumbnail_item_map[photo_id] = item
            created_at = photo.get("created_at")
            if created_at:
                item.setToolTip(f"Fecha: {created_at}")
            self.history_tab.incident_photos_list.addItem(item)

        if self.history_tab.incident_photos_list.count() > 0:
            self.history_tab.incident_photos_list.setCurrentRow(0)
            self.history_tab.view_incident_photo_btn.setEnabled(True)

    def create_incident_from_incidents_view(self):
        """Crear incidencia usando la instalación seleccionada en el panel."""
        current_installation = self.history_tab.incidents_installations_list.currentItem()
        if current_installation is None:
            QMessageBox.warning(self, "Atención", "Selecciona una instalación primero.")
            return

        installation = current_installation.data(Qt.ItemDataRole.UserRole)
        record_id = installation.get("id") if isinstance(installation, dict) else None
        if record_id is None:
            QMessageBox.warning(self, "Error", "No se pudo obtener el ID de instalación.")
            return

        self.create_incident_for_record(record_id)

    def upload_photo_for_selected_incident(self):
        """Subir foto para la incidencia seleccionada en el panel."""
        current_incident = self.history_tab.incidents_list.currentItem()
        if current_incident is None:
            QMessageBox.warning(self, "Atención", "Selecciona una incidencia primero.")
            return

        incident = current_incident.data(Qt.ItemDataRole.UserRole)
        incident_id = incident.get("id") if isinstance(incident, dict) else None
        if incident_id is None:
            QMessageBox.warning(self, "Error", "No se pudo obtener el ID de incidencia.")
            return

        self._upload_photo_for_incident(incident_id)
        current_installation = self.history_tab.incidents_installations_list.currentItem()
        self._on_incidents_installation_changed(current_installation)

    def view_selected_incident_photo(self):
        """Abrir la foto seleccionada en el visor."""
        current_photo = self.history_tab.incident_photos_list.currentItem()
        if current_photo is None:
            QMessageBox.information(self, "Sin foto", "Selecciona una foto de la lista.")
            return

        photo = current_photo.data(Qt.ItemDataRole.UserRole)
        photo_id = photo.get("id") if isinstance(photo, dict) else None
        if photo_id is None:
            QMessageBox.warning(self, "Error", "No se pudo obtener el ID de la foto.")
            return

        self._open_photo_viewer(photo_id, current_photo.text())

    def _update_management_stats(self):
        """Actualizar estadísticas y logs en la vista de gestión de registros"""
        try:
            # Obtener estadísticas agregadas desde el backend (SQL), sin cargar todo el historial.
            stats = self.history.get_statistics()
            total = int(stats.get('total_installations') or 0)
            successful = int(stats.get('successful_installations') or 0)
            failed = int(stats.get('failed_installations') or 0)
            success_rate = float(stats.get('success_rate') or 0)

            # Cargar una ventana acotada para la lista visual de gestión.
            installations_for_list = self.history.get_installations(limit=200)

            # Fecha más antigua dentro de los registros cargados en la vista.
            oldest_date = "N/A"
            if installations_for_list:
                oldest = min(installations_for_list, key=lambda x: x['timestamp'])
                oldest_dt = datetime.fromisoformat(oldest['timestamp'])
                oldest_date = oldest_dt.strftime('%d/%m/%Y')
            
            # Actualizar el display de estadísticas
            stats_text = f"""📊 ESTADÍSTICAS ACTUALES:

• Total de registros: {total}
• Instalaciones exitosas: {successful} ({success_rate:.1f}%)
• Instalaciones fallidas: {failed}
• Registro más antiguo (últimos 200): {oldest_date}
• Última actualización: {datetime.now().strftime('%d/%m/%Y %H:%M')}"""
            
            self.history_tab.mgmt_stats_display.setText(stats_text)

            # Actualizar la lista de registros en la pestaña de gestión
            self.history_tab.management_history_list.clear()
            for inst in installations_for_list:
                timestamp = datetime.fromisoformat(inst['timestamp'])
                date_str = timestamp.strftime('%d/%m/%Y %H:%M')
                status = (inst.get('status') or '').lower()
                if status == 'success':
                    status_icon = "✓"
                elif status == 'failed':
                    status_icon = "✗"
                else:
                    status_icon = "•"
                
                brand = inst.get('driver_brand') or "N/A"
                version = inst.get('driver_version') or "N/A"
                text = f"{status_icon} {date_str} - {brand} v{version}"
                if inst.get('client_name'):
                    text += f" ({inst['client_name']})"
                
                item = QListWidgetItem(text)
                item.setData(Qt.ItemDataRole.UserRole, inst['id']) # Guardamos el ID
                self.history_tab.management_history_list.addItem(item)
            
            # Actualizar logs de auditoría
            self.refresh_audit_logs()
            
        except Exception as e:
            error_text = f"❌ Error al cargar estadísticas: {str(e)}"
            self.history_tab.mgmt_stats_display.setText(error_text)

    def delete_selected_history_record(self):
        """Eliminar un registro de historial seleccionado."""
        if not self.user_manager or not self.user_manager.is_super_admin():
            QMessageBox.warning(self, "Acceso Denegado", "Solo un Super Administrador puede eliminar registros.")
            return

        selected_items = self.history_tab.management_history_list.selectedItems()
        if not selected_items:
            QMessageBox.warning(self, "Atención", "Seleccione un registro de la lista para eliminar.")
            return

        item = selected_items[0]
        record_id = item.data(Qt.ItemDataRole.UserRole)
        record_text = item.text()

        reply = QMessageBox.question(
            self,
            "Confirmar Eliminación",
            f"¿Está seguro que desea eliminar el siguiente registro?\n\n{record_text}\n\n<b>Esta acción es irreversible.</b>",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )

        if reply == QMessageBox.StandardButton.Yes:
            try:
                success = self.history.delete_installation(record_id)
                if success:
                    QMessageBox.information(self, "Éxito", "El registro ha sido eliminado.")
                    
                    # Log de auditoría
                    self.user_manager._log_access(
                        action="delete_history_record_success",
                        username=self.user_manager.current_user.get('username'),
                        success=True,
                        details={'record_id': record_id, 'record_text': record_text}
                    )
                    # Actualizar vistas
                    self._update_management_stats()
                    self.refresh_history_view()
                else:
                    raise Exception("La API no confirmó la eliminación.")
            except Exception as e:
                QMessageBox.critical(self, "Error", f"No se pudo eliminar el registro:\n{e}")
                logger.error(f"Error deleting history record {record_id}: {e}", exc_info=True)
                # Log de auditoría de fallo
                self.user_manager._log_access(
                    action="delete_history_record_failed",
                    username=self.user_manager.current_user.get('username'),
                    success=False,
                    details={'record_id': record_id, 'error': str(e)}
                )

    def create_manual_history_record(self):
        """Crear registro manual sin depender de instalación de driver previa."""
        default_client = ""
        if self.user_manager and self.user_manager.current_user:
            default_client = self.user_manager.current_user.get("username", "")

        client_name, ok = QInputDialog.getText(
            self,
            "Nuevo Registro Manual",
            "Cliente (opcional):",
            text=default_client,
        )
        if not ok:
            return

        brand, ok = QInputDialog.getText(
            self,
            "Nuevo Registro Manual",
            "Marca/Equipo (opcional):",
            text="N/A",
        )
        if not ok:
            return

        version, ok = QInputDialog.getText(
            self,
            "Nuevo Registro Manual",
            "Versión/Referencia (opcional):",
            text="N/A",
        )
        if not ok:
            return

        status, ok = QInputDialog.getItem(
            self,
            "Nuevo Registro Manual",
            "Estado del registro:",
            ["manual", "success", "failed", "unknown"],
            0,
            False,
        )
        if not ok:
            return

        notes, ok = QInputDialog.getMultiLineText(
            self,
            "Nuevo Registro Manual",
            "Notas:",
            "",
        )
        if not ok:
            return

        success, record = self.history.create_manual_record(
            client_name=(client_name or "").strip() or "Sin cliente",
            driver_brand=(brand or "").strip() or "N/A",
            driver_version=(version or "").strip() or "N/A",
            status=status,
            notes=(notes or "").strip(),
            driver_description="Registro manual desde .exe",
        )

        if success:
            record_id = record.get("id") if isinstance(record, dict) else None
            message = "Registro manual creado correctamente."
            if record_id:
                message += f"\nID: {record_id}"
            QMessageBox.information(self, "Éxito", message)

            if self.user_manager and self.user_manager.current_user:
                self.user_manager._log_access(
                    action="create_manual_record_success",
                    username=self.user_manager.current_user.get('username'),
                    success=True,
                    details={
                        "record_id": record_id,
                        "status": status,
                        "client_name": (client_name or "").strip() or "Sin cliente",
                    },
                )

            self.refresh_history_view()
            self._update_management_stats()
        else:
            QMessageBox.critical(
                self,
                "Error",
                "No se pudo crear el registro manual (problema de conexión o API).",
            )

            if self.user_manager and self.user_manager.current_user:
                self.user_manager._log_access(
                    action="create_manual_record_failed",
                    username=self.user_manager.current_user.get('username'),
                    success=False,
                    details={"status": status},
                )

    def show_incidents_for_selected_record(self):
        """Navegar al panel de incidencias con el registro seleccionado."""
        selected_items = self.history_tab.history_list.selectedItems()
        if not selected_items:
            QMessageBox.warning(self, "Atención", "Selecciona un registro del historial primero.")
            return

        record_id = selected_items[0].data(Qt.ItemDataRole.UserRole)
        if record_id is None:
            QMessageBox.warning(self, "Error", "No se pudo obtener el ID del registro.")
            return

        if self.history_tab.history_view_combo.count() >= 4:
            self.history_tab.history_view_combo.setCurrentIndex(3)
        self.refresh_incidents_view(preferred_record_id=record_id)

    def create_incident_for_record(self, record_id):
        """Crear una incidencia nueva para un registro existente."""
        note, ok = QInputDialog.getMultiLineText(
            self,
            f"Nueva incidencia para instalación #{record_id}",
            "Detalle de la incidencia:",
            "",
        )
        if not ok:
            return
        note = (note or "").strip()
        if not note:
            QMessageBox.warning(self, "Atención", "La incidencia requiere un detalle.")
            return

        severity, ok = QInputDialog.getItem(
            self,
            "Severidad",
            "Selecciona severidad:",
            ["low", "medium", "high", "critical"],
            1,
            False,
        )
        if not ok:
            return

        adjust_text, ok = QInputDialog.getText(
            self,
            "Ajuste de tiempo",
            "Segundos a ajustar (puede ser negativo):",
            text="0",
        )
        if not ok:
            return

        try:
            time_adjustment = int((adjust_text or "0").strip())
        except ValueError:
            QMessageBox.warning(self, "Error", "El ajuste de tiempo debe ser un número entero.")
            return

        apply_item, ok = QInputDialog.getItem(
            self,
            "Aplicar a instalación",
            "¿Aplicar nota/tiempo al registro de instalación?",
            ["No", "Sí"],
            0,
            False,
        )
        if not ok:
            return

        reporter = "desktop"
        if self.user_manager and self.user_manager.current_user:
            reporter = self.user_manager.current_user.get("username", "desktop")

        try:
            incident = self.history.create_incident(
                installation_id=record_id,
                note=note,
                severity=severity,
                reporter_username=reporter,
                time_adjustment_seconds=time_adjustment,
                apply_to_installation=(apply_item == "Sí"),
                source="desktop",
            )
            incident_id = incident.get("id") if isinstance(incident, dict) else None
            msg = "Incidencia creada correctamente."
            if incident_id:
                msg += f"\nID: {incident_id}"
            QMessageBox.information(self, "Éxito", msg)
            self.refresh_history_view()
            if hasattr(self.history_tab, "incidents_installations_list"):
                self.refresh_incidents_view(preferred_record_id=record_id)
        except Exception as e:
            QMessageBox.critical(self, "Error", f"No se pudo crear la incidencia:\n{e}")

    def _show_incident_details(self, incident):
        """Mostrar detalle de incidencia en una ventana simple."""
        photos_count = len(incident.get("photos") or [])
        details = (
            f"ID: {incident.get('id')}\n"
            f"Instalación: {incident.get('installation_id')}\n"
            f"Severidad: {incident.get('severity')}\n"
            f"Reportado por: {incident.get('reporter_username')}\n"
            f"Origen: {incident.get('source')}\n"
            f"Ajuste tiempo (s): {incident.get('time_adjustment_seconds')}\n"
            f"Fecha: {incident.get('created_at')}\n"
            f"Fotos: {photos_count}\n\n"
            f"Nota:\n{incident.get('note') or ''}"
        )
        QMessageBox.information(self, f"Incidencia #{incident.get('id')}", details)

    def _select_incident_photo(self, incident):
        """Elegir y abrir una foto de incidencia."""
        photos = incident.get("photos") or []
        if not photos:
            QMessageBox.information(self, "Sin fotos", "Esta incidencia no tiene fotos asociadas.")
            return

        choices = []
        photo_map = {}
        for photo in photos:
            photo_id = photo.get("id")
            file_name = photo.get("file_name") or f"photo_{photo_id}"
            content_type = photo.get("content_type") or "image/*"
            choice = f"#{photo_id} - {file_name} ({content_type})"
            choices.append(choice)
            photo_map[choice] = photo

        selected_photo, ok = QInputDialog.getItem(
            self,
            f"Fotos de incidencia #{incident.get('id')}",
            "Selecciona foto:",
            choices,
            0,
            False,
        )
        if not ok:
            return

        photo = photo_map.get(selected_photo)
        photo_id = photo.get("id") if photo else None
        if photo_id is None:
            QMessageBox.warning(self, "Error", "No se pudo obtener el ID de la foto.")
            return
        self._open_photo_viewer(photo_id, selected_photo)

    def _open_photo_viewer(self, photo_id, title):
        """Descargar y mostrar foto de incidencia."""
        try:
            photo_bytes, _content_type = self.history.get_photo_content(photo_id)
        except Exception as e:
            QMessageBox.critical(self, "Error", f"No se pudo descargar la foto #{photo_id}:\n{e}")
            return

        pixmap = QPixmap()
        if not pixmap.loadFromData(photo_bytes):
            QMessageBox.warning(
                self,
                "Formato no soportado",
                "No se pudo renderizar la imagen en el visor de Qt.",
            )
            return

        viewer = QDialog(self)
        viewer.setWindowTitle(f"Foto {title}")
        viewer.resize(920, 700)

        layout = QVBoxLayout(viewer)
        image_label = QLabel()
        image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        image_label.setPixmap(
            pixmap.scaled(
                880,
                620,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
        )
        layout.addWidget(image_label)

        close_btn = QPushButton("Cerrar")
        close_btn.clicked.connect(viewer.accept)
        layout.addWidget(close_btn)
        viewer.exec()

    def _upload_photo_for_incident(self, incident_id):
        """Subir foto a una incidencia existente."""
        if incident_id is None:
            QMessageBox.warning(self, "Error", "Incidencia inválida.")
            return

        file_path, _ = QFileDialog.getOpenFileName(
            self,
            f"Subir foto a incidencia #{incident_id}",
            "",
            "Imágenes (*.jpg *.jpeg *.png *.webp)",
        )
        if not file_path:
            return

        try:
            photo = self.history.upload_incident_photo(incident_id, file_path)
            photo_id = photo.get("id") if isinstance(photo, dict) else None
            msg = "Foto subida correctamente."
            if photo_id:
                msg += f"\nID: {photo_id}"
            QMessageBox.information(self, "Éxito", msg)
        except Exception as e:
            QMessageBox.critical(self, "Error", f"No se pudo subir la foto:\n{e}")

    def refresh_audit_logs(self):
        """Actualizar la lista de logs de auditoría"""
        self.history_tab.audit_log_list.clear()
        
        if not self.user_manager or not self.user_manager.current_user:
            self.history_tab.audit_log_list.addItem("Inicia sesión para ver los logs")
            return
        
        try:
            logs = self.user_manager.get_access_logs(limit=100)

            if (not logs and
                self.user_manager.is_super_admin() and
                self.user_manager.local_mode and
                not self._audit_logs_repair_attempted):
                self._audit_logs_repair_attempted = True
                repaired, message = self.user_manager.repair_access_logs()
                if repaired:
                    logger.warning(f"Logs de auditoría reparados automáticamente: {message}")
                    logs = self.user_manager.get_access_logs(limit=100)
                else:
                    logger.warning(f"No se pudo reparar logs de auditoría: {message}")

            if not logs:
                self.history_tab.audit_log_list.addItem("No hay logs de auditoría.")
                return
            
            for log in reversed(logs):
                timestamp_str = log.get('timestamp', '')
                try:
                    timestamp = datetime.fromisoformat(timestamp_str)
                    date_str = timestamp.strftime('%d/%m/%Y %H:%M')
                except (ValueError, TypeError):
                    date_str = "Fecha inválida"
                
                action = log.get('action', 'N/A')
                username = log.get('username', 'N/A')
                success = "✅" if log.get('success') else "❌"
                details = log.get('details', {})
                
                text = f"{success} [{date_str}] {username} - {action}"
                
                # Añadir detalles específicos
                details_str = ""
                if "driver" in action and details:
                    brand = details.get('driver_brand') or details.get('brand')
                    version = details.get('driver_version') or details.get('version')
                    if brand and version:
                        details_str = f" (Driver: {brand} v{version})"
                    error = details.get('error')
                    if error:
                        details_str += f" - Error: {error}"

                self.history_tab.audit_log_list.addItem(text + details_str)
        
        except Exception as e:
            logger.error(f"Error cargando logs de auditoría: {e}", exc_info=True)
            self.history_tab.audit_log_list.addItem(f"Error al cargar logs: {e}")
    
    # Métodos delegados a los manejadores
    def on_download_finished(self, file_path, install, driver):
        """Delegado al event handler"""
        self.event_handlers.on_download_finished(file_path, install, driver)
    
    def on_download_error(self, error_msg):
        """Delegado al event handler"""
        self.event_handlers.on_download_error(error_msg)
    
    def on_upload_finished(self, upload_info=None):
    
        from ui.dialogs.quick_upload_dialog import UploadSuccessDialog
    
        self.progress_bar.setVisible(False)
        self.statusBar().showMessage("✅ Driver subido exitosamente", 5000)
    
        upload_info = upload_info or getattr(self, 'current_upload_info', {})
    
    # Mostrar diálogo de éxito
        success_dialog = UploadSuccessDialog(upload_info, self)
        success_dialog.exec()
    
    # Log de auditoría
        if self.user_manager and self.user_manager.current_user:
            self.user_manager._log_access(
            action="upload_driver_success",
            username=self.user_manager.current_user.get('username'),
            success=True,
            details={
                'driver_brand': upload_info.get('brand'),
                'driver_version': upload_info.get('version'),
                'file_name': Path(upload_info.get('file_path', '')).name if upload_info.get('file_path') else 'N/A'
            }
        )
    
    # Limpiar upload info
        if hasattr(self, 'current_upload_info'):
            del self.current_upload_info
    
    # Refrescar lista de drivers
        self.refresh_drivers_list()
    
    # Actualizar logs de auditoría si están visibles
        if hasattr(self, 'history_tab') and hasattr(self.history_tab, 'audit_log_list'):
            self.refresh_audit_logs()

    def on_upload_error(self, error_msg, upload_info=None):
        """Delegado al event handler"""
        upload_info = upload_info or getattr(self, 'current_upload_info', {})
        self.event_handlers.on_upload_error(error_msg, upload_info)
        if hasattr(self, 'current_upload_info'):
            del self.current_upload_info
    
    def test_r2_connection(self):
        """Probar conexión R2"""
        success, message = self.config_manager.test_cloud_connection(
            self.admin_tab.admin_account_id_input.text(),
            self.admin_tab.admin_access_key_input.text(),
            self.admin_tab.admin_secret_key_input.text(),
            self.admin_tab.admin_bucket_name_input.text()
        )
        
        if self.user_manager and self.user_manager.current_user:
            self.user_manager._log_access(
                action="test_r2_connection",
                username=self.user_manager.current_user.get('username'),
                success=success,
                details={'message': message}
            )
        
        if success:
            QMessageBox.information(self, "Conexión", message)
        else:
            QMessageBox.critical(self, "Error", message)
    
    def select_driver_file(self):
        """Seleccionar archivo de driver"""
        from pathlib import Path
        
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Seleccionar Driver",
            "",
            "Executable (*.exe);;ZIP Files (*.zip);;All Files (*.*)"
        )
        
        if file_path:
            self.selected_file_path = file_path
            self.drivers_tab.selected_file_label.setText(Path(file_path).name)
    
    def upload_driver(self):
        """Subir driver"""
        if not self.is_admin:
            QMessageBox.warning(self, "Error", "Requiere autenticación de administrador")
            return
        
        if not hasattr(self, 'selected_file_path'):
            QMessageBox.warning(self, "Error", "Seleccione un archivo primero")
            return
        
        brand = self.drivers_tab.upload_brand.currentText()
        version = self.drivers_tab.upload_version.text()
        description = self.drivers_tab.upload_description.text()
        
        if not version:
            QMessageBox.warning(self, "Error", "Ingrese la versión del driver")
            return
        
        # Guardar info para el log
        self.current_upload_info = {
            'brand': brand,
            'version': version,
            'description': description
        }
        
        self.download_manager.start_upload(
            self.selected_file_path,
            brand,
            version,
            description
        )
    
    def delete_driver(self):
        """Eliminar driver seleccionado"""
        if not self.is_admin:
            return
        
        selected_items = self.admin_tab.admin_drivers_list.selectedItems()
        if not selected_items:
            QMessageBox.warning(self, "Error", "Seleccione un driver para eliminar")
            return
        
        driver = selected_items[0].data(Qt.ItemDataRole.UserRole)
        
        reply = QMessageBox.question(
            self,
            "Confirmar Eliminación",
            f"¿Está seguro que desea eliminar:\n{driver['brand']} v{driver['version']}?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            try:
                self.cloud_manager.delete_driver(driver['key'])
                QMessageBox.information(self, "Éxito", "Driver eliminado correctamente")
                
                # Log de auditoría
                if self.user_manager and self.user_manager.current_user:
                    self.user_manager._log_access(
                        action="delete_driver_success",
                        username=self.user_manager.current_user.get('username'),
                        success=True,
                        details={
                            'driver_brand': driver['brand'],
                            'driver_version': driver['version'],
                            'driver_key': driver['key']
                        }
                    )
                
                self.refresh_drivers_list()
                self.refresh_audit_logs()
                
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Error al eliminar:\n{str(e)}")
                # Log de auditoría
                if self.user_manager and self.user_manager.current_user:
                    self.user_manager._log_access(
                        action="delete_driver_failed",
                        username=self.user_manager.current_user.get('username'),
                        success=False,
                        details={
                            'driver_brand': driver.get('brand', 'N/A'),
                            'driver_version': driver.get('version', 'N/A'),
                            'error': str(e)
                        }
                    )
                self.refresh_audit_logs()
    
    def show_edit_installation_dialog(self):
        """Mostrar el diálogo para editar un registro de instalación."""
        if not self.is_admin:
            QMessageBox.warning(self, "Acceso Denegado", "No tienes permisos para editar registros de instalación.")
            return

        selected_items = self.history_tab.history_list.selectedItems()
        if not selected_items:
            QMessageBox.warning(self, "Atención", "Seleccione un registro de la lista para editar.")
            return

        item = selected_items[0]
        record_id = item.data(Qt.ItemDataRole.UserRole)

        if record_id is None:
            QMessageBox.critical(self, "Error", "No se pudo obtener el ID del registro seleccionado.")
            return

        # Obtener datos actuales del registro
        try:
            installation_data = self.history.get_installation_by_id(record_id)
            if not installation_data:
                QMessageBox.critical(self, "Error", "No se encontró el registro en la base de datos.")
                return
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Error al obtener los datos del registro:\n{e}")
            logger.error(f"Error getting installation by ID {record_id}: {e}", exc_info=True)
            return

        # Crear y mostrar el diálogo
        dialog = EditInstallationDialog(installation_data, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            updated_data = dialog.get_updated_data()
            
            try:
                # Actualizar en la base de datos
                self.history.update_installation_details(
                    record_id,
                    updated_data['notes'],
                    updated_data['time_seconds']
                )
                
                QMessageBox.information(self, "Éxito", "El registro se actualizó correctamente.")
                
                # Actualizar la vista del historial
                self.refresh_history_view()
                
            except Exception as e:
                QMessageBox.critical(self, "Error", f"No se pudo actualizar el registro:\n{e}")
                logger.error(f"Error updating installation record {record_id}: {e}", exc_info=True)

    def show_login_dialog(self):
        """Mostrar diálogo de inicio de sesión"""
        logger.operation_start("show_login_dialog")
        
        if not self.cloud_manager:
            # Si no hay conexión R2, permitir configurar sin login
            self.admin_tab.admin_content.setVisible(True)
            # Ocultar secciones que requieren login
            for widget in self.admin_tab.findChildren(QGroupBox):
                if "Cloudflare R2" not in widget.title():
                    widget.setVisible(False)
            self.admin_tab.auth_status.setText("🔓 Modo Configuración Inicial")
            self.admin_tab.login_btn.setVisible(False)
            logger.info("Modo configuración inicial activado (sin cloud_manager)")
            logger.operation_end("show_login_dialog", success=True, mode="initial_config")
            QMessageBox.information(self, "Configuración Inicial", 
                "Configura las credenciales de Cloudflare R2 primero.\n\n"
                "Después podrás crear usuarios y acceder al sistema completo.")
            return
        
        # Inicializar user_manager si no existe
        if not self.user_manager:
            try:
                if not self.history_manager:
                    self.history_manager = InstallationHistory(self.config_manager)
                self.user_manager = UserManagerV2(
                    self.cloud_manager,
                    self.security_manager,
                    audit_api_client=self.history_manager
                )
            except Exception as e:
                logger.error(f"Error inicializando user_manager: {e}", exc_info=True)
                logger.operation_end("show_login_dialog", success=False, reason=str(e))
                QMessageBox.warning(self, "Error", f"Error inicializando sistema de usuarios: {str(e)}")
                return
        elif (not self.user_manager.local_mode and
              not getattr(self.user_manager, "audit_api_client", None)):
            if not self.history_manager:
                self.history_manager = InstallationHistory(self.config_manager)
            self.user_manager.set_audit_api_client(self.history_manager)

        try:
            if self.user_manager.needs_initialization():
                logger.warning("No hay base de usuarios disponible. Iniciando configuración inicial.")
                QMessageBox.information(
                    self,
                    "Configuración inicial requerida",
                    "No se encontró una base de usuarios válida.\n\n"
                    "Se abrirá el asistente para crear el primer super administrador."
                )
                self._show_setup_wizard(self.user_manager, exit_on_cancel=False)

                if self.user_manager.needs_initialization():
                    logger.warning("Login cancelado: el sistema sigue sin base de usuarios.")
                    return
        except Exception as e:
            logger.error(f"No se pudo evaluar inicialización de usuarios: {e}", exc_info=True)
            QMessageBox.warning(
                self,
                "Error de inicialización",
                f"No se pudo validar la base de usuarios: {e}"
            )
            return
        
        # Mostrar diálogo de login
        dialog = LoginDialog(self.user_manager, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            user = self.user_manager.current_user
            user_role = user.get('role')
            username = user.get('username')
            
            logger.security_event(
                event_type="admin_panel_access",
                username=username,
                success=True,
                details={'role': user_role},
                severity='INFO'
            )
            
            self.is_authenticated = True
            self.is_admin = user_role in ["admin", "super_admin"]

            # Mostrar sección de subida en DriversTab si es admin
            self.drivers_tab.toggle_upload_section(self.is_admin)

            self.admin_tab.auth_status.setText(f"🔓 {username} ({user_role})")
            self.admin_tab.login_btn.setVisible(False)
            self.admin_tab.logout_btn.setVisible(True)
            self.admin_tab.admin_content.setVisible(True)
            
            # Actualizar visibilidad del warning en HistoryTab si existe
            if hasattr(self.history_tab, 'warning'):
                self.history_tab.warning.setVisible(not self.is_admin)

            # ========================================
            # Logica de permisos por rol
            # ========================================
            
            if user_role == "super_admin":
                logger.info(f"Configurando panel para super_admin: {username}")
                
                # Super admin: acceso completo al panel
                # 1. Mostrar TODAS las secciones incluyendo Cloudflare R2
                for widget in self.admin_tab.findChildren(QGroupBox):
                    widget.setVisible(True)
                    logger.debug(f"GroupBox visible: {widget.title()}")
                
                # 2. Mostrar botón de gestión de usuarios
                if hasattr(self.admin_tab, 'user_mgmt_btn'):
                    self.admin_tab.user_mgmt_btn.setVisible(True)
                    logger.debug("Botón gestión usuarios visible")
                
                # 3. Mostrar todos los botones operativos
                for widget in self.admin_tab.findChildren(QPushButton):
                    # Mostrar botones de operaciones
                    if any(text in widget.text() for text in ["Seleccionar Archivo", "Subir a la Nube", "Eliminar Seleccionado"]):
                        widget.setVisible(True)
                        logger.debug(f"Botón visible para super_admin: {widget.text()}")
                    # También botones de R2
                    if any(text in widget.text() for text in ["Guardar Configuración R2", "Probar Conexión"]):
                        widget.setVisible(True)
                        logger.debug(f"Botón R2 visible para super_admin: {widget.text()}")
                
                # 4. Mostrar campos de entrada para subir drivers
                for widget in self.admin_tab.findChildren(QLineEdit):
                    if widget.placeholderText() and any(text in widget.placeholderText().lower() for text in ["driver", "account", "key", "bucket"]):
                        widget.setVisible(True)
                        logger.debug(f"Campo visible: {widget.placeholderText()}")
                
                # 5. IMPORTANTE: Cargar credenciales R2 en los campos
                logger.info("Cargando credenciales R2 para super_admin")
                self.event_handlers.load_r2_config_to_admin_panel()
                
                logger.security_event(
                    event_type="r2_credentials_accessed",
                    username=username,
                    success=True,
                    details={'action': 'view_credentials'},
                    severity='WARNING'
                )
                
            elif user_role == "admin":
                logger.info(f"Configurando panel para admin: {username}")
                
                # Admin: puede operar drivers sin ver credenciales R2
                # 1. OCULTAR sección de Cloudflare R2
                for widget in self.admin_tab.findChildren(QGroupBox):
                    if "Cloudflare R2" in widget.title():
                        widget.setVisible(False)
                        logger.debug("Sección R2 OCULTA para admin")
                    else:
                        widget.setVisible(True)
                
                # 2. Mostrar botones de eliminar drivers
                for widget in self.admin_tab.findChildren(QPushButton):
                    if "Eliminar Seleccionado" in widget.text():
                        widget.setVisible(True)
                    # OCULTAR botones de configurar R2
                    if any(text in widget.text() for text in ["Guardar Configuración R2", "Probar Conexión"]):
                        widget.setVisible(False)
                
                # 3. Mostrar campos para subir drivers
                for widget in self.admin_tab.findChildren(QLineEdit):
                    if widget.placeholderText() and "driver" in widget.placeholderText().lower():
                        widget.setVisible(True)
                    if widget.placeholderText() and any(text in widget.placeholderText().lower() for text in ["account", "key", "bucket"]):
                        widget.setVisible(False)
                
                # 4. NO cargar credenciales R2
                logger.info("Admin NO tiene acceso a credenciales R2")
                
            else:  # viewer
                logger.info(f"Configurando panel para viewer: {username}")
                
                # ❌ VIEWER: Solo lectura
                # Ocultar secciones sensibles
                for widget in self.admin_tab.findChildren(QGroupBox):
                    widget.setVisible(False)
                
                # Ocultar botones de edición de drivers y config R2
                for widget in self.admin_tab.findChildren(QPushButton):
                    if any(text in widget.text() for text in ["Eliminar Seleccionado", "Guardar Configuración", "Probar Conexión"]):
                        widget.setVisible(False)
                
                # Ocultar campos de entrada sensibles
                for widget in self.admin_tab.findChildren(QLineEdit):
                    if widget.placeholderText() and any(text in widget.placeholderText().lower() for text in ["driver", "account", "key", "bucket"]):
                        widget.setVisible(False)
                
                logger.info("Viewer: solo lectura, sin acceso a panel admin")
            
            # Cargar lista de drivers para admin/super_admin
            if hasattr(self, 'all_drivers') and user_role in ["admin", "super_admin"]:
                self.event_handlers.update_admin_drivers_list(self.all_drivers)
                logger.debug(f"Lista de drivers cargada para {user_role}")
            
            # Actualizar la vista de logs de auditoría
            self.refresh_audit_logs()
            
            logger.operation_end("show_login_dialog", success=True, role=user_role)
        else:
            logger.info("Login cancelado por usuario")
            logger.operation_end("show_login_dialog", success=False, reason="cancelled")

    def on_admin_logout(self):
        """Manejar cierre de sesión y actualizar UI"""
        self.event_handlers.admin_logout()
        self.drivers_tab.toggle_upload_section(False)
    
    def show_user_management(self):
        """Mostrar diálogo de gestión de usuarios"""
        if not self.user_manager or not self.user_manager.current_user:
            QMessageBox.warning(self, "Error", "Debes iniciar sesión primero")
            return
        
        dialog = UserManagementDialog(self.user_manager, self)
        dialog.exec()
    
    def apply_theme(self):
        """Aplicar tema actual a la aplicación"""
        try:
            stylesheet = self.theme_manager.generate_stylesheet()
            self.setStyleSheet(stylesheet)
            
            # Aplicar clases CSS especiales
            if hasattr(self.history_tab, 'mgmt_stats_display'):
                self.theme_manager.apply_theme_to_widget(
                    self.history_tab.mgmt_stats_display, "stats"
                )
            
            # Forzar actualización visual
            self.update()
            
        except Exception as e:
            logger.error(f"Error aplicando tema: {e}", exc_info=True)
    
    def change_theme(self, theme_text):
        """Cambiar tema de la aplicación"""
        theme_name = "dark" if theme_text == "Oscuro" else "light"
        
        if self.theme_manager.set_theme(theme_name):
            self.apply_theme()
            self.statusBar().showMessage(f"✨ Tema cambiado a: {theme_text}")





