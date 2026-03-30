"""
Componentes de UI para Driver Manager
"""

from pathlib import Path
from datetime import datetime

from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton,
                             QListWidget, QLabel, QLineEdit, QComboBox, QTextEdit,
                             QListWidgetItem, QGroupBox, QStackedWidget, QDialog,
                             QSpinBox, QDialogButtonBox, QInputDialog, QMessageBox,
                             QBoxLayout, QSizePolicy, QScrollArea, QGridLayout,
                             QSplitter, QFrame)
from PyQt6.QtCore import Qt, QSize
from PyQt6.QtGui import QFont

from core.logger import get_logger
from ui.widgets.drop_zone_widget import DropZoneWidget
from ui.dialogs.quick_upload_dialog import QuickUploadDialog


logger = get_logger()


class DriversTab(QWidget):
    """Tab principal de drivers"""

    LAYOUT_BREAKPOINT = 1220

    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.init_ui()

    def init_ui(self):
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        root_layout.addWidget(scroll)

        canvas = QWidget()
        canvas.setObjectName("driversCanvas")
        scroll.setWidget(canvas)

        layout = QVBoxLayout(canvas)
        layout.setContentsMargins(16, 12, 16, 18)
        layout.setSpacing(18)

        header_layout = QVBoxLayout()
        header_layout.setSpacing(6)

        eyebrow = QLabel("DRIVERS / CATALOGO OPERATIVO")
        eyebrow.setProperty("class", "chip")
        header_layout.addWidget(eyebrow, 0, Qt.AlignmentFlag.AlignLeft)

        header_title = QLabel("Drivers disponibles")
        header_title.setProperty("class", "heroTitle")
        header_layout.addWidget(header_title)

        header_meta = QLabel(
            "Una consola clara para explorar paquetes, revisar detalle tecnico y mover "
            "la carga administrativa a un rail secundario."
        )
        header_meta.setWordWrap(True)
        header_meta.setProperty("class", "sectionMeta")
        header_layout.addWidget(header_meta)
        layout.addLayout(header_layout)

        hero_strip = QWidget()
        hero_strip.setObjectName("driversHeroStrip")
        self.hero_metrics_layout = QBoxLayout(QBoxLayout.Direction.LeftToRight)
        self.hero_metrics_layout.setContentsMargins(0, 0, 0, 0)
        self.hero_metrics_layout.setSpacing(12)
        hero_strip.setLayout(self.hero_metrics_layout)
        layout.addWidget(hero_strip)

        self.hero_metrics_layout.addWidget(
            self._create_metric_card("Catalogo vivo", "Filtra por marca y entra directo al paquete.")
        )
        self.hero_metrics_layout.addWidget(
            self._create_metric_card("Instalacion directa", "Descarga o ejecuta sin perder contexto del detalle.")
        )
        self.hero_metrics_layout.addWidget(
            self._create_metric_card("Rail administrativo", "La carga queda aparte para no mezclar navegacion y administracion.")
        )

        self.workspace_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.workspace_splitter.setChildrenCollapsible(False)
        self.workspace_splitter.setHandleWidth(10)
        layout.addWidget(self.workspace_splitter, 1)

        self.catalog_panel = self._create_catalog_panel()
        self.details_panel = self._create_details_panel()
        self.operations_panel = self._create_operations_panel()

        self.workspace_splitter.addWidget(self.catalog_panel)
        self.workspace_splitter.addWidget(self.details_panel)
        self.workspace_splitter.addWidget(self.operations_panel)
        self.workspace_splitter.setStretchFactor(0, 5)
        self.workspace_splitter.setStretchFactor(1, 4)
        self.workspace_splitter.setStretchFactor(2, 3)

        self._update_workspace_mode()

    def _create_metric_card(self, title, meta):
        card = QWidget()
        card.setObjectName("driversMetricCard")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(16, 14, 16, 14)
        card_layout.setSpacing(4)

        title_label = QLabel(title)
        title_label.setProperty("class", "metricValue")
        card_layout.addWidget(title_label)

        meta_label = QLabel(meta)
        meta_label.setWordWrap(True)
        meta_label.setProperty("class", "metricMeta")
        card_layout.addWidget(meta_label)
        card_layout.addStretch()
        return card

    def toggle_upload_section(self, visible: bool):
        """Mostrar u ocultar seccion de subida"""
        self.upload_container.setVisible(visible)
        self._update_workspace_mode()

    def resizeEvent(self, event):
        """Adapt the panel distribution to the available width."""
        super().resizeEvent(event)
        self._update_workspace_mode()

    def _create_catalog_panel(self):
        """Create the browsing panel for the available drivers."""
        catalog_group = QGroupBox("Catalogo operativo")
        catalog_group.setObjectName("driversCatalogPanel")
        catalog_layout = QVBoxLayout(catalog_group)
        catalog_layout.setSpacing(14)

        top_row = QHBoxLayout()
        top_row.setSpacing(8)

        title_block = QVBoxLayout()
        title_block.setSpacing(2)
        catalog_title = QLabel("Exploracion")
        catalog_title.setProperty("class", "sectionTitle")
        title_block.addWidget(catalog_title)

        catalog_hint = QLabel(
            "Navega por marca y selecciona un paquete para abrir el panel tecnico."
        )
        catalog_hint.setWordWrap(True)
        catalog_hint.setProperty("class", "sectionMeta")
        title_block.addWidget(catalog_hint)
        top_row.addLayout(title_block, 1)

        self.catalog_context_label = QLabel("Exploracion activa")
        self.catalog_context_label.setProperty("class", "chip")
        top_row.addWidget(self.catalog_context_label, 0, Qt.AlignmentFlag.AlignTop)
        catalog_layout.addLayout(top_row)

        self.catalog_controls_layout = QBoxLayout(QBoxLayout.Direction.LeftToRight)
        self.catalog_controls_layout.setContentsMargins(0, 0, 0, 0)
        self.catalog_controls_layout.setSpacing(10)

        filter_column = QVBoxLayout()
        filter_column.setSpacing(6)
        filter_label = QLabel("Fabricante")
        filter_label.setProperty("class", "sectionMeta")
        filter_column.addWidget(filter_label)

        self.brand_filter = QComboBox()
        self.brand_filter.addItems(["Todas", "Magicard", "Zebra", "Entrust Sigma"])
        self.brand_filter.setToolTip("Filtrar la lista de controladores por fabricante")
        self.brand_filter.setAccessibleName("Filtro de marca")
        filter_column.addWidget(self.brand_filter)
        self.catalog_controls_layout.addLayout(filter_column, 1)

        self.refresh_btn = QPushButton("Actualizar lista")
        self.refresh_btn.setMaximumWidth(180)
        self.refresh_btn.setToolTip("Actualizar la lista de controladores desde la nube")
        self.refresh_btn.setAccessibleName("Actualizar lista de drivers")
        self.refresh_btn.setAccessibleDescription("Recarga la lista de drivers disponibles desde la nube")
        self.catalog_controls_layout.addWidget(self.refresh_btn, 0, Qt.AlignmentFlag.AlignBottom)
        self.catalog_controls_layout.addStretch()
        catalog_layout.addLayout(self.catalog_controls_layout)

        self.drivers_list = QListWidget()
        self.drivers_list.setObjectName("driversCatalogList")
        self.drivers_list.setMinimumHeight(420)
        self.drivers_list.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Expanding,
        )
        catalog_layout.addWidget(self.drivers_list, 1)
        return catalog_group

    def _create_details_panel(self):
        """Create the detail panel for the selected driver."""
        details_group = QGroupBox("Paquete seleccionado")
        details_group.setObjectName("driversDetailPanel")
        details_layout = QVBoxLayout(details_group)
        details_layout.setSpacing(14)

        heading_row = QHBoxLayout()
        heading_row.setSpacing(8)

        title_block = QVBoxLayout()
        title_block.setSpacing(2)
        details_title = QLabel("Detalle tecnico")
        details_title.setProperty("class", "sectionTitle")
        title_block.addWidget(details_title)

        details_hint = QLabel(
            "Version, descripcion, fecha y contexto del paquete en una vista de lectura comoda."
        )
        details_hint.setWordWrap(True)
        details_hint.setProperty("class", "sectionMeta")
        title_block.addWidget(details_hint)
        heading_row.addLayout(title_block, 1)

        detail_chip = QLabel("Lectura")
        detail_chip.setProperty("class", "chip")
        heading_row.addWidget(detail_chip, 0, Qt.AlignmentFlag.AlignTop)
        details_layout.addLayout(heading_row)

        self.detail_state_label = QLabel(
            "Sin seleccion. Elige un driver del catalogo para ver version, tamano y descripcion."
        )
        self.detail_state_label.setProperty("class", "info")
        self.detail_state_label.setWordWrap(True)
        details_layout.addWidget(self.detail_state_label)

        self.driver_details = QTextEdit()
        self.driver_details.setReadOnly(True)
        self.driver_details.setProperty("class", "logPanel")
        self.driver_details.setObjectName("driverDetailsPane")
        self.driver_details.setMinimumHeight(340)
        self.driver_details.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Expanding,
        )
        self.driver_details.setPlaceholderText(
            "Marca, version, fecha de publicacion y descripcion apareceran aqui."
        )
        details_layout.addWidget(self.driver_details, 1)

        action_header = QVBoxLayout()
        action_header.setSpacing(2)
        action_title = QLabel("Acciones principales")
        action_title.setProperty("class", "sectionTitle")
        action_header.addWidget(action_title)

        action_meta = QLabel(
            "Usa una descarga local o dispara la instalacion directa desde esta barra compacta."
        )
        action_meta.setWordWrap(True)
        action_meta.setProperty("class", "sectionMeta")
        action_header.addWidget(action_meta)
        details_layout.addLayout(action_header)

        self.primary_actions_layout = QBoxLayout(QBoxLayout.Direction.LeftToRight)
        self.primary_actions_layout.setContentsMargins(0, 0, 0, 0)
        self.primary_actions_layout.setSpacing(8)

        self.download_btn = QPushButton("Descargar")
        self.download_btn.setEnabled(False)
        self.download_btn.setMaximumWidth(170)
        self.download_btn.setToolTip("Descargar el controlador seleccionado a la cache local")
        self.download_btn.setObjectName("driverDownloadButton")
        self.primary_actions_layout.addWidget(self.download_btn)

        self.install_btn = QPushButton("Descargar e instalar")
        self.install_btn.setEnabled(False)
        self.install_btn.setMaximumWidth(210)
        self.install_btn.setToolTip("Descargar y ejecutar el instalador del controlador seleccionado")
        self.install_btn.setProperty("class", "primary")
        self.install_btn.setObjectName("driverInstallButton")
        self.primary_actions_layout.addWidget(self.install_btn)
        self.primary_actions_layout.addStretch()
        details_layout.addLayout(self.primary_actions_layout)
        return details_group

    def _create_operations_panel(self):
        """Create the secondary operations panel."""
        panel = QWidget()
        panel.setObjectName("driversOperationsPanel")
        panel_layout = QVBoxLayout(panel)
        panel_layout.setContentsMargins(0, 0, 0, 0)
        panel_layout.setSpacing(16)

        tools_group = QGroupBox("Herramientas de equipo")
        tools_group.setObjectName("driversRailCard")
        tools_layout = QVBoxLayout(tools_group)
        tools_layout.setSpacing(10)

        tools_meta = QLabel(
            "Acciones rapidas para QR, asociacion de activos y gestion del inventario."
        )
        tools_meta.setWordWrap(True)
        tools_meta.setProperty("class", "sectionMeta")
        tools_layout.addWidget(tools_meta)

        self.tools_state_label = QLabel("Quick actions")
        self.tools_state_label.setProperty("class", "chip")
        tools_layout.addWidget(self.tools_state_label, 0, Qt.AlignmentFlag.AlignLeft)

        self.generate_qr_btn = QPushButton(
            "QR equipo\nGenera un codigo local para vincular activos"
        )
        self.generate_qr_btn.setProperty("class", "quickAction")
        self.generate_qr_btn.setObjectName("teamActionButton")
        self.generate_qr_btn.setMaximumWidth(320)
        self.generate_qr_btn.setToolTip("Generar un codigo QR local para asociar equipos o instalaciones")
        tools_layout.addWidget(self.generate_qr_btn, 0, Qt.AlignmentFlag.AlignLeft)

        self.associate_asset_btn = QPushButton(
            "Asociar equipo\nVincula un activo sin abrir una incidencia"
        )
        self.associate_asset_btn.setProperty("class", "quickAction")
        self.associate_asset_btn.setObjectName("teamActionButton")
        self.associate_asset_btn.setMaximumWidth(320)
        self.associate_asset_btn.setToolTip("Asociar un equipo a una instalacion sin crear incidencia")
        tools_layout.addWidget(self.associate_asset_btn, 0, Qt.AlignmentFlag.AlignLeft)

        self.manage_assets_btn = QPushButton(
            "Gestion de equipos\nAdministra inventario, historial y relaciones"
        )
        self.manage_assets_btn.setProperty("class", "quickAction")
        self.manage_assets_btn.setObjectName("teamActionButton")
        self.manage_assets_btn.setMaximumWidth(320)
        self.manage_assets_btn.setToolTip("Abrir panel de gestion de equipos")
        tools_layout.addWidget(self.manage_assets_btn, 0, Qt.AlignmentFlag.AlignLeft)
        panel_layout.addWidget(tools_group)

        self.upload_container = QWidget()
        self.upload_container.setVisible(False)
        self.upload_container.setSizePolicy(
            QSizePolicy.Policy.Preferred,
            QSizePolicy.Policy.Maximum,
        )

        upload_layout = QVBoxLayout(self.upload_container)
        upload_layout.setContentsMargins(0, 0, 0, 0)
        upload_layout.setSpacing(12)

        upload_header = QVBoxLayout()
        upload_header.setSpacing(4)
        upload_title = QLabel("Carga administrativa")
        upload_title.setProperty("class", "sectionTitle")
        upload_header.addWidget(upload_title)

        upload_meta = QLabel(
            "La publicacion del paquete vive en un rail aparte para no mezclar navegacion y administracion."
        )
        upload_meta.setWordWrap(True)
        upload_meta.setProperty("class", "sectionMeta")
        upload_header.addWidget(upload_meta)
        upload_layout.addLayout(upload_header)

        self.upload_state_label = QLabel("Zona de carga lista")
        self.upload_state_label.setProperty("class", "chip")
        upload_layout.addWidget(self.upload_state_label, 0, Qt.AlignmentFlag.AlignLeft)

        self._create_drag_drop_upload_section(upload_layout)
        self._create_upload_section(upload_layout)
        panel_layout.addWidget(self.upload_container)
        panel_layout.addStretch()
        return panel

    def _create_drag_drop_upload_section(self, layout):
        """Crear seccion de upload con drag and drop"""
        upload_group = QGroupBox("Arrastra o selecciona")
        upload_group.setObjectName("driversUploadDropCard")
        upload_layout = QVBoxLayout(upload_group)
        upload_layout.setSpacing(10)

        instructions = QLabel(
            "Acepta archivos .exe, .zip o .msi. Puedes arrastrar el paquete o hacer clic en la zona."
        )
        instructions.setWordWrap(True)
        instructions.setProperty("class", "sectionMeta")
        upload_layout.addWidget(instructions)

        self.drop_zone = DropZoneWidget(
            parent=self,
            accepted_extensions=['.exe', '.zip', '.msi']
        )
        self.drop_zone.file_dropped.connect(self.on_file_dropped)
        self.drop_zone.setMinimumHeight(190)
        self.drop_zone.setMaximumHeight(250)
        upload_layout.addWidget(self.drop_zone)

        layout.addWidget(upload_group)

    def _create_upload_section(self, layout):
        """Crear seccion de subida manual"""
        upload_group = QGroupBox("Metadatos del paquete")
        upload_group.setObjectName("driversUploadMetaCard")
        upload_layout = QVBoxLayout(upload_group)
        upload_layout.setSpacing(12)

        intro_label = QLabel(
            "Completa la version, el fabricante y una descripcion breve antes de publicar."
        )
        intro_label.setWordWrap(True)
        intro_label.setProperty("class", "sectionMeta")
        upload_layout.addWidget(intro_label)

        form_grid = QGridLayout()
        form_grid.setHorizontalSpacing(10)
        form_grid.setVerticalSpacing(10)

        brand_label = QLabel("Marca")
        brand_label.setProperty("class", "sectionMeta")
        form_grid.addWidget(brand_label, 0, 0)
        version_label = QLabel("Version")
        version_label.setProperty("class", "sectionMeta")
        form_grid.addWidget(version_label, 0, 1)

        self.upload_brand = QComboBox()
        self.upload_brand.addItems(["Magicard", "Zebra", "Entrust Sigma"])
        form_grid.addWidget(self.upload_brand, 1, 0)

        self.upload_version = QLineEdit()
        self.upload_version.setPlaceholderText("ej: 1.2.3")
        form_grid.addWidget(self.upload_version, 1, 1)

        desc_label = QLabel("Descripcion")
        desc_label.setProperty("class", "sectionMeta")
        form_grid.addWidget(desc_label, 2, 0, 1, 2)

        self.upload_description = QLineEdit()
        self.upload_description.setPlaceholderText("Descripcion corta del paquete")
        form_grid.addWidget(self.upload_description, 3, 0, 1, 2)
        upload_layout.addLayout(form_grid)

        file_label = QLabel("Archivo preparado")
        file_label.setProperty("class", "sectionMeta")
        upload_layout.addWidget(file_label)

        self.selected_file_label = QLabel("Sin archivo seleccionado")
        self.selected_file_label.setWordWrap(True)
        self.selected_file_label.setProperty("class", "info")
        upload_layout.addWidget(self.selected_file_label)

        self.upload_buttons_layout = QBoxLayout(QBoxLayout.Direction.LeftToRight)
        self.upload_buttons_layout.setContentsMargins(0, 0, 0, 0)
        self.upload_buttons_layout.setSpacing(8)

        self.select_driver_file_btn = QPushButton("Seleccionar archivo")
        self.select_driver_file_btn.setMaximumWidth(180)
        self.upload_buttons_layout.addWidget(self.select_driver_file_btn)

        self.upload_driver_btn = QPushButton("Subir a la nube")
        self.upload_driver_btn.setProperty("class", "primary")
        self.upload_driver_btn.setMaximumWidth(180)
        self.upload_buttons_layout.addWidget(self.upload_driver_btn)
        self.upload_buttons_layout.addStretch()
        upload_layout.addLayout(self.upload_buttons_layout)

        layout.addWidget(upload_group)

    def _update_workspace_mode(self):
        """Adjust the tab layout based on the available width."""
        compact_mode = self.width() < self.LAYOUT_BREAKPOINT

        self.workspace_splitter.setOrientation(
            Qt.Orientation.Vertical if compact_mode else Qt.Orientation.Horizontal
        )
        self.hero_metrics_layout.setDirection(
            QBoxLayout.Direction.TopToBottom if compact_mode else QBoxLayout.Direction.LeftToRight
        )
        self.catalog_controls_layout.setDirection(
            QBoxLayout.Direction.TopToBottom if compact_mode else QBoxLayout.Direction.LeftToRight
        )
        self.primary_actions_layout.setDirection(
            QBoxLayout.Direction.TopToBottom if compact_mode else QBoxLayout.Direction.LeftToRight
        )
        self.upload_buttons_layout.setDirection(
            QBoxLayout.Direction.TopToBottom if compact_mode else QBoxLayout.Direction.LeftToRight
        )

        self.drivers_list.setMinimumHeight(320 if compact_mode else 420)
        self.driver_details.setMinimumHeight(260 if compact_mode else 340)
        self.drop_zone.setMaximumHeight(210 if compact_mode else 250)

        if compact_mode:
            self.operations_panel.setMaximumWidth(16777215)
            self.catalog_context_label.setText("Exploracion compacta")
            self.upload_state_label.setText("Carga compacta")
        else:
            self.operations_panel.setMaximumWidth(420)
            self.catalog_context_label.setText("Exploracion activa")
            self.upload_state_label.setText("Zona de carga lista")

    def on_file_dropped(self, file_path):
        """Manejador cuando se suelta/selecciona un archivo"""
        logger.operation_start("handle_dropped_file", file=file_path)

        if not hasattr(self.parent, 'is_admin') or not self.parent.is_admin:
            QMessageBox.warning(self, "Autenticacion Requerida", "Debes iniciar sesion como administrador.")
            return

        dialog = QuickUploadDialog(file_path, self)

        if dialog.exec() == dialog.DialogCode.Accepted:
            data = dialog.get_data()

            if not data['version']:
                QMessageBox.warning(self, "Error", "La version es obligatoria.")
                return

            self.parent.current_upload_info = {
                'brand': data['brand'],
                'version': data['version'],
                'description': data['description'],
                'file_path': file_path
            }

            try:
                self.parent.download_manager.start_upload(
                    file_path,
                    data['brand'],
                    data['version'],
                    data['description']
                )

                if self.parent.user_manager and self.parent.user_manager.current_user:
                    self.parent.user_manager._log_access(
                        action="upload_driver_started",
                        username=self.parent.user_manager.current_user.get('username'),
                        success=True,
                        details={'file': Path(file_path).name}
                    )
                logger.operation_end("handle_dropped_file", success=True)

            except Exception as e:
                QMessageBox.critical(self, "Error", f"Error al iniciar la subida:\n{str(e)}")
                logger.operation_end("handle_dropped_file", success=False, reason=str(e))


