"""
Interfaz de Usuario para Gestión de Usuarios Multi-Admin
"""

from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                             QListWidget, QLabel, QLineEdit, QComboBox, QTextEdit,
                             QListWidgetItem, QGroupBox, QTableWidget, QTableWidgetItem,
                             QHeaderView, QMessageBox, QInputDialog, QDialog, QFormLayout,
                             QDialogButtonBox, QCheckBox)
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QFont
from datetime import datetime


class UserManagementDialog(QDialog):
    """Diálogo para gestión de usuarios"""
    
    def __init__(self, user_manager, parent=None):
        super().__init__(parent)
        self.user_manager = user_manager
        self.user_source_mode = "local"
        self.setWindowTitle("Gestión de Usuarios")
        self.setGeometry(200, 200, 800, 600)
        
        # Aplicar tema si está disponible
        if parent and hasattr(parent, 'theme_manager'):
            try:
                stylesheet = parent.theme_manager.generate_stylesheet()
                self.setStyleSheet(stylesheet)
            except:
                pass
        
        self.init_ui()
        self.refresh_users()
    
    def init_ui(self):
        layout = QVBoxLayout(self)

        title = QLabel("👥 Gestión de Usuarios Multi-Admin")
        title.setFont(QFont("Arial", 16, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)

        current_user = self.user_manager.current_user
        if current_user:
            info = QLabel(f"🔒 Conectado como: {current_user.get('username')} ({current_user.get('role')})")
            info.setStyleSheet("color: green; font-weight: bold; padding: 10px;")
            layout.addWidget(info)

        buttons_layout = QHBoxLayout()

        if self.user_manager.is_super_admin():
            create_btn = QPushButton("➕ Crear Usuario")
            create_btn.clicked.connect(self.create_user)
            create_btn.setStyleSheet("""
                QPushButton {
                    background-color: #5CB85C;
                    color: white;
                    padding: 8px 16px;
                    border-radius: 4px;
                    font-weight: bold;
                }
            """)
            buttons_layout.addWidget(create_btn)

            self.tenant_filter_input = QLineEdit()
            self.tenant_filter_input.setPlaceholderText("tenant_id (opcional)")
            self.tenant_filter_input.setMaximumWidth(180)
            buttons_layout.addWidget(self.tenant_filter_input)

            web_users_btn = QPushButton("🌐 Ver Usuarios Web")
            web_users_btn.clicked.connect(self.show_web_users)
            buttons_layout.addWidget(web_users_btn)

            local_users_btn = QPushButton("💾 Ver Usuarios Locales")
            local_users_btn.clicked.connect(self.show_local_users)
            buttons_layout.addWidget(local_users_btn)

        change_pass_btn = QPushButton("🔑 Cambiar Mi Contraseña")
        change_pass_btn.clicked.connect(self.change_password)
        change_pass_btn.setStyleSheet("""
            QPushButton {
                background-color: #F0AD4E;
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        buttons_layout.addWidget(change_pass_btn)

        refresh_btn = QPushButton("🔄 Actualizar")
        refresh_btn.clicked.connect(self.refresh_users)
        buttons_layout.addWidget(refresh_btn)

        buttons_layout.addStretch()
        layout.addLayout(buttons_layout)

        users_label = QLabel("👤 Usuarios Registrados:")
        users_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(users_label)

        self.users_table = QTableWidget()
        self.users_table.setColumnCount(7)
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

        if self.user_manager.is_super_admin():
            user_buttons = QHBoxLayout()
            deactivate_btn = QPushButton("❌ Desactivar Usuario")
            deactivate_btn.clicked.connect(self.deactivate_user)
            deactivate_btn.setStyleSheet("""
                QPushButton {
                    background-color: #D9534F;
                    color: white;
                    padding: 8px 16px;
                    border-radius: 4px;
                    font-weight: bold;
                }
            """)
            user_buttons.addWidget(deactivate_btn)
            user_buttons.addStretch()
            layout.addLayout(user_buttons)

        logs_label = QLabel("📋 Logs de Acceso Recientes:")
        logs_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(logs_label)

        self.logs_text = QTextEdit()
        self.logs_text.setMaximumHeight(200)
        self.logs_text.setReadOnly(True)
        self.logs_text.setStyleSheet("background-color: #F5F5F5; font-family: monospace;")
        layout.addWidget(self.logs_text)

        button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)

        self.timer = QTimer()
        self.timer.timeout.connect(self.refresh_logs)
        self.timer.start(30000)
    
    def refresh_users(self):
        """Actualizar tabla de usuarios"""
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
            role = str(user.get("role") or "viewer")
            active = bool(user.get("active", True))
            tenant_id = user.get("tenant_id") or "-"
            last_login = user.get("last_login")
            created = user.get("created_at")
            created_by = user.get("created_by", "N/A")

            self.users_table.setItem(row, 0, QTableWidgetItem(username))

            role_item = QTableWidgetItem(role)
            if role == "super_admin":
                role_item.setBackground(Qt.GlobalColor.red)
                role_item.setForeground(Qt.GlobalColor.white)
            elif role == "admin":
                role_item.setBackground(Qt.GlobalColor.blue)
                role_item.setForeground(Qt.GlobalColor.white)
            self.users_table.setItem(row, 1, role_item)

            self.users_table.setItem(row, 2, QTableWidgetItem(str(tenant_id)))

            status = "✅ Activo" if active else "❌ Inactivo"
            status_item = QTableWidgetItem(status)
            if not active:
                status_item.setBackground(Qt.GlobalColor.lightGray)
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
        logs = self.user_manager.get_access_logs(50)
        
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
            if tenant_id:
                if not admin_web_password:
                    QMessageBox.warning(
                        self,
                        "Error",
                        "Para crear por tenant debes ingresar tu contraseña web de super_admin.",
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
                if tenant_id:
                    self.user_source_mode = "web"
                self.refresh_users()
            else:
                QMessageBox.warning(self, "Error", message)
    
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
        self.setWindowTitle("Crear Usuario")
        self.setModal(True)
        self.resize(560, 360)
        self.setMinimumSize(520, 340)
        self.init_ui()
    
    def init_ui(self):
        layout = QFormLayout(self)
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
        self.role_combo.addItems(["admin", "viewer"])
        layout.addRow("Rol:", self.role_combo)

        self.tenant_input = QLineEdit()
        self.tenant_input.setPlaceholderText("tenant-a (opcional, crea usuario en API web por tenant)")
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
    
    def get_data(self):
        return (
            self.username_input.text(),
            self.password_input.text(),
            self.confirm_password_input.text(),
            self.role_combo.currentText(),
            self.tenant_input.text(),
            self.admin_web_password_input.text(),
        )


class LoginDialog(QDialog):
    """Diálogo de login multi-usuario."""

    def __init__(self, user_manager, parent=None):
        super().__init__(parent)
        self.user_manager = user_manager
        self.setWindowTitle("Iniciar Sesión - SiteOps")
        self.setModal(True)
        self.setFixedSize(420, 240)

        if parent and hasattr(parent, "theme_manager"):
            try:
                stylesheet = parent.theme_manager.generate_stylesheet()
                self.setStyleSheet(stylesheet)
            except Exception:
                pass

        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)

        title = QLabel("Iniciar Sesión")
        title.setFont(QFont("Arial", 16, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)

        form_layout = QFormLayout()

        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Nombre de usuario")
        self.username_input.textChanged.connect(self._clear_error)
        form_layout.addRow("Usuario:", self.username_input)

        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("Contraseña")
        self.password_input.returnPressed.connect(self.login)
        self.password_input.textChanged.connect(self._clear_error)
        form_layout.addRow("Contraseña:", self.password_input)

        layout.addLayout(form_layout)

        self.error_label = QLabel("")
        self.error_label.setWordWrap(True)
        self.error_label.setVisible(False)
        self.error_label.setStyleSheet(
            "color: #C0392B; background-color: #FDEDEC; border: 1px solid #F5B7B1; "
            "border-radius: 4px; padding: 6px;"
        )
        layout.addWidget(self.error_label)

        buttons_layout = QHBoxLayout()

        self.login_btn = QPushButton("Iniciar Sesión")
        self.login_btn.clicked.connect(self.login)
        self.login_btn.setStyleSheet(
            """
            QPushButton {
                background-color: #5CB85C;
                color: white;
                padding: 10px 20px;
                border-radius: 4px;
                font-weight: bold;
            }
            """
        )
        buttons_layout.addWidget(self.login_btn)

        cancel_btn = QPushButton("Cancelar")
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
            self._set_error("Ingresa usuario y contraseña")
            return

        success, message = self.user_manager.authenticate(username, password)
        if success:
            self.accept()
            return

        blocked = "cuenta bloqueada" in str(message).lower()
        self._set_error(message, blocked=blocked)
