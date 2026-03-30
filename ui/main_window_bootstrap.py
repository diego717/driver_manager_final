from pathlib import Path

from PyQt6.QtCore import QThreadPool, Qt
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QProgressBar,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from handlers.event_handlers import EventHandlers
from handlers.report_handlers import ReportHandlers
from managers.download_manager import DownloadManager
from managers.history_manager import InstallationHistory
from managers.installer import DriverInstaller
from reports.report_generator import ReportGenerator
from ui.theme_manager import ThemeManager
from ui.ui_components import AdminTab, DriversTab, HistoryTab


def initialize_manager_state(
    window,
    *,
    portable_mode,
    portable_config,
    get_cache_dir=None,
    theme_manager_cls=ThemeManager,
    installer_cls=DriverInstaller,
    history_cls=InstallationHistory,
    report_generator_cls=ReportGenerator,
    thread_pool_factory=None,
    path_home=None,
    logger=None,
):
    """Inicializar estado base y managers compartidos del MainWindow."""
    window.cloud_manager = None
    window.history_manager = None
    window.web_driver_manager = None
    window.security_manager = window.config_manager.security
    window.theme_manager = theme_manager_cls()
    window.user_manager = None
    window.installer = installer_cls()
    window.history = history_cls(window.config_manager)
    window._sync_history_web_token_provider()
    window.report_gen = report_generator_cls(window.history)
    window.is_authenticated = False
    window.is_admin = False
    window.is_super_admin = False
    window.is_read_only = False
    window.tenant_id = ""
    window.can_manage_tenant_catalog = False
    window.can_manage_platform = False
    window.can_manage_operational_records = False
    window.can_operate_incidents = False
    window.installation_start_time = None
    window._audit_logs_repair_attempted = False
    window._photo_thumbnail_cache = {}
    window._thumbnail_inflight = set()
    window._thumbnail_item_map = {}

    if thread_pool_factory is None:
        thread_pool_factory = QThreadPool.globalInstance
    window._thumbnail_pool = thread_pool_factory()

    default_home = path_home if path_home is not None else Path.home()
    cache_dir = default_home / ".driver_manager" / "cache"
    if portable_mode and portable_config and callable(get_cache_dir):
        try:
            cache_dir = get_cache_dir()
            if logger:
                logger.info(f"Usando cache portable: {cache_dir}")
        except Exception:
            cache_dir = default_home / ".driver_manager" / "cache"

    window.cache_dir = Path(cache_dir)
    window.cache_dir.mkdir(parents=True, exist_ok=True)


def build_main_window_ui(window):
    """Construir widgets base de la ventana principal."""
    if not isinstance(window, QMainWindow):
        raise TypeError("build_main_window_ui requiere una instancia de QMainWindow")

    central_widget = QWidget()
    central_widget.setObjectName("appShell")
    window.setCentralWidget(central_widget)
    main_layout = QVBoxLayout(central_widget)
    main_layout.setContentsMargins(20, 18, 20, 16)
    main_layout.setSpacing(12)

    header_container = QWidget()
    header_container.setObjectName("appHeader")
    header_layout = QHBoxLayout(header_container)
    header_layout.setContentsMargins(14, 12, 14, 12)
    header_layout.setSpacing(10)

    title_block = QVBoxLayout()
    title_block.setContentsMargins(0, 0, 0, 0)
    title_block.setSpacing(2)
    header_title = QLabel("SiteOps Console")
    header_title.setProperty("class", "appHeaderTitle")
    title_block.addWidget(header_title)

    header_subtitle = QLabel("Operaciones de drivers, incidencias y activos en una sola vista.")
    header_subtitle.setProperty("class", "appHeaderSubtitle")
    title_block.addWidget(header_subtitle)
    header_layout.addLayout(title_block, 1)

    header_badge = QLabel("Windows")
    header_badge.setProperty("class", "appHeaderBadge")
    header_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
    header_layout.addWidget(header_badge, 0, Qt.AlignmentFlag.AlignTop)
    main_layout.addWidget(header_container)

    window.tabs = QTabWidget()
    window.tabs.setObjectName("mainTabs")
    main_layout.addWidget(window.tabs)

    window.drivers_tab = DriversTab(window)
    window.drivers_tab_index = window.tabs.addTab(window.drivers_tab, "Drivers disponibles")

    window.history_tab = HistoryTab(window)
    window.history_tab_index = window.tabs.addTab(window.history_tab, "Historial y reportes")

    window.incidents_tab = window.history_tab.incidents_widget
    window.incidents_tab_index = window.tabs.addTab(window.incidents_tab, "Incidencias")

    window.admin_tab = AdminTab(window)
    window.admin_tab_index = window.tabs.addTab(window.admin_tab, "Administracion")

    window.statusBar().showMessage("Listo para operar")

    window.progress_bar = QProgressBar()
    window.progress_bar.setObjectName("globalProgress")
    window.progress_bar.setVisible(False)
    main_layout.addWidget(window.progress_bar)


def initialize_window_handlers(
    window,
    *,
    download_manager_cls=DownloadManager,
    event_handlers_cls=EventHandlers,
    report_handlers_cls=ReportHandlers,
):
    """Inicializar handlers asociados a la ventana principal."""
    window.download_manager = download_manager_cls(window)
    window.event_handlers = event_handlers_cls(window)
    window.report_handlers = report_handlers_cls(window)
