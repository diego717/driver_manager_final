"""
Interfaz de Usuario para Gestión de Usuarios Multi-Admin
"""

from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                             QListWidget, QLabel, QLineEdit, QComboBox, QTextEdit,
                             QListWidgetItem, QGroupBox, QTableWidget, QTableWidgetItem,
                             QHeaderView, QMessageBox, QInputDialog, QDialog, QFormLayout,
                             QDialogButtonBox, QCheckBox)
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QColor, QFont
from datetime import datetime

from ui.theme_manager import resolve_theme_manager

ROLE_LABELS = {
    "super_admin": "super_admin",
    "admin": "admin",
    "supervisor": "supervisor",
    "tecnico": "tecnico",
    "solo_lectura": "solo_lectura",
    "viewer": "solo_lectura",
}
TECHNICIAN_CATALOG_MANAGER_ROLES = {"admin", "super_admin"}


def normalize_role_name(role):
    normalized = str(role or "solo_lectura").strip().lower() or "solo_lectura"
    return ROLE_LABELS.get(normalized, normalized)


def can_manage_technician_catalog(user_manager):
    current_user = getattr(user_manager, "current_user", None) or {}
    role = str(current_user.get("role") or "").strip().lower()
    return role in TECHNICIAN_CATALOG_MANAGER_ROLES


