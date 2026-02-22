"""
Interfaz de Usuario para GestiÃ³n de Usuarios Multi-Admin
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
    """DiÃ¡logo para gestiÃ³n de usuarios"""
    
    def __init__(self, user_manager, parent=None):
        super().__init__(parent)
        self.user_manager = user_manager
        self.setWindowTitle("GestiÃ³n de Usuarios")
        self.setGeometry(200, 200, 800, 600)
        
        # Aplicar tema si estÃ¡ disponible
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
        
        # TÃ­tulo
        title = QLabel("ðŸ‘¥ GestiÃ³n de Usuarios Multi-Admin")
        title.setFont(QFont("Arial", 16, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)
        
        # InformaciÃ³n del usuario actual
        current_user = self.user_manager.current_user
        if current_user:
            info = QLabel(f"ðŸ”“ Conectado como: {current_user.get('username')} ({current_user.get('role')})")
            info.setStyleSheet("color: green; font-weight: bold; padding: 10px;")
            layout.addWidget(info)
        
        # Botones de acciÃ³n
        buttons_layout = QHBoxLayout()
        
        if self.user_manager.is_super_admin():
            create_btn = QPushButton("âž• Crear Usuario")
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
        
        change_pass_btn = QPushButton("ðŸ”‘ Cambiar Mi ContraseÃ±a")
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
        
        refresh_btn = QPushButton("ðŸ”„ Actualizar")
        refresh_btn.clicked.connect(self.refresh_users)
        buttons_layout.addWidget(refresh_btn)
        
        buttons_layout.addStretch()
        layout.addLayout(buttons_layout)
        
        # Tabla de usuarios
        users_label = QLabel("ðŸ‘¤ Usuarios Registrados:")
        users_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(users_label)
        
        self.users_table = QTableWidget()
        self.users_table.setColumnCount(6)
        self.users_table.setHorizontalHeaderLabels([
            "Usuario", "Rol", "Estado", "Ãšltimo Login", "Creado", "Creado Por"
        ])
        
        # Ajustar columnas
        header = self.users_table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        
        layout.addWidget(self.users_table)
        
        # Botones de usuario
        if self.user_manager.is_super_admin():
            user_buttons = QHBoxLayout()
            
            deactivate_btn = QPushButton("âŒ Desactivar Usuario")
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
        
        # Logs de acceso
        logs_label = QLabel("ðŸ“‹ Logs de Acceso Recientes:")
        logs_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(logs_label)
        
        self.logs_text = QTextEdit()
        self.logs_text.setMaximumHeight(200)
        self.logs_text.setReadOnly(True)
        self.logs_text.setStyleSheet("background-color: #F5F5F5; font-family: monospace;")
        layout.addWidget(self.logs_text)
        
        # Botones del diÃ¡logo
        button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)
        
        # Auto-refresh cada 30 segundos
        self.timer = QTimer()
        self.timer.timeout.connect(self.refresh_logs)
        self.timer.start(30000)  # 30 segundos
    
    def refresh_users(self):
        """Actualizar tabla de usuarios"""
        users = self.user_manager.get_users()
        self.users_table.setRowCount(len(users))
        
        for row, user in enumerate(users):
            self.users_table.setItem(row, 0, QTableWidgetItem(user["username"]))
            
            # Rol con color
            role_item = QTableWidgetItem(user["role"])
            if user["role"] == "super_admin":
                role_item.setBackground(Qt.GlobalColor.red)
                role_item.setForeground(Qt.GlobalColor.white)
            elif user["role"] == "admin":
                role_item.setBackground(Qt.GlobalColor.blue)
                role_item.setForeground(Qt.GlobalColor.white)
            self.users_table.setItem(row, 1, role_item)
            
            # Estado
            status = "âœ… Activo" if user["active"] else "âŒ Inactivo"
            status_item = QTableWidgetItem(status)
            if not user["active"]:
                status_item.setBackground(Qt.GlobalColor.lightGray)
            self.users_table.setItem(row, 2, status_item)
            
            # Ãšltimo login
            last_login = user["last_login"]
            if last_login:
                try:
                    dt = datetime.fromisoformat(last_login)
                    last_login = dt.strftime("%d/%m/%Y %H:%M")
                except:
                    pass
            else:
                last_login = "Nunca"
            self.users_table.setItem(row, 3, QTableWidgetItem(last_login))
            
            # Creado
            created = user["created_at"]
            if created:
                try:
                    dt = datetime.fromisoformat(created)
                    created = dt.strftime("%d/%m/%Y")
                except:
                    pass
            self.users_table.setItem(row, 4, QTableWidgetItem(created))
            
            # Creado por
            self.users_table.setItem(row, 5, QTableWidgetItem(user.get("created_by", "N/A")))
        
        self.refresh_logs()
    
    def refresh_logs(self):
        """Actualizar logs de acceso"""
        logs = self.user_manager.get_access_logs(50)
        
        log_text = ""
        for log in reversed(logs[-20:]):  # Ãšltimos 20
            timestamp = log["timestamp"]
            try:
                dt = datetime.fromisoformat(timestamp)
                timestamp = dt.strftime("%d/%m %H:%M")
            except:
                pass
            
            action = log["action"]
            username = log["username"]
            success = "âœ…" if log["success"] else "âŒ"
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
            username, password, confirm_password, role = dialog.get_data()
            
            # Validar que las contraseÃ±as coincidan
            if password != confirm_password:
                QMessageBox.warning(self, "Error", "Las contraseÃ±as no coinciden")
                return
            
            if not username or not password:
                QMessageBox.warning(self, "Error", "Usuario y contraseÃ±a son obligatorios")
                return
            
            success, message = self.user_manager.create_user(username, password, role)
            
            if success:
                QMessageBox.information(self, "Ã‰xito", message)
                self.refresh_users()
            else:
                QMessageBox.warning(self, "Error", message)
    
    def change_password(self):
        """Cambiar contraseÃ±a del usuario actual"""
        current_username = self.user_manager.current_user.get("username")
        
        old_password, ok = QInputDialog.getText(
            self, "Cambiar ContraseÃ±a", 
            "ContraseÃ±a actual:", 
            QLineEdit.EchoMode.Password
        )
        if not ok:
            return
        
        new_password, ok = QInputDialog.getText(
            self, "Cambiar ContraseÃ±a", 
            "Nueva contraseÃ±a:", 
            QLineEdit.EchoMode.Password
        )
        if not ok:
            return
        
        confirm_password, ok = QInputDialog.getText(
            self, "Cambiar ContraseÃ±a", 
            "Confirmar nueva contraseÃ±a:", 
            QLineEdit.EchoMode.Password
        )
        if not ok:
            return
        
        if new_password != confirm_password:
            QMessageBox.warning(self, "Error", "Las contraseÃ±as no coinciden")
            return
        
        success, message = self.user_manager.change_password(
            current_username, old_password, new_password
        )
        
        if success:
            QMessageBox.information(self, "Ã‰xito", message)
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
            f"Â¿Desactivar usuario '{username}'?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            success, message = self.user_manager.deactivate_user(username)
            
            if success:
                QMessageBox.information(self, "Ã‰xito", message)
                self.refresh_users()
            else:
                QMessageBox.warning(self, "Error", message)


class CreateUserDialog(QDialog):
    """DiÃ¡logo para crear usuario"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Crear Usuario")
        self.setModal(True)
        self.init_ui()
    
    def init_ui(self):
        layout = QFormLayout(self)
        
        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Nombre de usuario")
        layout.addRow("Usuario:", self.username_input)
        
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("ContraseÃ±a")
        layout.addRow("ContraseÃ±a:", self.password_input)
        
        self.confirm_password_input = QLineEdit()
        self.confirm_password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_password_input.setPlaceholderText("Confirmar contraseÃ±a")
        layout.addRow("Confirmar:", self.confirm_password_input)
        
        self.role_combo = QComboBox()
        self.role_combo.addItems(["admin", "viewer"])
        layout.addRow("Rol:", self.role_combo)
        
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
            self.role_combo.currentText()
        )


class LoginDialog(QDialog):
    """Dialogo de login multi-usuario."""

    def __init__(self, user_manager, parent=None):
        super().__init__(parent)
        self.user_manager = user_manager
        self.setWindowTitle("Iniciar Sesion - Driver Manager")
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

        title = QLabel("Iniciar Sesion")
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
        self.password_input.setPlaceholderText("Contrasena")
        self.password_input.returnPressed.connect(self.login)
        self.password_input.textChanged.connect(self._clear_error)
        form_layout.addRow("Contrasena:", self.password_input)

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

        self.login_btn = QPushButton("Iniciar Sesion")
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
            self._set_error("Ingresa usuario y contrasena")
            return

        success, message = self.user_manager.authenticate(username, password)
        if success:
            self.accept()
            return

        blocked = "cuenta bloqueada" in str(message).lower()
        self._set_error(message, blocked=blocked)

