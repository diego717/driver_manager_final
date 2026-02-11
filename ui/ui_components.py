"""
Componentes de UI para Driver Manager
"""

from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                             QListWidget, QLabel, QLineEdit, QComboBox, QTextEdit,
                             QListWidgetItem, QGroupBox, QStackedWidget, QDialog,
                             QSpinBox, QDialogButtonBox)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont
from datetime import datetime


class DriversTab(QWidget):
    """Tab principal de drivers"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        
        # Filtro por marca
        filter_layout = QHBoxLayout()
        filter_layout.addWidget(QLabel("Marca:"))
        self.brand_filter = QComboBox()
        self.brand_filter.addItems(["Todas", "Magicard", "Zebra", "Entrust Sigma"])
        filter_layout.addWidget(self.brand_filter)
        filter_layout.addStretch()
        
        refresh_btn = QPushButton("🔄 Actualizar Lista")
        filter_layout.addWidget(refresh_btn)
        layout.addLayout(filter_layout)
        
        # Lista de drivers
        self.drivers_list = QListWidget()
        layout.addWidget(self.drivers_list)
        
        # Detalles del driver
        details_label = QLabel("Detalles:")
        details_label.setFont(QFont("Arial", 10, QFont.Weight.Bold))
        layout.addWidget(details_label)
        
        self.driver_details = QTextEdit()
        self.driver_details.setReadOnly(True)
        self.driver_details.setMaximumHeight(100)
        layout.addWidget(self.driver_details)
        
        # Botones de acción
        buttons_layout = QHBoxLayout()
        self.download_btn = QPushButton("⬇️ Descargar")
        self.download_btn.setEnabled(False)
        buttons_layout.addWidget(self.download_btn)
        
        self.install_btn = QPushButton("🚀 Descargar e Instalar")
        self.install_btn.setEnabled(False)
        buttons_layout.addWidget(self.install_btn)
        
        buttons_layout.addStretch()
        layout.addLayout(buttons_layout)


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
            "Últimas Instalaciones",
            "Por Cliente", 
            "Estadísticas",
            "Generar Reportes",
            "🗑️ Gestión de Registros"
        ])
        view_layout.addWidget(self.history_view_combo)
        view_layout.addStretch()
        
        refresh_btn = QPushButton("🔄 Actualizar")
        view_layout.addWidget(refresh_btn)
        layout.addLayout(view_layout)
        
        # Stack de vistas
        self.history_stack = QStackedWidget()
        layout.addWidget(self.history_stack)
        
        self._create_history_views()
    
    def _create_history_views(self):
        """Crear las diferentes vistas del historial"""
        # Vista 1: Últimas instalaciones
        inst_widget = QWidget()
        inst_layout = QVBoxLayout(inst_widget)
        
        # Filtros
        filter_layout = QHBoxLayout()
        filter_layout.addWidget(QLabel("Mostrar:"))
        
        self.history_limit_combo = QComboBox()
        self.history_limit_combo.addItems(["Últimas 10", "Últimas 25", "Últimas 50", "Todas"])
        filter_layout.addWidget(self.history_limit_combo)
        
        filter_layout.addWidget(QLabel("Estado:"))
        self.history_status_filter = QComboBox()
        self.history_status_filter.addItems(["Todos", "Exitosas", "Fallidas"])
        filter_layout.addWidget(self.history_status_filter)
        
        filter_layout.addStretch()
        inst_layout.addLayout(filter_layout)
        
        self.history_list = QListWidget()
        inst_layout.addWidget(self.history_list)

        self.edit_button = QPushButton("📝 Editar Registro")
        self.edit_button.setEnabled(False)
        inst_layout.addWidget(self.edit_button)
        
        self.history_stack.addWidget(inst_widget)
        
        # Otras vistas (simplificadas)
        for i, name in enumerate(["Por Cliente", "Estadísticas"]):
            widget = QLabel(f"Vista de {name.lower()} - en desarrollo")
            self.history_stack.addWidget(widget)
        
        # Vista de reportes
        self._create_reports_view()
        
        # Vista de gestión
        self._create_management_view()
    
    def _create_reports_view(self):
        """Crear vista de reportes"""
        reports_widget = QWidget()
        reports_layout = QVBoxLayout(reports_widget)
        
        title = QLabel("📊 Generar Reportes en Excel")
        title.setFont(QFont("Arial", 14, QFont.Weight.Bold))
        reports_layout.addWidget(title)
        
        # Reporte diario
        daily_btn = QPushButton("📄 Generar Reporte de Hoy")
        daily_btn.setStyleSheet("""
            QPushButton {
                background-color: #4A90E2;
                color: white;
                padding: 10px 20px;
                border-radius: 4px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #357ABD;
            }
        """)
        reports_layout.addWidget(daily_btn)
        
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
        
        monthly_btn = QPushButton("📄 Generar Reporte Mensual")
        monthly_btn.setStyleSheet("""
            QPushButton {
                background-color: #5CB85C;
                color: white;
                padding: 10px 20px;
                border-radius: 4px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #4CAE4C;
            }
        """)
        reports_layout.addWidget(monthly_btn)
        
        # Exportar JSON
        export_btn = QPushButton("📦 Exportar Todo a JSON")
        export_btn.setStyleSheet("""
            QPushButton {
                background-color: #F0AD4E;
                color: white;
                padding: 10px 20px;
                border-radius: 4px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #EC971F;
            }
        """)
        reports_layout.addWidget(export_btn)
        
        reports_layout.addStretch()
        self.history_stack.addWidget(reports_widget)
    
    def _create_management_view(self):
        """Crear vista de gestión de registros"""
        management_widget = QWidget()
        management_layout = QVBoxLayout(management_widget)
        
        # Título con advertencia
        title = QLabel("🗑️ Gestión de Registros")
        title.setFont(QFont("Arial", 14, QFont.Weight.Bold))
        title.setStyleSheet("color: #D9534F;")
        management_layout.addWidget(title)
        
        warning = QLabel("⚠️ Esta sección requiere autenticación de administrador")
        warning.setStyleSheet("""
            QLabel {
                background-color: #FCF8E3;
                color: #8A6D3B;
                padding: 10px;
                border: 1px solid #FAEBCC;
                border-radius: 4px;
            }
        """)
        # Ocultar warning si está autenticado
        if hasattr(self.parent, 'is_admin') and self.parent.is_admin:
            warning.setVisible(False)
        management_layout.addWidget(warning)
        
        # Estadísticas con contraste mejorado
        stats_label = QLabel("📊 Estadísticas Actuales")
        stats_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        management_layout.addWidget(stats_label)
        
        self.mgmt_stats_display = QTextEdit()
        self.mgmt_stats_display.setReadOnly(True)
        self.mgmt_stats_display.setMaximumHeight(100)
        # Aplicar clase CSS para estadísticas
        self.mgmt_stats_display.setProperty("class", "stats")
        management_layout.addWidget(self.mgmt_stats_display)
        
        # Opciones de eliminación
        delete_layout = QHBoxLayout()
        delete_layout.addWidget(QLabel("Eliminar registros más antiguos que:"))
        
        self.days_spinner = QComboBox()
        self.days_spinner.addItems(["30 días", "60 días", "90 días", "180 días", "1 año"])
        delete_layout.addWidget(self.days_spinner)
        
        delete_old_btn = QPushButton("🗑️ Eliminar Antiguos")
        delete_old_btn.setStyleSheet("""
            QPushButton {
                background-color: #F0AD4E;
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        delete_old_btn.clicked.connect(lambda: self._delete_old_records())
        delete_layout.addWidget(delete_old_btn)
        delete_layout.addStretch()
        management_layout.addLayout(delete_layout)
        
        # Log de auditoría
        audit_label = QLabel("📋 Log de Auditoría")
        audit_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        management_layout.addWidget(audit_label)
        
        self.audit_log_list = QListWidget()
        self.audit_log_list.setMaximumHeight(200)
        management_layout.addWidget(self.audit_log_list)
        
        management_layout.addStretch()
        self.history_stack.addWidget(management_widget)
    
    def _delete_old_records(self):
        """Eliminar registros antiguos con autenticación"""
        from PyQt6.QtWidgets import QInputDialog, QMessageBox
        
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
            f"⚠️ ¿Estás seguro que deseas eliminar todos los registros\n"
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
                    f"✅ {deleted} registro(s) eliminado(s)"
                )
            except Exception as e:
                QMessageBox.critical(self.parent, "Error", f"Error al eliminar registros:\n{str(e)}")


