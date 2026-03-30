
import sys
import json
import gc
import re
import os
from pathlib import Path
from datetime import datetime, timedelta

from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget,
                             QTabWidget, QProgressBar, QMessageBox, QListWidgetItem,
                             QDialog, QGroupBox, QLineEdit, QInputDialog, QFileDialog)
from PyQt6.QtCore import Qt, QObject, pyqtSignal, QRunnable, QThreadPool
from PyQt6.QtGui import QFont

# Importar módulos personalizados
from managers.cloud_manager import CloudflareR2Manager
from managers.installer import DriverInstaller
from managers.history_manager import InstallationHistory
from reports.report_generator import ReportGenerator

# Importar módulos refactorizados
from core.security_manager import SecurityManager
from managers.download_manager import DownloadManager
from managers.web_driver_manager import WebDriverManager
from handlers.event_handlers import EventHandlers
from handlers.report_handlers import ReportHandlers
from managers.user_manager_v2 import UserManagerV2
from ui.dialogs.user_management_ui import UserManagementDialog
from ui.dialogs.qr_generator_dialog import QrGeneratorDialog
from ui.dialogs.asset_management_dialog import AssetManagementDialog
from ui.main_window_bootstrap import (
    build_main_window_ui,
    initialize_manager_state,
    initialize_window_handlers,
)
from ui.main_window_connections import setup_main_window_connections
from ui.main_window_incidents import (
    apply_incidents_filters as apply_incidents_filters_helper,
    assign_technician_to_selected_incident as assign_technician_to_selected_incident_helper,
    assign_technician_to_selected_installation as assign_technician_to_selected_installation_helper,
    build_photo_thumbnail_icon,
    create_incident_for_record as create_incident_for_record_helper,
    create_incident_from_incidents_view as create_incident_from_incidents_view_helper,
    format_incident_datetime_label,
    handle_incident_item_changed,
    handle_incidents_installation_changed,
    handle_thumbnail_failed,
    handle_thumbnail_loaded,
    incident_severity_label,
    incident_status_label,
    normalize_incident_status,
    normalize_record_attention_state,
    open_photo_viewer,
    queue_thumbnail_load,
    record_attention_icon,
    record_attention_label,
    refresh_incidents_view as refresh_incidents_view_helper,
    refresh_incident_assignments as refresh_incident_assignments_helper,
    refresh_installation_assignments as refresh_installation_assignments_helper,
    remove_selected_incident_assignment as remove_selected_incident_assignment_helper,
    remove_selected_installation_assignment as remove_selected_installation_assignment_helper,
    render_incident_detail_html,
    select_incident_photo,
    show_incident_details,
    show_incidents_for_selected_record as show_incidents_for_selected_record_helper,
    update_selected_incident_status as update_selected_incident_status_helper,
    upload_photo_for_incident,
    upload_photo_for_selected_incident as upload_photo_for_selected_incident_helper,
    view_selected_incident_photo as view_selected_incident_photo_helper,
)
from ui.main_window_session import (
    apply_navigation_access_control,
    current_user_role,
    handle_tab_changed,
    is_user_authenticated,
    run_admin_logout,
    run_login_dialog,
)
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
    """Ventana principal de SiteOps"""
    
    def __init__(self):
        super().__init__()
        self.setWindowTitle("SiteOps - Impresoras de Tarjetas")
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
                portable_auth_mode = str(config_data.get("desktop_auth_mode", "")).strip().lower()
                has_r2_config = bool(config_data.get("account_id"))
                has_web_config = (
                    portable_auth_mode in {"web", "auto"}
                    and bool(config_data.get("api_url") or config_data.get("history_api_url"))
                )
                if config_data and (has_r2_config or has_web_config):
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
        temp_user_manager = UserManagerV2(
            cloud_manager=self.cloud_manager,
            security_manager=self.security_manager,
            local_mode=False,
            audit_api_client=audit_client,
            auth_mode=self._resolve_desktop_auth_mode(),
        )  # Usar modo nube
        
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
                    "Ya puedes usar SiteOps."
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

    def _resolve_desktop_auth_mode(self):
        """
        Resolver modo de autenticación desktop.
        Prioridad: env > config.enc > legacy.
        """
        allowed_modes = {"legacy", "web", "auto"}
        env_mode = str(os.getenv("DRIVER_MANAGER_DESKTOP_AUTH_MODE", "")).strip().lower()
        if env_mode in allowed_modes:
            return env_mode
        if env_mode:
            logger.warning(f"DRIVER_MANAGER_DESKTOP_AUTH_MODE inválido: {env_mode}. Se usa fallback.")

        try:
            config = self.load_config_data() or {}
        except Exception:
            config = {}

        config_mode = str(config.get("desktop_auth_mode", "")).strip().lower()
        if config_mode in allowed_modes:
            return config_mode
        if config_mode:
            logger.warning(f"desktop_auth_mode inválido en config.enc: {config_mode}. Se usa legacy.")

        return "legacy"

    def _resolve_driver_api_base_url(self):
        """Resolver URL base de API para operaciones de drivers web."""
        if self.history_manager and hasattr(self.history_manager, "_get_api_url"):
            try:
                value = str(self.history_manager._get_api_url() or "").strip()
                if value:
                    return value.rstrip("/")
            except Exception:
                pass

        try:
            config = self.load_config_data() or {}
        except Exception:
            config = {}

        for key in ("api_url", "history_api_url"):
            value = str(config.get(key) or "").strip()
            if value:
                return value.rstrip("/")
        return ""

    def _resolve_current_web_token(self):
        """Obtener token web actual (Bearer) de sesión desktop."""
        if not self.user_manager:
            return ""
        token = getattr(self.user_manager, "current_web_token", None)
        return str(token or "").strip()

    def _resolve_current_web_session_context(self):
        """Obtener contexto de sesion web actual para tenant-aware requests."""
        if not self.user_manager:
            return {}
        current_user = getattr(self.user_manager, "current_user", None) or {}
        if not isinstance(current_user, dict):
            return {}
        if str(current_user.get("source") or "").strip().lower() != "web":
            return {}
        return {
            "user_id": current_user.get("id"),
            "username": current_user.get("username"),
            "role": current_user.get("role"),
            "tenant_id": current_user.get("tenant_id"),
        }

    def _sync_history_web_token_provider(self):
        """Conectar InstallationHistory con token y contexto de sesion web."""
        token_provider = self._resolve_current_web_token
        session_context_provider = self._resolve_current_web_session_context
        if getattr(self, "history", None) and hasattr(self.history, "set_web_token_provider"):
            self.history.set_web_token_provider(token_provider)
        if getattr(self, "history", None) and hasattr(self.history, "set_web_session_context_provider"):
            self.history.set_web_session_context_provider(session_context_provider)
        if getattr(self, "history_manager", None) and hasattr(self.history_manager, "set_web_token_provider"):
            self.history_manager.set_web_token_provider(token_provider)
        if getattr(self, "history_manager", None) and hasattr(self.history_manager, "set_web_session_context_provider"):
            self.history_manager.set_web_session_context_provider(session_context_provider)

    def _get_or_create_web_driver_manager(self):
        """Crear/reusar cliente de drivers web para este runtime."""
        if self.web_driver_manager is None:
            self.web_driver_manager = WebDriverManager(
                api_url_provider=self._resolve_driver_api_base_url,
                token_provider=self._resolve_current_web_token,
            )
        return self.web_driver_manager

    def resolve_driver_backend(self):
        """
        Resolver backend de drivers activo.
        - legacy: usa R2 directo (cloud_manager)
        - web: usa /web/drivers con Bearer
        - auto: prefiere web si hay token; fallback legacy
        """
        auth_mode = self._resolve_desktop_auth_mode()
        if self.user_manager:
            auth_mode = str(getattr(self.user_manager, "auth_mode", auth_mode)).strip().lower() or auth_mode

        has_web_session = bool(self._resolve_current_web_token())

        if auth_mode == "web":
            return self._get_or_create_web_driver_manager() if has_web_session else None
        if auth_mode == "auto":
            if has_web_session:
                return self._get_or_create_web_driver_manager()
            if self.cloud_manager:
                return self.cloud_manager
            return None
        return self.cloud_manager

    def _is_web_session_active(self):
        """Indica si hay sesión web (Bearer) activa en el desktop."""
        auth_mode = self._resolve_desktop_auth_mode()
        if self.user_manager:
            auth_mode = str(getattr(self.user_manager, "auth_mode", auth_mode)).strip().lower() or auth_mode
        return auth_mode in ("web", "auto") and bool(self._resolve_current_web_token())

    def _is_web_auth_context(self):
        """Indica si el runtime debe operar en experiencia web-first (sin exigir R2)."""
        auth_mode = self._resolve_desktop_auth_mode()
        current_user = None
        if self.user_manager:
            auth_mode = str(getattr(self.user_manager, "auth_mode", auth_mode)).strip().lower() or auth_mode
            current_user = getattr(self.user_manager, "current_user", None) or {}

        if auth_mode in ("web", "auto"):
            return True
        if str((current_user or {}).get("source") or "").strip().lower() == "web":
            return True
        return bool(self._resolve_current_web_token())

    def _init_managers(self):
        """Inicializar todos los managers"""
        initialize_manager_state(
            self,
            portable_mode=PORTABLE_MODE,
            portable_config=PORTABLE_CONFIG,
            get_cache_dir=get_cache_dir if 'get_cache_dir' in globals() else None,
            logger=logger,
        )
    
    def _init_ui(self):
        """Inicializar interfaz de usuario"""
        build_main_window_ui(self)

    def _show_status_hint(self, message, level="info", timeout_ms=4200):
        """Mostrar feedback breve en la barra de estado con tono contextual."""
        tone = str(level or "info").strip().lower()
        prefix = {
            "success": "✅",
            "warning": "⚠️",
            "error": "❌",
            "info": "ℹ️",
        }.get(tone, "ℹ️")
        self.statusBar().showMessage(f"{prefix} {message}", timeout_ms)
    
    def _init_handlers(self):
        """Inicializar manejadores"""
        initialize_window_handlers(self)
        
    def _setup_connections(self):
        """Configurar conexiones de señales"""
        setup_main_window_connections(self)

    def _is_user_authenticated(self):
        """Retornar si hay una sesión autenticada activa."""
        return is_user_authenticated(self)

    def _current_user_role(self):
        """Obtener rol actual de usuario autenticado."""
        return current_user_role(self)

    def _apply_navigation_access_control(self):
        """Aplicar acceso a tabs y acciones según estado de sesión/rol."""
        apply_navigation_access_control(self)

    def _on_tab_changed(self, tab_index):
        """Evitar navegación a tabs deshabilitados."""
        handle_tab_changed(self, tab_index)
    
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
            self._sync_history_web_token_provider()
            
            # 3. Inicializar el UserManagerV2
            # Intentar modo nube primero, fallback a local
            self.user_manager = UserManagerV2(
                self.cloud_manager, 
                self.security_manager,
                local_mode=False,
                audit_api_client=self.history_manager,
                auth_mode=self._resolve_desktop_auth_mode(),
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
        backend = self.resolve_driver_backend()
        if not backend:
            self.all_drivers = []
            self.drivers_tab.drivers_list.clear()
            if hasattr(self, "admin_tab"):
                self.admin_tab.admin_drivers_list.clear()
            if self._resolve_desktop_auth_mode() in ("web", "auto"):
                if not self.user_manager or not self.user_manager.current_user:
                    self.statusBar().showMessage("ℹ️ Inicia sesión para cargar drivers.", 4000)
            return
        
        try:
            drivers = backend.list_drivers()
            self.all_drivers = drivers

            # Actualizar dinámicamente el filtro de marcas
            current_brand = self.drivers_tab.brand_filter.currentText()
            brands = sorted(list(set(d.get('brand') for d in drivers if isinstance(d, dict) and d.get('brand'))))

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
            if not isinstance(driver, dict):
                continue
            brand = driver.get('brand', 'N/A')
            version = driver.get('version', 'N/A')
            if brand_filter == "Todas" or brand == brand_filter:
                item = QListWidgetItem(f"{brand} - v{version}")
                item.setData(Qt.ItemDataRole.UserRole, driver)
                self.drivers_tab.drivers_list.addItem(item)
    
    def on_history_view_changed(self, view_name):
        """Cambiar vista del historial."""
        _ = view_name
        current_index = self.history_tab.history_view_combo.currentIndex()
        self.history_tab.history_stack.setCurrentIndex(current_index)

        # 3: Reportes, 4: Gestión de Registros
        if current_index == 4:
            self._update_management_stats()
            self.refresh_history_view()
        elif current_index == 3:
            self.report_handlers.refresh_reports_preview()

    def _on_history_item_changed(self, item, _previous=None):
        """Sincronizar estado de botones según selección de historial."""
        has_selection = item is not None
        self.history_tab.edit_button.setEnabled(
            has_selection and bool(getattr(self, "can_manage_operational_records", self.is_admin))
        )
        if hasattr(self.history_tab, "view_incidents_button"):
            self.history_tab.view_incidents_button.setEnabled(has_selection)

    def refresh_history_view(self):
        """Actualizar vista actual del historial"""
        if (
            self._resolve_desktop_auth_mode() == "web"
            and not self._resolve_current_web_token()
        ):
            self.history_tab.history_list.clear()
            self.history_tab.edit_button.setEnabled(False)
            if hasattr(self.history_tab, "view_incidents_button"):
                self.history_tab.view_incidents_button.setEnabled(False)
            return

        try:
            installations = self.history.get_installations(limit=10)
            self.history_tab.history_list.clear()
            self.history_tab.edit_button.setEnabled(False)
            if hasattr(self.history_tab, "view_incidents_button"):
                self.history_tab.view_incidents_button.setEnabled(False)
            
            for inst in installations:
                timestamp = datetime.fromisoformat(inst['timestamp'])
                date_str = timestamp.strftime('%d/%m/%Y %H:%M')
                
                brand = inst.get('driver_brand') or "N/A"
                version = inst.get('driver_version') or "N/A"
                attention_label = self._record_attention_label(inst.get("attention_state"))
                attention_icon = self._record_attention_icon(inst.get("attention_state"))
                active_incidents = self._coerce_seconds(inst.get("incident_active_count"), allow_negative=False)
                text = f"{date_str} - {brand} v{version}"
                if inst['client_name']:
                    text += f" ({inst['client_name']})"
                if active_incidents > 0:
                    text += f" | {attention_icon} {attention_label} ({active_incidents})"
                else:
                    text += f" | {attention_icon} {attention_label}"
                
                item = QListWidgetItem(text)
                item.setData(Qt.ItemDataRole.UserRole, inst['id']) # Guardamos el ID
                self.history_tab.history_list.addItem(item)
        except Exception as e:
            logger.error(f"Error cargando historial: {e}", exc_info=True)
    
    def refresh_current_history_view(self):
        """Actualizar la vista actual del historial incluyendo estadísticas."""
        current_index = self.history_tab.history_view_combo.currentIndex()

        if current_index == 4:
            self._update_management_stats()
        elif current_index == 3:
            self.report_handlers.refresh_reports_preview()
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

    def _coerce_seconds(self, raw_value, allow_negative=False):
        """Normalizar valores de tiempo en segundos."""
        try:
            value = int(float(raw_value or 0))
        except (TypeError, ValueError):
            return 0
        if allow_negative:
            return value
        return max(0, value)

    def _format_duration(self, raw_value):
        """Formatear segundos a cadena legible (d/h/m/s)."""
        total_seconds = self._coerce_seconds(raw_value, allow_negative=True)
        if total_seconds == 0:
            return "0s"

        sign = "-" if total_seconds < 0 else ""
        remaining = abs(total_seconds)

        days, remaining = divmod(remaining, 86400)
        hours, remaining = divmod(remaining, 3600)
        minutes, seconds = divmod(remaining, 60)

        parts = []
        if days:
            parts.append(f"{days}d")
        if hours:
            parts.append(f"{hours}h")
        if minutes:
            parts.append(f"{minutes}m")
        if seconds or not parts:
            parts.append(f"{seconds}s")
        return sign + " ".join(parts)

    def _parse_duration_input_seconds(self, raw_value):
        """Parsear duración ingresada por usuario: 90, 90s, 5m, 1h30m, -2m."""
        text = str(raw_value or "").strip().lower()
        if not text:
            return 0

        if re.fullmatch(r"[+-]?\d+", text):
            return int(text)

        sign = 1
        if text[0] in "+-":
            sign = -1 if text[0] == "-" else 1
            text = text[1:].strip()

        compact = text.replace(" ", "")
        match = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?", compact)
        if not match or not any(match.groups()):
            raise ValueError("Formato de duración inválido")

        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        seconds = int(match.group(3) or 0)
        return sign * (hours * 3600 + minutes * 60 + seconds)

    def _normalize_incident_status(self, raw_value):
        return normalize_incident_status(self, raw_value)

    def _incident_status_label(self, raw_value):
        return incident_status_label(self, raw_value)

    def _format_incident_datetime_label(self, raw_value):
        return format_incident_datetime_label(self, raw_value)

    def _incident_severity_label(self, raw_value):
        return incident_severity_label(self, raw_value)

    def _render_incident_detail_html(self, incident):
        return render_incident_detail_html(self, incident)

    def _normalize_record_attention_state(self, raw_value):
        return normalize_record_attention_state(self, raw_value)

    def _record_attention_label(self, raw_value):
        return record_attention_label(self, raw_value)

    def _record_attention_icon(self, raw_value):
        return record_attention_icon(self, raw_value)

    def apply_incidents_filters(self):
        apply_incidents_filters_helper(self)

    def _build_photo_thumbnail_icon(self, photo_id):
        return build_photo_thumbnail_icon(self, photo_id)

    def _queue_thumbnail_load(self, photo_id):
        queue_thumbnail_load(self, photo_id, worker_cls=_ThumbnailWorker)

    def _on_thumbnail_loaded(self, photo_id, photo_bytes):
        handle_thumbnail_loaded(self, photo_id, photo_bytes)

    def _on_thumbnail_failed(self, photo_id, _error):
        handle_thumbnail_failed(self, photo_id, _error)

    def refresh_incidents_view(self, preferred_record_id=None):
        refresh_incidents_view_helper(self, preferred_record_id=preferred_record_id)

    def _on_incidents_installation_changed(self, current, _previous=None):
        handle_incidents_installation_changed(self, current, _previous)

    def _on_incident_item_changed(self, current, _previous=None):
        handle_incident_item_changed(self, current, _previous, worker_cls=_ThumbnailWorker)

    def create_incident_from_incidents_view(self):
        create_incident_from_incidents_view_helper(self)

    def upload_photo_for_selected_incident(self):
        upload_photo_for_selected_incident_helper(self)

    def refresh_incident_assignments(self):
        refresh_incident_assignments_helper(self)

    def assign_technician_to_selected_incident(self):
        assign_technician_to_selected_incident_helper(self)

    def remove_selected_incident_assignment(self):
        remove_selected_incident_assignment_helper(self)

    def refresh_installation_assignments(self):
        refresh_installation_assignments_helper(self)

    def assign_technician_to_selected_installation(self):
        assign_technician_to_selected_installation_helper(self)

    def remove_selected_installation_assignment(self):
        remove_selected_installation_assignment_helper(self)

    def update_selected_incident_status(self, new_status):
        update_selected_incident_status_helper(self, new_status)

    def view_selected_incident_photo(self):
        view_selected_incident_photo_helper(self)

    def _update_management_stats(self):
        """Actualizar estadísticas y logs en la vista de gestión de registros"""
        if (
            self._resolve_desktop_auth_mode() == "web"
            and not self._resolve_current_web_token()
        ):
            self.history_tab.mgmt_stats_display.setText(
                "📊 ESTADÍSTICAS ACTUALES:\n\n• Inicia sesión para cargar estadísticas."
            )
            self.history_tab.management_history_list.clear()
            return

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
                
                brand = inst.get('driver_brand') or "N/A"
                version = inst.get('driver_version') or "N/A"
                text = f"{date_str} - {brand} v{version}"
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
        if not bool(getattr(self, "can_manage_operational_records", self.is_admin)):
            QMessageBox.warning(
                self,
                "Acceso denegado",
                "Tu sesión no tiene permisos para crear registros manuales.",
            )
            return

        self._show_status_hint(
            "Completá los datos del registro manual. Puedes dejar cliente/marca/versión como opcional.",
            "info",
            5200,
        )

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
            status="manual",
            notes=(notes or "").strip(),
            driver_description="Registro manual desde .exe",
        )

        if success:
            record_id = record.get("id") if isinstance(record, dict) else None
            message = "Registro manual creado correctamente."
            if record_id:
                message += f"\nID: {record_id}"
            QMessageBox.information(self, "Éxito", message)
            self._show_status_hint(
                "Registro manual creado. Ya puedes asociar equipo o cargar una incidencia.",
                "success",
                5200,
            )

            if self.user_manager and self.user_manager.current_user:
                self.user_manager._log_access(
                    action="create_manual_record_success",
                    username=self.user_manager.current_user.get('username'),
                    success=True,
                    details={
                        "record_id": record_id,
                        "status": "manual",
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
            self._show_status_hint(
                "No se pudo crear el registro manual. Verifica conexión/API e intenta nuevamente.",
                "error",
                5200,
            )

            if self.user_manager and self.user_manager.current_user:
                self.user_manager._log_access(
                    action="create_manual_record_failed",
                    username=self.user_manager.current_user.get('username'),
                    success=False,
                    details={"status": "manual"},
                )

    def show_incidents_for_selected_record(self):
        show_incidents_for_selected_record_helper(self)

    def create_incident_for_record(self, record_id):
        create_incident_for_record_helper(self, record_id)

    def _show_incident_details(self, incident):
        show_incident_details(self, incident)

    def _select_incident_photo(self, incident):
        select_incident_photo(self, incident)

    def _open_photo_viewer(self, photo_id, title):
        open_photo_viewer(self, photo_id, title)

    def _upload_photo_for_incident(self, incident_id):
        upload_photo_for_incident(self, incident_id)

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
                backend = self.resolve_driver_backend()
                if not backend:
                    raise RuntimeError("No hay backend de drivers disponible. Inicia sesión nuevamente.")
                backend.delete_driver(driver['key'])
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
        if not bool(getattr(self, "can_manage_operational_records", self.is_admin)):
            QMessageBox.warning(
                self,
                "Acceso Denegado",
                "Tu sesión no tiene permisos para editar registros de instalación.",
            )
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
        run_login_dialog(self, logger=logger)

    def on_admin_logout(self):
        """Manejar cierre de sesión y actualizar UI"""
        run_admin_logout(self)
    
    def show_user_management(self):
        """Mostrar diálogo de gestión de usuarios"""
        if not self.user_manager or not self.user_manager.current_user:
            QMessageBox.warning(self, "Error", "Debes iniciar sesión primero")
            return
        
        dialog = UserManagementDialog(
            self.user_manager,
            history_manager=self.history,
            parent=self,
        )
        dialog.exec()

    def show_qr_generator_dialog(self):
        """Abrir generador QR offline para asset/installation."""
        default_type = "asset"
        default_value = ""
        selected_items = self.drivers_tab.drivers_list.selectedItems()
        if selected_items:
            selected_driver = selected_items[0].data(Qt.ItemDataRole.UserRole) or {}
            brand = str(selected_driver.get("brand") or "").strip()
            version = str(selected_driver.get("version") or "").strip()
            if brand or version:
                default_value = f"{brand}-{version}".strip("-")
        dialog = QrGeneratorDialog(
            self,
            qr_type=default_type,
            value=default_value,
            history_manager=self.history,
        )
        dialog.exec()

    def show_asset_link_dialog(self):
        """Asociar equipo a instalación sin crear incidencia."""
        if not self.history:
            QMessageBox.warning(self, "Error", "Módulo de historial no disponible.")
            return

        default_asset_code = ""
        selected_items = self.drivers_tab.drivers_list.selectedItems()
        if selected_items:
            selected_driver = selected_items[0].data(Qt.ItemDataRole.UserRole) or {}
            brand = str(selected_driver.get("brand") or "").strip()
            version = str(selected_driver.get("version") or "").strip()
            if brand or version:
                default_asset_code = f"{brand}-{version}".strip("-")

        asset_code, ok = QInputDialog.getText(
            self,
            "Asociar equipo",
            "Código externo del equipo (QR/serie):",
            QLineEdit.EchoMode.Normal,
            default_asset_code,
        )
        if not ok:
            return
        asset_code = str(asset_code or "").strip()
        if not asset_code:
            QMessageBox.warning(self, "Dato inválido", "Debes ingresar el código del equipo.")
            return

        installation_id_default = ""
        current_item = self.history_tab.history_list.currentItem() if hasattr(self.history_tab, "history_list") else None
        if current_item and current_item.data(Qt.ItemDataRole.UserRole):
            try:
                installation_id_default = str(int(current_item.data(Qt.ItemDataRole.UserRole).get("id")))
            except Exception:
                installation_id_default = ""

        installation_id_text, ok = QInputDialog.getText(
            self,
            "Asociar equipo",
            "ID de registro destino:",
            QLineEdit.EchoMode.Normal,
            installation_id_default,
        )
        if not ok:
            return

        try:
            installation_id = int(str(installation_id_text or "").strip())
            if installation_id <= 0:
                raise ValueError
        except Exception:
            QMessageBox.warning(self, "Dato inválido", "El ID de registro debe ser un entero positivo.")
            return

        notes, ok = QInputDialog.getMultiLineText(
            self,
            "Asociar equipo",
            "Nota opcional de asociación:",
            "",
        )
        if not ok:
            return

        try:
            asset, link = self.history.associate_asset_with_installation(
                external_code=asset_code,
                installation_id=installation_id,
                notes=notes,
            )
            resolved_code = str((asset or {}).get("external_code") or asset_code)
            linked_installation = (link or {}).get("installation_id") or installation_id
            QMessageBox.information(
                self,
                "Asociación completada",
                (
                    f"Equipo asociado correctamente.\n\n"
                    f"Equipo: {resolved_code}\n"
                    f"Registro: #{linked_installation}"
                ),
            )
            self.statusBar().showMessage("✅ Equipo asociado a registro", 5000)
        except Exception as e:
            QMessageBox.critical(self, "Error", f"No se pudo asociar el equipo:\n{e}")

    def show_asset_management_dialog(self):
        """Abrir panel de gestion de equipos."""
        if not self.history:
            QMessageBox.warning(self, "Error", "Modulo de historial no disponible.")
            return

        can_delete = False
        if self.user_manager and hasattr(self.user_manager, "is_super_admin"):
            try:
                can_delete = bool(self.user_manager.is_super_admin())
            except Exception:
                can_delete = False

        dialog = AssetManagementDialog(
            history_manager=self.history,
            parent=self,
            can_edit=self.is_admin,
            can_delete=can_delete,
        )
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

            if hasattr(self.drivers_tab, "drop_zone"):
                self.drivers_tab.drop_zone.refresh_theme()
            
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
