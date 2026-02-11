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
        
        # Título
        title = QLabel("👥 Gestión de Usuarios Multi-Admin")
        title.setFont(QFont("Arial", 16, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)
        
        # Información del usuario actual
        current_user = self.user_manager.current_user
        if current_user:
            info = QLabel(f"🔓 Conectado como: {current_user.get('username')} ({current_user.get('role')})")
            info.setStyleSheet("color: green; font-weight: bold; padding: 10px;")
            layout.addWidget(info)
        
        # Botones de acción
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
        
        # Tabla de usuarios
        users_label = QLabel("👤 Usuarios Registrados:")
        users_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(users_label)
        
        self.users_table = QTableWidget()
        self.users_table.setColumnCount(6)
        self.users_table.setHorizontalHeaderLabels([
            "Usuario", "Rol", "Estado", "Último Login", "Creado", "Creado Por"
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
        
        # Logs de acceso
        logs_label = QLabel("📋 Logs de Acceso Recientes:")
        logs_label.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        layout.addWidget(logs_label)
        
        self.logs_text = QTextEdit()
        self.logs_text.setMaximumHeight(200)
        self.logs_text.setReadOnly(True)
        self.logs_text.setStyleSheet("background-color: #F5F5F5; font-family: monospace;")
        layout.addWidget(self.logs_text)
        
        # Botones del diálogo
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
            status = "✅ Activo" if user["active"] else "❌ Inactivo"
            status_item = QTableWidgetItem(status)
            if not user["active"]:
                status_item.setBackground(Qt.GlobalColor.lightGray)
            self.users_table.setItem(row, 2, status_item)
            
            # Último login
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
        for log in reversed(logs[-20:]):  # Últimos 20
            timestamp = log["timestamp"]
            try:
                dt = datetime.fromisoformat(timestamp)
                timestamp = dt.strftime("%d/%m %H:%M")
            except:
                pass
            
            action = log["action"]
            username = log["username"]
            success = "✅" if log["success"] else "❌"
            computer = log.get("system_info", {}).get("computer_name", "Unknown")
            
            log_text += f"[{timestamp}] {success} {action} - {username} @ {computer}\n"
        
        self.logs_text.setText(log_text)
    
    def create_user(self):
        """Crear nuevo usuario"""
        dialog = CreateUserDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            username, password, confirm_password, role = dialog.get_data()
            
            # Validar que las contraseñas coincidan
            if password != confirm_password:
                QMessageBox.warning(self, "Error", "Las contraseñas no coinciden")
                return
            
            if not username or not password:
                QMessageBox.warning(self, "Error", "Usuario y contraseña son obligatorios")
                return
            
            success, message = self.user_manager.create_user(username, password, role)
            
            if success:
                QMessageBox.information(self, "Éxito", message)
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
        self.init_ui()
    
    def init_ui(self):
        layout = QFormLayout(self)
        
        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Nombre de usuario")
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
    """Diálogo de login multi-usuario"""
    
    def __init__(self, user_manager, parent=None):
        super().__init__(parent)
        self.user_manager = user_manager
        self.setWindowTitle("Iniciar Sesión - Driver Manager")
        self.setModal(True)
        self.setFixedSize(400, 200)
        
        # Aplicar tema si está disponible
        if parent and hasattr(parent, 'theme_manager'):
            try:
                stylesheet = parent.theme_manager.generate_stylesheet()
                self.setStyleSheet(stylesheet)
            except:
                pass
        
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        
        # Título
        title = QLabel("🔐 Iniciar Sesión")
        title.setFont(QFont("Arial", 16, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)
        
        # Formulario
        form_layout = QFormLayout()
        
        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Nombre de usuario")
        form_layout.addRow("Usuario:", self.username_input)
        
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("Contraseña")
        self.password_input.returnPressed.connect(self.login)
        form_layout.addRow("Contraseña:", self.password_input)
        
        layout.addLayout(form_layout)
        
        # Botones
        buttons_layout = QHBoxLayout()
        
        login_btn = QPushButton("🔓 Iniciar Sesión")
        login_btn.clicked.connect(self.login)
        login_btn.setStyleSheet("""
            QPushButton {
                background-color: #5CB85C;
                color: white;
                padding: 10px 20px;
                border-radius: 4px;
                font-weight: bold;
            }
        """)
        buttons_layout.addWidget(login_btn)
        
        cancel_btn = QPushButton("Cancelar")
        cancel_btn.clicked.connect(self.reject)
        buttons_layout.addWidget(cancel_btn)
        
        layout.addLayout(buttons_layout)
        
        # Focus en username
        self.username_input.setFocus()
    
    def login(self):
        """Intentar login"""
        username = self.username_input.text()
        password = self.password_input.text()
        
        if not username or not password:
            QMessageBox.warning(self, "Error", "Ingresa usuario y contraseña")
            return
        
        success, message = self.user_manager.authenticate(username, password)
        
        if success:
            self.accept()
        else:
            QMessageBox.warning(self, "Error de Autenticación", message)
            self.password_input.clear()
            self.password_input.setFocus()