class AdminTab(QWidget):
    """Tab de administración"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        
        # Panel de autenticación
        auth_layout = QHBoxLayout()
        self.auth_status = QLabel("🔒 No autenticado")
        auth_layout.addWidget(self.auth_status)
        auth_layout.addStretch()
        
        self.login_btn = QPushButton("Iniciar Sesión")
        auth_layout.addWidget(self.login_btn)
        
        self.logout_btn = QPushButton("Cerrar Sesión")
        self.logout_btn.setVisible(False)
        auth_layout.addWidget(self.logout_btn)
        
        layout.addLayout(auth_layout)
        
        # Botón de gestión de usuarios (solo para super_admin)
        self.user_mgmt_btn = QPushButton("👥 Gestionar Usuarios")
        self.user_mgmt_btn.setStyleSheet("""
            QPushButton {
                background-color: #9B59B6;
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        self.user_mgmt_btn.setVisible(False)
        layout.addWidget(self.user_mgmt_btn)
        
        # Contenido admin
        self.admin_content = QWidget()
        admin_content_layout = QVBoxLayout(self.admin_content)
        
        # Configuración R2
        self._create_r2_config_section(admin_content_layout)
        
        # Subir drivers
        self._create_upload_section(admin_content_layout)
        
        # Eliminar drivers
        self._create_delete_section(admin_content_layout)
        
        # Sección de configuración general
        admin_content_layout.addSpacing(30)
        config_label = QLabel("⚙️ Configuración General")
        config_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        admin_content_layout.addWidget(config_label)
        
        # Selector de tema
        theme_layout = QHBoxLayout()
        theme_layout.addWidget(QLabel("🎨 Tema:"))
        
        self.theme_combo = QComboBox()
        self.theme_combo.addItems(["Claro", "Oscuro"])
        theme_layout.addWidget(self.theme_combo)
        
        theme_layout.addStretch()
        admin_content_layout.addLayout(theme_layout)
        
        config_buttons = QHBoxLayout()
        
        change_pass_btn = QPushButton("🔑 Cambiar Contraseña")
        change_pass_btn.setStyleSheet("""
            QPushButton {
                background-color: #F0AD4E;
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        config_buttons.addWidget(change_pass_btn)
        
        clear_cache_btn = QPushButton("🧹 Limpiar Caché")
        clear_cache_btn.setStyleSheet("""
            QPushButton {
                background-color: #D9534F;
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        config_buttons.addWidget(clear_cache_btn)
        
        config_buttons.addStretch()
        admin_content_layout.addLayout(config_buttons)
        
        self.admin_content.setVisible(False)
        layout.addWidget(self.admin_content)
        layout.addStretch()
    
    def _create_r2_config_section(self, layout):
        """Crear sección de configuración R2"""
        r2_group = QGroupBox("🌐 Configuración Cloudflare R2")
        r2_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                border: 2px solid #366092;
                border-radius: 5px;
                margin-top: 10px;
                padding-top: 10px;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        r2_layout = QVBoxLayout()
        
        # Warning de seguridad
        warning = QLabel("🔐 Información sensible - Solo visible para administradores")
        warning.setStyleSheet("""
            QLabel {
                background-color: #FCF8E3;
                color: #8A6D3B;
                padding: 8px;
                border: 1px solid #FAEBCC;
                border-radius: 4px;
                margin-bottom: 10px;
            }
        """)
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
        
        # Botones R2
        r2_buttons = QHBoxLayout()
        save_btn = QPushButton("💾 Guardar Configuración R2")
        save_btn.setStyleSheet("""
            QPushButton {
                background-color: #5CB85C;
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        r2_buttons.addWidget(save_btn)
        
        test_btn = QPushButton("🔌 Probar Conexión")
        test_btn.setStyleSheet("""
            QPushButton {
                background-color: #4A90E2;
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        r2_buttons.addWidget(test_btn)
        r2_buttons.addStretch()
        r2_layout.addLayout(r2_buttons)
        
        r2_group.setLayout(r2_layout)
        layout.addWidget(r2_group)
        layout.addSpacing(20)
    
    def _create_config_field(self, layout, label_text, input_attr, button_attr):
        """Crear campo de configuración con botón de visibilidad"""
        from PyQt6.QtWidgets import QHBoxLayout, QLabel, QLineEdit, QPushButton
        
        field_layout = QHBoxLayout()
        field_layout.addWidget(QLabel(label_text))
        
        input_field = QLineEdit()
        input_field.setEchoMode(QLineEdit.EchoMode.Password)
        input_field.setPlaceholderText(f"Tu {label_text.replace(':', '')}")
        setattr(self, input_attr, input_field)
        field_layout.addWidget(input_field)
        
        show_btn = QPushButton("👁️")
        show_btn.setMaximumWidth(40)
        show_btn.setCheckable(True)
        setattr(self, button_attr, show_btn)
        field_layout.addWidget(show_btn)
        
        layout.addLayout(field_layout)
    
    def _create_upload_section(self, layout):
        """Crear sección de subida de drivers"""
        from PyQt6.QtWidgets import QHBoxLayout, QLabel, QComboBox, QLineEdit, QPushButton
        
        upload_label = QLabel("➕ Subir Nuevo Driver")
        upload_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(upload_label)
        
        upload_layout = QHBoxLayout()
        upload_layout.addWidget(QLabel("Marca:"))
        self.upload_brand = QComboBox()
        self.upload_brand.addItems(["Magicard", "Zebra", "Entrust Sigma"])
        upload_layout.addWidget(self.upload_brand)
        
        upload_layout.addWidget(QLabel("Versión:"))
        self.upload_version = QLineEdit()
        self.upload_version.setPlaceholderText("ej: 1.2.3")
        upload_layout.addWidget(self.upload_version)
        layout.addLayout(upload_layout)
        
        desc_layout = QHBoxLayout()
        desc_layout.addWidget(QLabel("Descripción:"))
        self.upload_description = QLineEdit()
        self.upload_description.setPlaceholderText("Descripción del driver")
        desc_layout.addWidget(self.upload_description)
        layout.addLayout(desc_layout)
        
        file_layout = QHBoxLayout()
        self.selected_file_label = QLabel("No se ha seleccionado archivo")
        file_layout.addWidget(self.selected_file_label)
        
        select_btn = QPushButton("📁 Seleccionar Archivo")
        file_layout.addWidget(select_btn)
        
        upload_btn = QPushButton("☁️ Subir a la Nube")
        file_layout.addWidget(upload_btn)
        layout.addLayout(file_layout)
    
    def _create_delete_section(self, layout):
        """Crear sección de eliminación de drivers"""
        from PyQt6.QtWidgets import QListWidget, QPushButton
        
        layout.addSpacing(20)
        delete_label = QLabel("🗑️ Eliminar Drivers")
        delete_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(delete_label)
        
        self.admin_drivers_list = QListWidget()
        layout.addWidget(self.admin_drivers_list)
        
        delete_btn = QPushButton("❌ Eliminar Seleccionado")
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
        
        info_label = QLabel("ℹ️ Configuración General")
        info_label.setFont(QFont("Arial", 14, QFont.Weight.Bold))
        layout.addWidget(info_label)
        
        info_text = QLabel(
            "La configuración de Cloudflare R2 ahora está protegida.\n"
            "Accede a la pestaña '🔐 Administración' con tu contraseña de admin\n"
            "para ver y modificar las credenciales de la nube."
        )
        info_text.setStyleSheet("""
            QLabel {
                background-color: #D9EDF7;
                color: #31708F;
                padding: 15px;
                border: 1px solid #BCE8F1;
                border-radius: 4px;
                margin: 10px 0;
            }
        """)
        layout.addWidget(info_text)
        
        layout.addSpacing(20)
        
        # Cambiar contraseña
        admin_label = QLabel("🔐 Contraseña de Administrador")
        admin_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(admin_label)
        
        change_pass_btn = QPushButton("🔑 Cambiar Contraseña")
        change_pass_btn.setStyleSheet("""
            QPushButton {
                background-color: #F0AD4E;
                color: white;
                padding: 10px 20px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        layout.addWidget(change_pass_btn)
        
        # Cache
        layout.addSpacing(30)
        cache_label = QLabel("🗂️ Caché Local")
        cache_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(cache_label)
        
        if hasattr(self.parent, 'cache_dir'):
            cache_info = QLabel(f"Ubicación: {self.parent.cache_dir}")
            cache_info.setStyleSheet("color: #666;")
            layout.addWidget(cache_info)
        
        clear_cache_btn = QPushButton("🧹 Limpiar Caché")
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
        self.time_spinbox.setValue(self.installation_data.get('installation_time_seconds', 0) or 0)
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
            'time_seconds': self.time_spinbox.value()
        }