class HistoryTab(QWidget):
    """Tab de historial y reportes"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        
        # Selector de vista
        view_layout = QHBoxLayout()
        view_layout.addWidget(QLabel("Vista:"))
        self.history_view_combo = QComboBox()
        self.history_view_combo.addItems([
            "Últimos Registros",
            "Por Cliente", 
            "Estadísticas",
            "Generar Reportes",
            "??? Gestión de Registros"
        ])
        view_layout.addWidget(self.history_view_combo)
        view_layout.addStretch()
        
        refresh_btn = QPushButton("?? Actualizar")
        refresh_btn.setToolTip("Sincronizar el historial con la base de datos en la nube")
        view_layout.addWidget(refresh_btn)
        layout.addLayout(view_layout)
        
        # Stack de vistas
        self.history_stack = QStackedWidget()
        layout.addWidget(self.history_stack)
        
        self._create_history_views()
    
    def _create_history_views(self):
        """Crear las diferentes vistas del historial"""
        # Vista 1: Últimos registros
        inst_widget = QWidget()
        inst_layout = QVBoxLayout(inst_widget)
        
        # Filtros
        filter_layout = QHBoxLayout()
        filter_layout.addWidget(QLabel("Mostrar:"))
        
        self.history_limit_combo = QComboBox()
        self.history_limit_combo.addItems(["Últimas 10", "Últimas 25", "Últimas 50", "Todas"])
        filter_layout.addWidget(self.history_limit_combo)
        
        filter_layout.addStretch()
        inst_layout.addLayout(filter_layout)
        
        self.history_list = QListWidget()
        inst_layout.addWidget(self.history_list)

        actions_layout = QHBoxLayout()
        self.create_manual_button = QPushButton("? Crear Registro Manual")
        self.create_manual_button.setProperty("class", "primary")
        actions_layout.addWidget(self.create_manual_button)

        self.edit_button = QPushButton("?? Editar Registro")
        self.edit_button.setEnabled(False)
        actions_layout.addWidget(self.edit_button)

        self.view_incidents_button = QPushButton("?? Incidencias/Fotos")
        self.view_incidents_button.setEnabled(False)
        self.view_incidents_button.setToolTip(
            "Ver incidencias asociadas al registro seleccionado, crear nuevas y abrir fotos"
        )
        actions_layout.addWidget(self.view_incidents_button)
        actions_layout.addStretch()
        inst_layout.addLayout(actions_layout)
        
        self.history_stack.addWidget(inst_widget)
        
        # Otras vistas (simplificadas)
        for i, name in enumerate(["Por Cliente", "Estadísticas"]):
            widget = QLabel(f"Vista de {name.lower()} - en desarrollo")
            self.history_stack.addWidget(widget)
        
        # Vista de incidencias
        self._create_incidents_view()

        # Vista de reportes
        self._create_reports_view()
        
        # Vista de gestión
        self._create_management_view()

    def _create_metric_card(self, title, meta):
        """Create a small editorial metric card for history subviews."""
        card = QWidget()
        card.setObjectName("driversMetricCard")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(16, 14, 16, 14)
        card_layout.setSpacing(4)

        title_label = QLabel(title)
        title_label.setProperty("class", "metricValue")
        card_layout.addWidget(title_label)

        meta_label = QLabel(meta)
        meta_label.setWordWrap(True)
        meta_label.setProperty("class", "metricMeta")
        card_layout.addWidget(meta_label)
        card_layout.addStretch()
        return card

    def _create_incidents_view(self):
        """Crear vista dedicada a incidencias y fotos."""
        self.incidents_widget = QWidget()
        incidents_layout = QVBoxLayout(self.incidents_widget)
        incidents_layout.setContentsMargins(0, 0, 0, 0)
        incidents_layout.setSpacing(16)

        header_layout = QVBoxLayout()
        header_layout.setSpacing(6)

        incidents_eyebrow = QLabel("INCIDENCIAS / EVIDENCIAS")
        incidents_eyebrow.setProperty("class", "chip")
        header_layout.addWidget(incidents_eyebrow, 0, Qt.AlignmentFlag.AlignLeft)

        title = QLabel("Incidencias y evidencias")
        title.setProperty("class", "heroTitle")
        header_layout.addWidget(title)

        title_meta = QLabel(
            "Monitorea friccion operativa, gestiona estados y coordina responsables sin salir de la misma consola."
        )
        title_meta.setWordWrap(True)
        title_meta.setProperty("class", "sectionMeta")
        header_layout.addWidget(title_meta)
        incidents_layout.addLayout(header_layout)

        hero_strip = QWidget()
        hero_strip.setObjectName("driversHeroStrip")
        hero_layout = QHBoxLayout(hero_strip)
        hero_layout.setContentsMargins(0, 0, 0, 0)
        hero_layout.setSpacing(12)
        hero_layout.addWidget(self._create_metric_card("Lectura operativa", "Registros, incidencias y evidencia en una sola superficie."))
        hero_layout.addWidget(self._create_metric_card("Estados accionables", "Abrir, mover en curso o resolver desde una barra compacta."))
        hero_layout.addWidget(self._create_metric_card("Asignaciones activas", "Incidencias y registros mantienen responsables visibles."))
        incidents_layout.addWidget(hero_strip)

        filters_group = QGroupBox("Filtro operativo")
        filters_layout = QHBoxLayout(filters_group)
        filters_layout.setSpacing(10)

        limit_column = QVBoxLayout()
        limit_column.setSpacing(6)
        limit_label = QLabel("Registros")
        limit_label.setProperty("class", "sectionMeta")
        limit_column.addWidget(limit_label)
        self.incidents_installations_limit = QComboBox()
        self.incidents_installations_limit.addItems(["Últimas 10", "Últimas 25", "Últimas 50", "Últimas 100"])
        self.incidents_installations_limit.setMaximumWidth(180)
        limit_column.addWidget(self.incidents_installations_limit)
        filters_layout.addLayout(limit_column)

        severity_column = QVBoxLayout()
        severity_column.setSpacing(6)
        severity_label = QLabel("Severidad")
        severity_label.setProperty("class", "sectionMeta")
        severity_column.addWidget(severity_label)
        self.incidents_severity_filter = QComboBox()
        self.incidents_severity_filter.addItems(["Todas", "low", "medium", "high", "critical"])
        self.incidents_severity_filter.setMaximumWidth(180)
        severity_column.addWidget(self.incidents_severity_filter)
        filters_layout.addLayout(severity_column)

        period_column = QVBoxLayout()
        period_column.setSpacing(6)
        period_label = QLabel("Periodo")
        period_label.setProperty("class", "sectionMeta")
        period_column.addWidget(period_label)
        self.incidents_period_filter = QComboBox()
        self.incidents_period_filter.addItems(
            ["Todos", "Últimos 7 días", "Últimos 30 días", "Últimos 90 días"]
        )
        self.incidents_period_filter.setMaximumWidth(200)
        period_column.addWidget(self.incidents_period_filter)
        filters_layout.addLayout(period_column)

        filter_actions = QHBoxLayout()
        filter_actions.setSpacing(8)
        self.apply_incidents_filters_btn = QPushButton("Aplicar filtros")
        self.apply_incidents_filters_btn.setMaximumWidth(170)
        filter_actions.addWidget(self.apply_incidents_filters_btn)

        self.refresh_incidents_view_btn = QPushButton("Recargar incidencias")
        self.refresh_incidents_view_btn.setProperty("class", "primary")
        self.refresh_incidents_view_btn.setMaximumWidth(190)
        filter_actions.addWidget(self.refresh_incidents_view_btn)
        filters_layout.addLayout(filter_actions)
        filters_layout.addStretch()
        incidents_layout.addWidget(filters_group)

        self.incidents_workspace_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.incidents_workspace_splitter.setChildrenCollapsible(False)
        self.incidents_workspace_splitter.setHandleWidth(10)
        incidents_layout.addWidget(self.incidents_workspace_splitter, 1)

        records_group = QGroupBox("Registros")
        records_layout = QVBoxLayout(records_group)
        records_layout.setSpacing(10)

        records_meta = QLabel(
            "Cada registro conserva su contexto y habilita incidencias y asignaciones del frente operativo."
        )
        records_meta.setWordWrap(True)
        records_meta.setProperty("class", "sectionMeta")
        records_layout.addWidget(records_meta)

        self.incidents_installations_list = QListWidget()
        self.incidents_installations_list.setMinimumWidth(320)
        records_layout.addWidget(self.incidents_installations_list, 1)

        records_assignments_title = QLabel("Asignaciones del registro")
        records_assignments_title.setProperty("class", "sectionTitle")
        records_layout.addWidget(records_assignments_title)

        record_assignment_actions = QHBoxLayout()
        record_assignment_actions.setSpacing(8)
        self.refresh_installation_assignments_btn = QPushButton("Actualizar asignaciones")
        self.refresh_installation_assignments_btn.setMaximumWidth(170)
        record_assignment_actions.addWidget(self.refresh_installation_assignments_btn)

        self.add_installation_assignment_btn = QPushButton("Asignar tecnico")
        self.add_installation_assignment_btn.setMaximumWidth(150)
        record_assignment_actions.addWidget(self.add_installation_assignment_btn)

        self.remove_installation_assignment_btn = QPushButton("Quitar asignacion")
        self.remove_installation_assignment_btn.setMaximumWidth(150)
        self.remove_installation_assignment_btn.setEnabled(False)
        record_assignment_actions.addWidget(self.remove_installation_assignment_btn)
        record_assignment_actions.addStretch()
        records_layout.addLayout(record_assignment_actions)

        self.installation_assignments_list = QListWidget()
        self.installation_assignments_list.setMinimumHeight(120)
        records_layout.addWidget(self.installation_assignments_list)

        self.incidents_workspace_splitter.addWidget(records_group)

        incidents_group = QGroupBox("Incidencias")
        incidents_group.setObjectName("driversDetailPanel")
        incidents_container = QVBoxLayout(incidents_group)
        incidents_container.setSpacing(12)

        incidents_meta = QLabel(
            "Abre la incidencia, mira el detalle enriquecido y gestiona evidencia sin perder ritmo."
        )
        incidents_meta.setWordWrap(True)
        incidents_meta.setProperty("class", "sectionMeta")
        incidents_container.addWidget(incidents_meta)

        self.incidents_list = QListWidget()
        self.incidents_list.setMaximumHeight(140)
        incidents_container.addWidget(self.incidents_list)

        incident_actions = QHBoxLayout()
        incident_actions.setSpacing(8)
        self.create_incident_btn = QPushButton("Crear incidencia")
        self.create_incident_btn.setProperty("class", "warning")
        self.create_incident_btn.setMaximumWidth(150)
        incident_actions.addWidget(self.create_incident_btn)

        self.upload_incident_photo_btn = QPushButton("Subir foto")
        self.upload_incident_photo_btn.setProperty("class", "info")
        self.upload_incident_photo_btn.setEnabled(False)
        self.upload_incident_photo_btn.setMaximumWidth(120)
        incident_actions.addWidget(self.upload_incident_photo_btn)

        self.view_incident_photo_btn = QPushButton("Ver foto")
        self.view_incident_photo_btn.setEnabled(False)
        self.view_incident_photo_btn.setMaximumWidth(110)
        incident_actions.addWidget(self.view_incident_photo_btn)

        self.incident_mark_open_btn = QPushButton("Abrir")
        self.incident_mark_open_btn.setEnabled(False)
        self.incident_mark_open_btn.setMaximumWidth(96)
        incident_actions.addWidget(self.incident_mark_open_btn)

        self.incident_mark_progress_btn = QPushButton("En curso")
        self.incident_mark_progress_btn.setEnabled(False)
        self.incident_mark_progress_btn.setMaximumWidth(110)
        incident_actions.addWidget(self.incident_mark_progress_btn)

        self.incident_mark_resolved_btn = QPushButton("Resolver")
        self.incident_mark_resolved_btn.setEnabled(False)
        self.incident_mark_resolved_btn.setMaximumWidth(110)
        incident_actions.addWidget(self.incident_mark_resolved_btn)
        incident_actions.addStretch()
        incidents_container.addLayout(incident_actions)

        detail_panel = QWidget()
        detail_layout = QVBoxLayout(detail_panel)
        detail_layout.setContentsMargins(0, 0, 0, 0)
        detail_layout.setSpacing(8)

        detail_title = QLabel("Detalle de la incidencia")
        detail_title.setProperty("class", "sectionTitle")
        detail_layout.addWidget(detail_title)

        self.incident_detail = QTextEdit()
        self.incident_detail.setReadOnly(True)
        self.incident_detail.setMinimumHeight(360)
        self.incident_detail.setObjectName("driverDetailsPane")
        self.incident_detail.setPlaceholderText("Selecciona una incidencia para ver su detalle.")
        detail_layout.addWidget(self.incident_detail, 1)
        incidents_container.addWidget(detail_panel, 1)

        secondary_header = QHBoxLayout()
        secondary_header.setSpacing(8)

        secondary_title = QLabel("Panel secundario")
        secondary_title.setProperty("class", "sectionTitle")
        secondary_header.addWidget(secondary_title)

        self.show_incident_photos_btn = QPushButton("Fotos")
        self.show_incident_photos_btn.setProperty("class", "info")
        self.show_incident_photos_btn.setMaximumWidth(96)
        secondary_header.addWidget(self.show_incident_photos_btn)

        self.show_incident_assignments_btn = QPushButton("Asignaciones")
        self.show_incident_assignments_btn.setMaximumWidth(120)
        secondary_header.addWidget(self.show_incident_assignments_btn)
        secondary_header.addStretch()
        incidents_container.addLayout(secondary_header)

        self.incident_secondary_stack = QStackedWidget()
        self.incident_secondary_stack.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Maximum,
        )
        incidents_container.addWidget(self.incident_secondary_stack)

        photos_panel = QWidget()
        photos_layout = QVBoxLayout(photos_panel)
        photos_layout.setContentsMargins(0, 0, 0, 0)
        photos_layout.setSpacing(8)

        photos_title = QLabel("Fotos asociadas")
        photos_title.setProperty("class", "sectionTitle")
        photos_layout.addWidget(photos_title)

        self.incident_photos_list = QListWidget()
        self.incident_photos_list.setMinimumHeight(120)
        self.incident_photos_list.setMaximumHeight(180)
        self.incident_photos_list.setIconSize(QSize(96, 72))
        photos_layout.addWidget(self.incident_photos_list)
        self.incident_secondary_stack.addWidget(photos_panel)

        assignments_panel = QWidget()
        assignments_layout = QVBoxLayout(assignments_panel)
        assignments_layout.setContentsMargins(0, 0, 0, 0)
        assignments_layout.setSpacing(8)

        incident_assignments_title = QLabel("Asignaciones de la incidencia")
        incident_assignments_title.setProperty("class", "sectionTitle")
        assignments_layout.addWidget(incident_assignments_title)

        incident_assignment_actions = QHBoxLayout()
        incident_assignment_actions.setSpacing(8)
        self.refresh_assignments_btn = QPushButton("Actualizar asignaciones")
        self.refresh_assignments_btn.setMaximumWidth(170)
        incident_assignment_actions.addWidget(self.refresh_assignments_btn)

        self.add_incident_assignment_btn = QPushButton("Asignar tecnico")
        self.add_incident_assignment_btn.setMaximumWidth(150)
        incident_assignment_actions.addWidget(self.add_incident_assignment_btn)

        self.remove_incident_assignment_btn = QPushButton("Quitar asignacion")
        self.remove_incident_assignment_btn.setMaximumWidth(150)
        self.remove_incident_assignment_btn.setEnabled(False)
        incident_assignment_actions.addWidget(self.remove_incident_assignment_btn)
        incident_assignment_actions.addStretch()
        assignments_layout.addLayout(incident_assignment_actions)

        self.incident_assignments_list = QListWidget()
        self.incident_assignments_list.setMinimumHeight(120)
        self.incident_assignments_list.setMaximumHeight(210)
        assignments_layout.addWidget(self.incident_assignments_list)
        self.incident_secondary_stack.addWidget(assignments_panel)
        self.incident_secondary_stack.setCurrentIndex(0)

        self.show_incident_photos_btn.clicked.connect(
            lambda: self.incident_secondary_stack.setCurrentIndex(0)
        )
        self.show_incident_assignments_btn.clicked.connect(
            lambda: self.incident_secondary_stack.setCurrentIndex(1)
        )

        self.incidents_workspace_splitter.addWidget(incidents_group)
        self.incidents_workspace_splitter.setStretchFactor(0, 4)
        self.incidents_workspace_splitter.setStretchFactor(1, 7)
        self.incidents_workspace_splitter.setSizes([460, 980])
        # Esta vista se usa como pestaña independiente en MainWindow.
    
    def _create_reports_view(self):
        """Crear vista de reportes"""
        reports_widget = QWidget()
        reports_layout = QVBoxLayout(reports_widget)
        
        title = QLabel("?? Generar Reportes en Excel")
        title.setFont(QFont("Arial", 14, QFont.Weight.Bold))
        reports_layout.addWidget(title)
        
        # Reporte diario
        self.daily_report_btn = QPushButton("?? Generar Reporte de Hoy")
        self.daily_report_btn.setProperty("class", "primary")
        reports_layout.addWidget(self.daily_report_btn)
        
        # Reporte mensual
        monthly_layout = QHBoxLayout()
        monthly_layout.addWidget(QLabel("Mes:"))
        
        self.report_month_combo = QComboBox()
        months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
        self.report_month_combo.addItems(months)
        self.report_month_combo.setCurrentIndex(datetime.now().month - 1)
        monthly_layout.addWidget(self.report_month_combo)
        
        monthly_layout.addWidget(QLabel("Año:"))
        self.report_year_combo = QComboBox()
        current_year = datetime.now().year
        self.report_year_combo.addItems([str(y) for y in range(current_year - 2, current_year + 1)])
        self.report_year_combo.setCurrentText(str(current_year))
        monthly_layout.addWidget(self.report_year_combo)
        
        monthly_layout.addStretch()
        reports_layout.addLayout(monthly_layout)
        
        self.monthly_report_btn = QPushButton("Generar Reporte del Mes Seleccionado")
        self.monthly_report_btn.setProperty("class", "success")
        reports_layout.addWidget(self.monthly_report_btn)
        self.yearly_report_btn = QPushButton("Generar Reporte Anual (Año Seleccionado)")
        self.yearly_report_btn.setProperty("class", "warning")
        reports_layout.addWidget(self.yearly_report_btn)

        preview_title = QLabel("Vista previa del reporte")
        preview_title.setFont(QFont("Arial", 11, QFont.Weight.Bold))
        reports_layout.addWidget(preview_title)

        self.report_preview = QTextEdit()
        self.report_preview.setReadOnly(True)
        self.report_preview.setMinimumHeight(170)
        self.report_preview.setPlaceholderText(
            "Aquí se mostrará un resumen rápido del reporte diario, mensual y anual."
        )
        reports_layout.addWidget(self.report_preview)
        
        reports_layout.addStretch()
        self.history_stack.addWidget(reports_widget)
    
    def _create_management_view(self):
        """Crear vista de gestión de registros"""
        management_widget = QWidget()
        management_layout = QVBoxLayout(management_widget)
        
        # Título con advertencia
        title = QLabel("??? Gestión de Registros")
        title.setFont(QFont("Arial", 14, QFont.Weight.Bold))
        title.setProperty("class", "error")
        management_layout.addWidget(title)
        
        self.warning = QLabel(
            "?? Solo administradores pueden eliminar registros del historial. "
            "Esta acción no se puede deshacer."
        )
        self.warning.setWordWrap(True)
        self.warning.setProperty("class", "warning")
        # Ocultar warning si es admin
        if hasattr(self.parent, 'is_admin') and self.parent.is_admin:
            self.warning.setVisible(False)
        management_layout.addWidget(self.warning)
        
        # Estadísticas con contraste mejorado
        stats_label = QLabel("?? Estadísticas Actuales")
        stats_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        management_layout.addWidget(stats_label)
        
        self.mgmt_stats_display = QTextEdit()
        self.mgmt_stats_display.setReadOnly(True)
        self.mgmt_stats_display.setMaximumHeight(100)
        # Aplicar clase CSS para estadísticas
        self.mgmt_stats_display.setProperty("class", "stats")
        management_layout.addWidget(self.mgmt_stats_display)

        # Lista de registros para gestionar
        management_layout.addWidget(QLabel("Registros del Historial:"))
        self.management_history_list = QListWidget()
        management_layout.addWidget(self.management_history_list)
        
        # Opciones de eliminación
        delete_group = QGroupBox("Opciones de Eliminación")
        delete_layout = QHBoxLayout()

        self.delete_selected_btn = QPushButton("??? Eliminar Seleccionado")
        self.delete_selected_btn.setEnabled(False)
        self.delete_selected_btn.setProperty("class", "danger")
        delete_layout.addWidget(self.delete_selected_btn)
        delete_layout.addStretch()

        delete_group.setLayout(delete_layout)
        management_layout.addWidget(delete_group)
        
        # Log de auditoría
        audit_label = QLabel("?? Log de Auditoría")
        audit_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        management_layout.addWidget(audit_label)
        
        self.audit_log_list = QListWidget()
        self.audit_log_list.setMaximumHeight(200)
        management_layout.addWidget(self.audit_log_list)
        
        management_layout.addStretch()
        self.history_stack.addWidget(management_widget)
    
    def _delete_old_records(self):
        """Eliminar registros antiguos con autenticación"""
        # Verificar autenticación
        if not self.parent.is_admin:
            QMessageBox.warning(self.parent, "Error", "Debes iniciar sesión como administrador primero")
            return
        
        # Continuar con la eliminación
        days_text = self.days_spinner.currentText()
        days_map = {
            "30 días": 30,
            "60 días": 60,
            "90 días": 90,
            "180 días": 180,
            "1 año": 365
        }
        days = days_map.get(days_text, 30)
        
        reply = QMessageBox.question(
            self.parent,
            "Confirmar Eliminación",
            f"?? ¿Estás seguro que deseas eliminar todos los registros\n"
            f"más antiguos que {days_text}?\n\n"
            f"Esta acción NO se puede deshacer.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            try:
                deleted = self.parent.history.clear_history(older_than_days=days)
                QMessageBox.information(
                    self.parent,
                    "Eliminación Completa",
                    f"? {deleted} registro(s) eliminado(s)"
                )
            except Exception as e:
                QMessageBox.critical(self.parent, "Error", f"Error al eliminar registros:\n{str(e)}")

class AdminTab(QWidget):
    """Tab de administración con Drag & Drop"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.init_ui()
    
    def init_ui(self):
        """Inicializar interfaz"""
        layout = QVBoxLayout(self)
        
        # Panel de autenticación
        auth_layout = QHBoxLayout()
        self.auth_status = QLabel("?? No autenticado")
        auth_layout.addWidget(self.auth_status)
        auth_layout.addStretch()
        
        self.login_btn = QPushButton("Iniciar Sesión")
        self.login_btn.setProperty("class", "primary")
        auth_layout.addWidget(self.login_btn)
        
        self.logout_btn = QPushButton("Cerrar Sesión")
        self.logout_btn.setVisible(False)
        auth_layout.addWidget(self.logout_btn)
        
        layout.addLayout(auth_layout)
        
        # Botón de gestión de usuarios (solo para super_admin)
        self.user_mgmt_btn = QPushButton("Gestionar usuarios")
        self.user_mgmt_btn.setProperty("class", "info")
        self.user_mgmt_btn.setVisible(False)
        self.user_mgmt_btn.setMaximumWidth(220)
        layout.addWidget(self.user_mgmt_btn, 0, Qt.AlignmentFlag.AlignLeft)
        
        # Contenido admin
        self.admin_content = QWidget()
        admin_content_layout = QVBoxLayout(self.admin_content)
        
        # Configuración R2
        self._create_r2_config_section(admin_content_layout)
        
        # Eliminar drivers
        self._create_delete_section(admin_content_layout)
        
        # Sección de configuración general
        admin_content_layout.addSpacing(30)
        config_label = QLabel("?? Configuración General")
        config_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        admin_content_layout.addWidget(config_label)
        
        # Selector de tema
        theme_layout = QHBoxLayout()
        theme_layout.addWidget(QLabel("?? Tema:"))
        
        self.theme_combo = QComboBox()
        self.theme_combo.addItems(["Claro", "Oscuro"])
        theme_layout.addWidget(self.theme_combo)
        
        theme_layout.addStretch()
        admin_content_layout.addLayout(theme_layout)
        
        config_buttons = QHBoxLayout()
        
        change_pass_btn = QPushButton("?? Cambiar Contraseña")
        change_pass_btn.setProperty("class", "warning")
        config_buttons.addWidget(change_pass_btn)
        
        clear_cache_btn = QPushButton("?? Limpiar Caché")
        clear_cache_btn.setProperty("class", "danger")
        config_buttons.addWidget(clear_cache_btn)
        
        config_buttons.addStretch()
        admin_content_layout.addLayout(config_buttons)
        
        self.admin_content.setVisible(False)
        layout.addWidget(self.admin_content)
        layout.addStretch()
    
    def _create_r2_config_section(self, layout):
        """Crear sección de configuración R2"""
        r2_group = QGroupBox("?? Configuración Cloudflare R2")
        r2_layout = QVBoxLayout()
        
        # Warning de seguridad
        warning = QLabel("?? Información sensible - Solo visible para administradores")
        warning.setWordWrap(True)
        warning.setProperty("class", "warning")
        r2_layout.addWidget(warning)
        
        # Campos de configuración
        self._create_config_field(r2_layout, "Account ID:", "admin_account_id_input", "show_account_btn")
        self._create_config_field(r2_layout, "Access Key ID:", "admin_access_key_input", "show_access_btn")
        self._create_config_field(r2_layout, "Secret Access Key:", "admin_secret_key_input", "show_secret_btn")
        
        # Bucket name (no oculto)
        bucket_layout = QHBoxLayout()
        bucket_layout.addWidget(QLabel("Bucket Name:"))
        self.admin_bucket_name_input = QLineEdit()
        self.admin_bucket_name_input.setPlaceholderText("Nombre de tu bucket R2")
        bucket_layout.addWidget(self.admin_bucket_name_input)
        r2_layout.addLayout(bucket_layout)

        # History API URL
        history_api_layout = QHBoxLayout()
        history_api_layout.addWidget(QLabel("History API URL:"))
        self.admin_history_api_url_input = QLineEdit()
        self.admin_history_api_url_input.setPlaceholderText("URL de tu Worker para el historial")
        history_api_layout.addWidget(self.admin_history_api_url_input)
        r2_layout.addLayout(history_api_layout)

        # API auth para D1 history/audit endpoints (HMAC)
        self._create_config_field(r2_layout, "API Token:", "admin_api_token_input", "show_api_token_btn")
        self._create_config_field(r2_layout, "API Secret:", "admin_api_secret_input", "show_api_secret_btn")
        
        # Botones R2
        r2_buttons = QHBoxLayout()
        save_btn = QPushButton("?? Guardar Configuración R2")
        save_btn.setProperty("class", "success")
        r2_buttons.addWidget(save_btn)
        
        test_btn = QPushButton("?? Probar Conexión")
        test_btn.setProperty("class", "primary")
        r2_buttons.addWidget(test_btn)
        r2_buttons.addStretch()
        r2_layout.addLayout(r2_buttons)
        
        r2_group.setLayout(r2_layout)
        layout.addWidget(r2_group)
        layout.addSpacing(20)
    
    def _create_config_field(self, layout, label_text, input_attr, button_attr):
        """Crear campo de configuración con botón de visibilidad"""
        field_layout = QHBoxLayout()
        field_layout.addWidget(QLabel(label_text))
        
        input_field = QLineEdit()
        input_field.setEchoMode(QLineEdit.EchoMode.Password)
        input_field.setPlaceholderText(f"Tu {label_text.replace(':', '')}")
        setattr(self, input_attr, input_field)
        field_layout.addWidget(input_field)
        
        show_btn = QPushButton("???")
        show_btn.setMaximumWidth(40)
        show_btn.setCheckable(True)
        show_btn.setToolTip(f"Mostrar u ocultar el campo {label_text.replace(':', '')}")
        show_btn.setAccessibleName(f"Mostrar u ocultar {label_text.replace(':', '')}")
        show_btn.setAccessibleDescription(
            f"Alterna la visibilidad del texto ingresado en {label_text.replace(':', '')}"
        )
        setattr(self, button_attr, show_btn)
        field_layout.addWidget(show_btn)
        
        layout.addLayout(field_layout)
    
    def _create_delete_section(self, layout):
        """Crear sección de eliminación de drivers"""
        layout.addSpacing(20)
        delete_label = QLabel("??? Eliminar Drivers")
        delete_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(delete_label)
        
        self.admin_drivers_list = QListWidget()
        layout.addWidget(self.admin_drivers_list)
        
        delete_btn = QPushButton("? Eliminar Seleccionado")
        layout.addWidget(delete_btn)
        layout.addStretch()