class UserManagementDialog(QDialog):
    """Diálogo para gestión de usuarios"""
    
    def __init__(self, user_manager, history_manager=None, parent=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.colors = self.theme_manager.get_theme_colors()
        self.user_manager = user_manager
        self.history_manager = history_manager
        auth_mode = str(getattr(self.user_manager, "auth_mode", "legacy") or "legacy").strip().lower()
        current_source = str(
            (getattr(self.user_manager, "current_user", {}) or {}).get("source") or ""
        ).strip().lower()
        self.user_source_mode = "web" if auth_mode in ("web", "auto") or current_source == "web" else "local"
        self.setWindowTitle("Gestión de Usuarios")
        self.setGeometry(200, 200, 800, 600)
        self.setStyleSheet(self.theme_manager.generate_stylesheet())
        
        self.init_ui()
        self.refresh_users()

    def _render_not_authenticated_state(self, message=None):
        """Mostrar estado degradado cuando no hay sesión activa."""
        self.users_table.setRowCount(0)
        fallback_message = message or "Inicia sesion nuevamente para continuar."
        self.logs_text.setText(fallback_message)
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 18, 18, 18)
        layout.setSpacing(12)

        eyebrow = QLabel("ADMIN / IDENTIDAD")
        eyebrow.setAlignment(Qt.AlignmentFlag.AlignCenter)
        eyebrow.setProperty("class", "chip")
        layout.addWidget(eyebrow, alignment=Qt.AlignmentFlag.AlignCenter)

        title = QLabel("Gestión de usuarios")
        title.setFont(self.theme_manager.create_font("display", 16, 700))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setProperty("class", "heroTitle")
        layout.addWidget(title)

        subtitle = QLabel("Controla accesos, sesiones recientes y el origen de cada cuenta.")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setWordWrap(True)
        subtitle.setProperty("class", "sectionMeta")
        layout.addWidget(subtitle)

        current_user = self.user_manager.current_user
        if current_user:
            info = QLabel(f"Conectado como: {current_user.get('username')} ({current_user.get('role')})")
            info.setProperty("class", "success")
            layout.addWidget(info)

        buttons_layout = QHBoxLayout()

        if self.user_manager.is_super_admin():
            create_btn = QPushButton("Crear usuario")
            create_btn.clicked.connect(self.create_user)
            create_btn.setProperty("class", "success")
            buttons_layout.addWidget(create_btn)

            self.tenant_filter_input = QLineEdit()
            self.tenant_filter_input.setPlaceholderText("tenant_id (opcional)")
            self.tenant_filter_input.setMaximumWidth(180)
            buttons_layout.addWidget(self.tenant_filter_input)

            web_users_btn = QPushButton("Ver usuarios web")
            web_users_btn.clicked.connect(self.show_web_users)
            buttons_layout.addWidget(web_users_btn)

            local_users_btn = QPushButton("Ver usuarios locales")
            local_users_btn.clicked.connect(self.show_local_users)
            buttons_layout.addWidget(local_users_btn)

        change_pass_btn = QPushButton("Cambiar mi contraseña")
        change_pass_btn.clicked.connect(self.change_password)
        change_pass_btn.setProperty("class", "warning")
        buttons_layout.addWidget(change_pass_btn)

        refresh_btn = QPushButton("Actualizar")
        refresh_btn.clicked.connect(self.refresh_users)
        buttons_layout.addWidget(refresh_btn)

        technicians_btn = QPushButton("Gestionar tecnicos")
        technicians_btn.clicked.connect(self.open_technician_management)
        buttons_layout.addWidget(technicians_btn)

        buttons_layout.addStretch()
        layout.addLayout(buttons_layout)

        users_label = QLabel("Usuarios registrados")
        users_label.setFont(self.theme_manager.create_font("display", 12, 700))
        users_label.setProperty("class", "sectionTitle")
        layout.addWidget(users_label)

        self.users_table = QTableWidget()
        self.users_table.setColumnCount(8)
        self.users_table.setHorizontalHeaderLabels([
            "Usuario", "Rol", "Tenant", "Estado", "Último Login", "Creado", "Creado Por"
        ])

        header = self.users_table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)
        layout.addWidget(self.users_table)
        self.users_table.setHorizontalHeaderLabels([
            "Usuario", "Rol", "Tenant", "Estado", "Ultimo Login", "Creado", "Creado Por", "Origen"
        ])
        header.setSectionResizeMode(7, QHeaderView.ResizeMode.ResizeToContents)

        if self.user_manager.is_super_admin():
            user_buttons = QHBoxLayout()
            deactivate_btn = QPushButton("Desactivar usuario")
            deactivate_btn.clicked.connect(self.deactivate_user)
            deactivate_btn.setProperty("class", "danger")
            user_buttons.addWidget(deactivate_btn)
            user_buttons.addStretch()
            layout.addLayout(user_buttons)

        logs_label = QLabel("Logs de acceso recientes")
        logs_label.setFont(self.theme_manager.create_font("display", 12, 700))
        logs_label.setProperty("class", "sectionTitle")
        layout.addWidget(logs_label)

        self.logs_text = QTextEdit()
        self.logs_text.setMaximumHeight(200)
        self.logs_text.setReadOnly(True)
        self.logs_text.setProperty("class", "logPanel")
        layout.addWidget(self.logs_text)

        button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)

        self.timer = QTimer()
        self.timer.timeout.connect(self.refresh_logs)
        self.timer.start(30000)
    
    def refresh_users(self):
        """Actualizar tabla de usuarios"""
        if not getattr(self.user_manager, "current_user", None):
            self._render_not_authenticated_state()
            return

        if self.user_source_mode == "web":
            self.refresh_web_users()
            return

        users = self.user_manager.get_users()
        self.populate_users_table(users)
        self.refresh_logs()

    def refresh_web_users(self):
        """Actualizar tabla de usuarios desde API web."""
        if not self.user_manager.is_super_admin():
            QMessageBox.warning(self, "Error", "Solo super_admin puede ver usuarios web.")
            return

        admin_web_password, ok = QInputDialog.getText(
            self,
            "Usuarios Web",
            "Ingresa tu contraseña web de super_admin:",
            QLineEdit.EchoMode.Password,
        )
        if not ok or not admin_web_password:
            return

        tenant_id = ""
        if hasattr(self, "tenant_filter_input"):
            tenant_id = self.tenant_filter_input.text().strip()

        try:
            users = self.user_manager.fetch_tenant_web_users(
                admin_web_password=admin_web_password,
                tenant_id=tenant_id or None,
            )
        except Exception as error:
            QMessageBox.warning(self, "Error", str(error))
            return

        self.populate_users_table(users)
        self.refresh_logs()

    def populate_users_table(self, users):
        """Poblar tabla con lista normalizada de usuarios."""
        self.users_table.setRowCount(len(users))

        for row, user in enumerate(users):
            username = str(user.get("username") or "")
            role = normalize_role_name(user.get("role"))
            source = str(user.get("source") or "local").strip().lower() or "local"
            active = bool(user.get("active", True))
            tenant_id = user.get("tenant_id") or "-"
            last_login = user.get("last_login")
            created = user.get("created_at")
            created_by = user.get("created_by", "N/A")

            self.users_table.setItem(row, 0, QTableWidgetItem(username))

            role_item = QTableWidgetItem(role)
            if role == "super_admin":
                role_item.setBackground(QColor(self.colors["error"]))
                role_item.setForeground(QColor(self.colors["text_inverse"]))
            elif role == "admin":
                role_item.setBackground(QColor(self.colors["accent"]))
                role_item.setForeground(QColor(self.colors["text_inverse"]))
            elif role == "supervisor":
                role_item.setBackground(QColor(self.colors["panel_warning"]))
                role_item.setForeground(QColor(self.colors["text_primary"]))
            elif role == "tecnico":
                role_item.setBackground(QColor(self.colors["panel_info"]))
                role_item.setForeground(QColor(self.colors["text_primary"]))
            self.users_table.setItem(row, 1, role_item)

            self.users_table.setItem(row, 2, QTableWidgetItem(str(tenant_id)))

            status = "Activo" if active else "Inactivo"
            status_item = QTableWidgetItem(status)
            if active:
                status_item.setBackground(QColor(self.colors["panel_success"]))
            else:
                status_item.setBackground(QColor(self.colors["surface_alt"]))
            self.users_table.setItem(row, 3, status_item)

            if last_login:
                try:
                    dt = datetime.fromisoformat(str(last_login))
                    last_login = dt.strftime("%d/%m/%Y %H:%M")
                except Exception:
                    pass
            else:
                last_login = "Nunca"
            self.users_table.setItem(row, 4, QTableWidgetItem(str(last_login)))

            if created:
                try:
                    dt = datetime.fromisoformat(str(created))
                    created = dt.strftime("%d/%m/%Y")
                except Exception:
                    pass
            else:
                created = ""
            self.users_table.setItem(row, 5, QTableWidgetItem(str(created)))

            self.users_table.setItem(row, 6, QTableWidgetItem(str(created_by)))

            source_item = QTableWidgetItem("Web" if source == "web" else "Local")
            if source == "web":
                source_item.setBackground(QColor(self.colors["panel_info"]))
                source_item.setForeground(QColor(self.colors["text_primary"]))
            else:
                source_item.setBackground(QColor(self.colors["surface_alt"]))
                source_item.setForeground(QColor(self.colors["text_secondary"]))
            self.users_table.setItem(row, 7, source_item)

    def show_web_users(self):
        """Cambiar a modo de visualización de usuarios web."""
        self.user_source_mode = "web"
        self.refresh_users()

    def show_local_users(self):
        """Cambiar a modo de visualización de usuarios locales."""
        self.user_source_mode = "local"
        self.refresh_users()
    
    def refresh_logs(self):
        """Actualizar logs de acceso"""
        if not getattr(self.user_manager, "current_user", None):
            self._render_not_authenticated_state(
                "La sesion expiro. Inicia sesion nuevamente para ver los logs."
            )
            return

        logs = self.user_manager.get_access_logs(50)
        if not getattr(self.user_manager, "current_user", None):
            self._render_not_authenticated_state(
                "La sesion expiro. Inicia sesion nuevamente para ver los logs."
            )
            return

        if not logs:
            self.logs_text.setText("No hay logs de acceso disponibles.")
            return
        
        log_text = ""
        for log in reversed(logs[-20:]):  # Ultimos 20
            timestamp = log["timestamp"]
            try:
                dt = datetime.fromisoformat(timestamp)
                timestamp = dt.strftime("%d/%m %H:%M")
            except:
                pass
            
            action = log["action"]
            username = log["username"]
            success = "✅" if log["success"] else "❌"
            system_info = log.get("system_info", {})
            if not isinstance(system_info, dict):
                system_info = {}
            computer = (
                log.get("computer_name")
                or system_info.get("computer_name")
                or "Unknown"
            )
            
            log_text += f"[{timestamp}] {success} {action} - {username} @ {computer}\n"
        
        self.logs_text.setText(log_text)
    
    def create_user(self):
        """Crear nuevo usuario"""
        dialog = CreateUserDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            username, password, confirm_password, role, tenant_id, admin_web_password = dialog.get_data()
            
            # Validar que las contraseñas coincidan
            if password != confirm_password:
                QMessageBox.warning(self, "Error", "Las contraseñas no coinciden")
                return
            
            if not username or not password:
                QMessageBox.warning(self, "Error", "Usuario y contraseña son obligatorios")
                return
            
            tenant_id = (tenant_id or "").strip()
            auth_mode = str(getattr(self.user_manager, "auth_mode", "legacy") or "legacy").strip().lower()
            current_source = str(
                (getattr(self.user_manager, "current_user", {}) or {}).get("source") or ""
            ).strip().lower()
            prefer_web_creation = auth_mode in ("web", "auto") or current_source == "web"

            if prefer_web_creation or tenant_id:
                if not admin_web_password:
                    QMessageBox.warning(
                        self,
                        "Error",
                        "Para crear usuarios web debes ingresar tu contraseña web de super_admin.",
                    )
                    return
                success, message = self.user_manager.create_tenant_web_user(
                    username=username,
                    password=password,
                    role=role,
                    tenant_id=tenant_id,
                    admin_web_password=admin_web_password,
                )
            else:
                success, message = self.user_manager.create_user(
                    username,
                    password,
                    role,
                    tenant_id=tenant_id or None,
                )
            
            if success:
                QMessageBox.information(self, "Éxito", message)
                if prefer_web_creation or tenant_id:
                    self.user_source_mode = "web"
                self.refresh_users()
            else:
                QMessageBox.warning(self, "Error", message)

    def open_technician_management(self):
        """Abrir gestion de tecnicos para el tenant de la sesion."""
        if not getattr(self, "history_manager", None):
            QMessageBox.warning(
                self,
                "No disponible",
                "No hay cliente de historial disponible para gestionar tecnicos.",
            )
            return

        dialog = TechnicianManagementDialog(
            history_manager=self.history_manager,
            user_manager=self.user_manager,
            parent=self,
        )
        dialog.exec()
    
    def change_password(self):
        """Cambiar contraseña del usuario actual"""
        current_username = self.user_manager.current_user.get("username")
        
        old_password, ok = QInputDialog.getText(
            self, "Cambiar Contraseña", 
            "Contraseña actual:", 
            QLineEdit.EchoMode.Password
        )
        if not ok:
            return
        
        new_password, ok = QInputDialog.getText(
            self, "Cambiar Contraseña", 
            "Nueva contraseña:", 
            QLineEdit.EchoMode.Password
        )
        if not ok:
            return
        
        confirm_password, ok = QInputDialog.getText(
            self, "Cambiar Contraseña", 
            "Confirmar nueva contraseña:", 
            QLineEdit.EchoMode.Password
        )
        if not ok:
            return
        
        if new_password != confirm_password:
            QMessageBox.warning(self, "Error", "Las contraseñas no coinciden")
            return
        
        success, message = self.user_manager.change_password(
            current_username, old_password, new_password
        )
        
        if success:
            QMessageBox.information(self, "Éxito", message)
        else:
            QMessageBox.warning(self, "Error", message)
    
    def deactivate_user(self):
        """Desactivar usuario seleccionado"""
        current_row = self.users_table.currentRow()
        if current_row < 0:
            QMessageBox.warning(self, "Error", "Selecciona un usuario")
            return
        
        username = self.users_table.item(current_row, 0).text()
        
        if username == "admin":
            QMessageBox.warning(self, "Error", "No se puede desactivar el usuario admin principal")
            return
        
        reply = QMessageBox.question(
            self, "Confirmar", 
            f"¿Desactivar usuario '{username}'?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            if self.user_source_mode == "web":
                QMessageBox.warning(
                    self,
                    "No soportado",
                    "La desactivación desde esta vista solo aplica a usuarios locales.",
                )
                return
            success, message = self.user_manager.deactivate_user(username)
            
            if success:
                QMessageBox.information(self, "Éxito", message)
                self.refresh_users()
            else:
                QMessageBox.warning(self, "Error", message)


class CreateUserDialog(QDialog):
    """Diálogo para crear usuario"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.setWindowTitle("Crear Usuario")
        self.setModal(True)
        self.resize(560, 360)
        self.setMinimumSize(520, 340)
        self.setStyleSheet(self.theme_manager.generate_stylesheet())
        self.init_ui()
    
    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        title = QLabel("Crear usuario")
        title.setProperty("class", "heroTitle")
        root.addWidget(title)

        subtitle = QLabel("Crea un usuario local o web con tenant y rol operativo.")
        subtitle.setWordWrap(True)
        subtitle.setProperty("class", "sectionMeta")
        root.addWidget(subtitle)

        layout = QFormLayout()
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setHorizontalSpacing(14)
        layout.setVerticalSpacing(10)
        
        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Nombre de usuario")
        self.username_input.setMinimumWidth(320)
        layout.addRow("Usuario:", self.username_input)
        
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("Contraseña")
        layout.addRow("Contraseña:", self.password_input)
        
        self.confirm_password_input = QLineEdit()
        self.confirm_password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_password_input.setPlaceholderText("Confirmar contraseña")
        layout.addRow("Confirmar:", self.confirm_password_input)
        
        self.role_combo = QComboBox()
        self.role_combo.addItems(["admin", "supervisor", "tecnico", "solo_lectura"])
        layout.addRow("Rol:", self.role_combo)

        self.tenant_input = QLineEdit()
        self.tenant_input.setPlaceholderText("tenant-a (opcional)")
        self.tenant_input.setMinimumWidth(320)
        layout.addRow("Tenant ID:", self.tenant_input)

        self.admin_web_password_input = QLineEdit()
        self.admin_web_password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.admin_web_password_input.setPlaceholderText("Tu contraseña web super_admin (solo si usas Tenant ID)")
        self.admin_web_password_input.setMinimumWidth(320)
        layout.addRow("Pass Web Admin:", self.admin_web_password_input)
        
        # Botones
        button_box = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        button_box.accepted.connect(self.accept)
        button_box.rejected.connect(self.reject)
        layout.addRow(button_box)
        root.addLayout(layout)
    
    def get_data(self):
        return (
            self.username_input.text(),
            self.password_input.text(),
            self.confirm_password_input.text(),
            self.role_combo.currentText(),
            self.tenant_input.text(),
            self.admin_web_password_input.text(),
        )


class TechnicianFormDialog(QDialog):
    """Formulario de alta/edicion para tecnicos."""

    def __init__(self, parent=None, technician=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.technician = technician or {}
        self.setModal(True)
        self.setStyleSheet(self.theme_manager.generate_stylesheet())
        self.setWindowTitle("Editar tecnico" if technician else "Crear tecnico")
        self.resize(520, 360)
        self.init_ui()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        title = QLabel("Editar tecnico" if self.technician else "Crear tecnico")
        title.setProperty("class", "heroTitle")
        root.addWidget(title)

        subtitle = QLabel(
            "Completa identidad operativa, contacto y vinculo opcional con usuario web."
        )
        subtitle.setWordWrap(True)
        subtitle.setProperty("class", "sectionMeta")
        root.addWidget(subtitle)

        layout = QFormLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setHorizontalSpacing(14)
        layout.setVerticalSpacing(10)

        self.display_name_input = QLineEdit(str(self.technician.get("display_name") or ""))
        self.display_name_input.setPlaceholderText("Nombre visible del tecnico")
        layout.addRow("Nombre:", self.display_name_input)

        self.employee_code_input = QLineEdit(str(self.technician.get("employee_code") or ""))
        self.employee_code_input.setPlaceholderText("Codigo interno (opcional)")
        layout.addRow("Codigo:", self.employee_code_input)

        self.email_input = QLineEdit(str(self.technician.get("email") or ""))
        self.email_input.setPlaceholderText("mail@empresa.com (opcional)")
        layout.addRow("Email:", self.email_input)

        self.phone_input = QLineEdit(str(self.technician.get("phone") or ""))
        self.phone_input.setPlaceholderText("+598... (opcional)")
        layout.addRow("Telefono:", self.phone_input)

        self.web_user_id_input = QLineEdit(
            "" if self.technician.get("web_user_id") in (None, "") else str(self.technician.get("web_user_id"))
        )
        self.web_user_id_input.setPlaceholderText("ID de usuario web vinculado (opcional)")
        layout.addRow("Web user ID:", self.web_user_id_input)

        self.notes_input = QTextEdit(str(self.technician.get("notes") or ""))
        self.notes_input.setPlaceholderText("Notas operativas (opcional)")
        self.notes_input.setMaximumHeight(100)
        layout.addRow("Notas:", self.notes_input)

        self.active_checkbox = QCheckBox("Tecnico activo")
        self.active_checkbox.setChecked(bool(self.technician.get("is_active", True)))
        layout.addRow("Estado:", self.active_checkbox)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addRow(buttons)
        root.addLayout(layout)

    def get_payload(self):
        web_user_raw = self.web_user_id_input.text().strip()
        if web_user_raw:
            try:
                web_user_id = int(web_user_raw)
                if web_user_id <= 0:
                    raise ValueError("non-positive")
            except Exception as error:
                raise ValueError("Web user ID debe ser un entero positivo.") from error
        else:
            web_user_id = None

        return {
            "display_name": self.display_name_input.text().strip(),
            "employee_code": self.employee_code_input.text().strip(),
            "email": self.email_input.text().strip(),
            "phone": self.phone_input.text().strip(),
            "notes": self.notes_input.toPlainText().strip(),
            "web_user_id": web_user_id,
            "is_active": bool(self.active_checkbox.isChecked()),
        }


class TechnicianManagementDialog(QDialog):
    """Directorio de tecnicos para la app de Windows."""

    def __init__(self, history_manager, user_manager, parent=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.colors = self.theme_manager.get_theme_colors()
        self.history_manager = history_manager
        self.user_manager = user_manager
        self.can_edit_catalog = can_manage_technician_catalog(user_manager)
        self.setWindowTitle("Directorio de tecnicos")
        self.resize(980, 620)
        self.setStyleSheet(self.theme_manager.generate_stylesheet())
        self.init_ui()
        self.refresh_technicians()

    def init_ui(self):
        layout = QVBoxLayout(self)

        title = QLabel("Directorio de tecnicos")
        title.setFont(self.theme_manager.create_font("display", 15, 700))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setProperty("class", "heroTitle")
        layout.addWidget(title)

        subtitle = QLabel(
            "Gestiona el catalogo operativo por tenant y vincula tecnicos con usuarios web."
        )
        subtitle.setWordWrap(True)
        subtitle.setProperty("class", "sectionMeta")
        layout.addWidget(subtitle)

        role = str((getattr(self.user_manager, "current_user", {}) or {}).get("role") or "")
        role_info = QLabel(f"Sesion actual: {role}")
        role_info.setProperty("class", "info")
        layout.addWidget(role_info)

        if not self.can_edit_catalog:
            warning = QLabel("Solo admin y super_admin pueden editar tecnicos. Vista en modo lectura.")
            warning.setProperty("class", "warning")
            warning.setWordWrap(True)
            layout.addWidget(warning)

        toolbar = QHBoxLayout()
        self.include_inactive_checkbox = QCheckBox("Incluir inactivos")
        self.include_inactive_checkbox.setChecked(True)
        self.include_inactive_checkbox.stateChanged.connect(self.refresh_technicians)
        toolbar.addWidget(self.include_inactive_checkbox)

        refresh_btn = QPushButton("Actualizar")
        refresh_btn.clicked.connect(self.refresh_technicians)
        toolbar.addWidget(refresh_btn)

        self.create_btn = QPushButton("Crear tecnico")
        self.create_btn.clicked.connect(self.create_technician)
        self.create_btn.setEnabled(self.can_edit_catalog)
        toolbar.addWidget(self.create_btn)

        self.edit_btn = QPushButton("Editar tecnico")
        self.edit_btn.clicked.connect(self.edit_selected_technician)
        self.edit_btn.setEnabled(self.can_edit_catalog)
        toolbar.addWidget(self.edit_btn)

        toolbar.addStretch()
        layout.addLayout(toolbar)

        self.table = QTableWidget()
        self.table.setColumnCount(9)
        self.table.setHorizontalHeaderLabels(
            [
                "ID",
                "Nombre",
                "Codigo",
                "Email",
                "Telefono",
                "Web User ID",
                "Estado",
                "Asignaciones activas",
                "Actualizado",
            ]
        )
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(7, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(8, QHeaderView.ResizeMode.ResizeToContents)
        layout.addWidget(self.table)

        self.status_label = QLabel("")
        self.status_label.setProperty("class", "sectionMeta")
        layout.addWidget(self.status_label)

        button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)

    def _selected_technician(self):
        row = self.table.currentRow()
        if row < 0:
            return None
        item = self.table.item(row, 0)
        if item is None:
            return None
        payload = item.data(Qt.ItemDataRole.UserRole)
        return payload if isinstance(payload, dict) else None

    def refresh_technicians(self):
        include_inactive = bool(self.include_inactive_checkbox.isChecked())
        try:
            technicians = self.history_manager.list_technicians(include_inactive=include_inactive)
        except Exception as error:
            QMessageBox.warning(self, "Error", f"No se pudo cargar tecnicos:\n{error}")
            return

        self.table.setRowCount(len(technicians))
        for row, technician in enumerate(technicians):
            technician_id = technician.get("id")
            id_item = QTableWidgetItem(str(technician_id))
            id_item.setData(Qt.ItemDataRole.UserRole, technician)
            self.table.setItem(row, 0, id_item)
            self.table.setItem(row, 1, QTableWidgetItem(str(technician.get("display_name") or "")))
            self.table.setItem(row, 2, QTableWidgetItem(str(technician.get("employee_code") or "")))
            self.table.setItem(row, 3, QTableWidgetItem(str(technician.get("email") or "")))
            self.table.setItem(row, 4, QTableWidgetItem(str(technician.get("phone") or "")))
            self.table.setItem(
                row,
                5,
                QTableWidgetItem(
                    "" if technician.get("web_user_id") in (None, "") else str(technician.get("web_user_id"))
                ),
            )

            status_item = QTableWidgetItem("Activo" if technician.get("is_active", True) else "Inactivo")
            if technician.get("is_active", True):
                status_item.setBackground(QColor(self.colors["panel_success"]))
            else:
                status_item.setBackground(QColor(self.colors["surface_alt"]))
            self.table.setItem(row, 6, status_item)

            self.table.setItem(
                row,
                7,
                QTableWidgetItem(str(int(technician.get("active_assignment_count") or 0))),
            )
            self.table.setItem(row, 8, QTableWidgetItem(str(technician.get("updated_at") or "")))

        self.status_label.setText(f"Tecnicos cargados: {len(technicians)}")

    def create_technician(self):
        if not self.can_edit_catalog:
            QMessageBox.warning(self, "Acceso denegado", "Tu rol no puede crear tecnicos.")
            return
        dialog = TechnicianFormDialog(self)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
        try:
            payload = dialog.get_payload()
            self.history_manager.create_technician(**payload)
        except Exception as error:
            QMessageBox.warning(self, "Error", f"No se pudo crear tecnico:\n{error}")
            return
        QMessageBox.information(self, "Exito", "Tecnico creado correctamente.")
        self.refresh_technicians()

    def edit_selected_technician(self):
        if not self.can_edit_catalog:
            QMessageBox.warning(self, "Acceso denegado", "Tu rol no puede editar tecnicos.")
            return
        technician = self._selected_technician()
        if not technician:
            QMessageBox.warning(self, "Atencion", "Selecciona un tecnico para editar.")
            return
        dialog = TechnicianFormDialog(self, technician=technician)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
        try:
            payload = dialog.get_payload()
            self.history_manager.update_technician(technician.get("id"), **payload)
        except Exception as error:
            QMessageBox.warning(self, "Error", f"No se pudo actualizar tecnico:\n{error}")
            return
        QMessageBox.information(self, "Exito", "Tecnico actualizado correctamente.")
        self.refresh_technicians()


class LoginDialog(QDialog):
    """Di\u00e1logo de login multi-usuario."""

    def __init__(self, user_manager, parent=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.colors = self.theme_manager.get_theme_colors()
        self.user_manager = user_manager
        self.setWindowTitle("Iniciar Sesi\u00f3n - SiteOps")
        self.setModal(True)
        self.setFixedSize(430, 252)
        self.setStyleSheet(self.theme_manager.generate_stylesheet())

        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 14, 16, 16)
        layout.setSpacing(10)

        eyebrow = QLabel("ACCESO / WINDOWS")
        eyebrow.setAlignment(Qt.AlignmentFlag.AlignCenter)
        eyebrow.setProperty("class", "chip")
        layout.addWidget(eyebrow, alignment=Qt.AlignmentFlag.AlignCenter)

        title = QLabel("Iniciar Sesi\u00f3n")
        title.setFont(self.theme_manager.create_font("display", 15, 700))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setProperty("class", "heroTitle")
        layout.addWidget(title)

        subtitle = QLabel("Entra con tu cuenta para continuar con operaciones y administraci\u00f3n.")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setWordWrap(True)
        subtitle.setProperty("class", "sectionMeta")
        layout.addWidget(subtitle)

        form_layout = QFormLayout()
        form_layout.setHorizontalSpacing(10)
        form_layout.setVerticalSpacing(8)
        form_layout.setLabelAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        form_layout.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)

        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Nombre de usuario")
        self.username_input.setFixedHeight(36)
        self.username_input.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self.username_input.textChanged.connect(self._clear_error)

        username_label = QLabel("Usuario:")
        username_label.setMinimumWidth(88)
        username_label.setFixedHeight(36)
        username_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        form_layout.addRow(username_label, self.username_input)

        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("Contrase\u00f1a")
        self.password_input.setFixedHeight(36)
        self.password_input.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self.password_input.returnPressed.connect(self.login)
        self.password_input.textChanged.connect(self._clear_error)

        password_label = QLabel("Contrase\u00f1a:")
        password_label.setMinimumWidth(88)
        password_label.setFixedHeight(36)
        password_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        form_layout.addRow(password_label, self.password_input)

        layout.addLayout(form_layout)

        self.error_label = QLabel("")
        self.error_label.setWordWrap(True)
        self.error_label.setVisible(False)
        self.error_label.setProperty("class", "error")
        layout.addWidget(self.error_label)

        buttons_layout = QHBoxLayout()

        self.login_btn = QPushButton("Iniciar Sesi\u00f3n")
        self.login_btn.clicked.connect(self.login)
        self.login_btn.setProperty("class", "primary")
        self.login_btn.setMinimumHeight(36)
        self.login_btn.setMinimumWidth(150)
        buttons_layout.addWidget(self.login_btn)

        cancel_btn = QPushButton("Cancelar")
        cancel_btn.setMinimumHeight(36)
        cancel_btn.setMinimumWidth(150)
        cancel_btn.clicked.connect(self.reject)
        buttons_layout.addWidget(cancel_btn)

        layout.addLayout(buttons_layout)
        self.username_input.setFocus()

    def _set_error(self, message, blocked=False):
        """Mostrar error inline y feedback visual."""
        self.error_label.setText(str(message))
        self.error_label.setVisible(True)
        self.password_input.clear()

        if blocked:
            self.password_input.setEnabled(False)
            self.login_btn.setEnabled(False)
            self.username_input.setFocus()
        else:
            self.password_input.setEnabled(True)
            self.login_btn.setEnabled(True)
            self.password_input.setFocus()

    def _clear_error(self):
        """Ocultar error inline cuando el usuario vuelve a escribir."""
        if self.error_label.isVisible():
            self.error_label.clear()
            self.error_label.setVisible(False)
        if not self.password_input.isEnabled():
            self.password_input.setEnabled(True)
        if not self.login_btn.isEnabled():
            self.login_btn.setEnabled(True)

    def login(self):
        """Intentar login."""
        username = self.username_input.text().strip()
        password = self.password_input.text()

        if not username or not password:
            self._set_error("Ingresa usuario y contrase\u00f1a")
            return

        success, message = self.user_manager.authenticate(username, password)
        if success:
            self.accept()
            return

        blocked = "cuenta bloqueada" in str(message).lower()
        self._set_error(message, blocked=blocked)