class ConfigTab(QWidget):
    """Tab de configuración simplificado"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        
        info_label = QLabel("?? Configuración General")
        info_label.setFont(QFont("Arial", 14, QFont.Weight.Bold))
        layout.addWidget(info_label)
        
        info_text = QLabel(
            "La configuración de Cloudflare R2 ahora está protegida.\n"
            "Accede a la pestaña '?? Administración' con tu contraseña de admin\n"
            "para ver y modificar las credenciales de la nube."
        )
        info_text.setProperty("class", "info")
        layout.addWidget(info_text)
        
        layout.addSpacing(20)
        
        # Cambiar contraseña
        admin_label = QLabel("?? Contraseña de Administrador")
        admin_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(admin_label)
        
        change_pass_btn = QPushButton("?? Cambiar Contraseña")
        change_pass_btn.setProperty("class", "warning")
        layout.addWidget(change_pass_btn)
        
        # Cache
        layout.addSpacing(30)
        cache_label = QLabel("??? Caché Local")
        cache_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(cache_label)
        
        if hasattr(self.parent, 'cache_dir'):
            cache_info = QLabel(f"Ubicación: {self.parent.cache_dir}")
            cache_info.setStyleSheet("color: #666;")
            layout.addWidget(cache_info)
        
        clear_cache_btn = QPushButton("?? Limpiar Caché")
        clear_cache_btn.setStyleSheet("""
            QPushButton {
                background-color: #D9534F;
                color: white;
                padding: 10px 20px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        layout.addWidget(clear_cache_btn)
        
        layout.addStretch()

class EditInstallationDialog(QDialog):
    """Diálogo para editar un registro de instalación."""
    def __init__(self, installation_data, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Editar Registro de Instalación")
        
        self.installation_data = installation_data
        
        self.layout = QVBoxLayout(self)
        
        # Info no editable
        info_group = QGroupBox("Detalles del Registro")
        info_layout = QVBoxLayout()
        
        self.client_label = QLabel(f"<b>Cliente:</b> {self.installation_data.get('client_name', 'N/A')}")
        self.driver_label = QLabel(f"<b>Driver:</b> {self.installation_data.get('driver_brand', 'N/A')} {self.installation_data.get('driver_version', 'N/A')}")
        self.date_label = QLabel(f"<b>Fecha:</b> {self.installation_data.get('timestamp', 'N/A')}")
        
        info_layout.addWidget(self.client_label)
        info_layout.addWidget(self.driver_label)
        info_layout.addWidget(self.date_label)
        info_group.setLayout(info_layout)
        self.layout.addWidget(info_group)
        
        # Campos editables
        edit_group = QGroupBox("Campos Editables")
        edit_layout = QVBoxLayout()
        
        edit_layout.addWidget(QLabel("Notas de la instalación:"))
        self.notes_edit = QTextEdit()
        self.notes_edit.setText(self.installation_data.get('notes', '') or "")
        edit_layout.addWidget(self.notes_edit)
        
        edit_layout.addWidget(QLabel("Tiempo de instalación (Minutos):"))
        self.time_spinbox = QSpinBox()
        self.time_spinbox.setRange(0, 10000)
        stored_seconds = self.installation_data.get('installation_time_seconds', 0) or 0
        try:
            stored_seconds = int(float(stored_seconds))
        except (ValueError, TypeError):
            stored_seconds = 0
        self.time_spinbox.setValue(max(0, stored_seconds // 60))
        edit_layout.addWidget(self.time_spinbox)
        
        edit_group.setLayout(edit_layout)
        self.layout.addWidget(edit_group)
        
        # Botones
        self.button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
        self.button_box.accepted.connect(self.accept)
        self.button_box.rejected.connect(self.reject)
        self.layout.addWidget(self.button_box)

    def get_updated_data(self):
        """Devuelve los datos actualizados del diálogo."""
        return {
            'notes': self.notes_edit.toPlainText(),
            'time_seconds': self.time_spinbox.value() * 60
        }


