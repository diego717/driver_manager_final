"""
Diálogo de Contraseña Maestra para Seguridad
"""

from PyQt6.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel, 
                             QLineEdit, QPushButton, QMessageBox, QCheckBox)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont, QPixmap, QIcon
import sys


class MasterPasswordDialog(QDialog):
    """Diálogo para contraseña maestra de seguridad"""
    
    def __init__(self, parent=None, is_first_time=False):
        super().__init__(parent)
        self.is_first_time = is_first_time
        self.password = None
        self.init_ui()
    
    def init_ui(self):
        self.setWindowTitle("🔐 Contraseña Maestra - Driver Manager")
        self.setModal(True)
        self.setFixedSize(450, 350)
        
        # Aplicar estilo con contraste mejorado
        self.setStyleSheet("""
            QDialog {
                background-color: #FFFFFF;
                color: #2C3E50;
            }
            QLabel {
                color: #2C3E50;
                font-weight: normal;
            }
            QLineEdit {
                background-color: #FFFFFF;
                color: #2C3E50;
                border: 2px solid #BDC3C7;
                border-radius: 6px;
                padding: 10px;
                font-size: 12px;
            }
            QLineEdit:focus {
                border-color: #3498DB;
            }
            QPushButton {
                background-color: #27AE60;
                color: white;
                padding: 10px 20px;
                border-radius: 6px;
                font-weight: bold;
                border: none;
            }
            QPushButton:hover {
                background-color: #229954;
            }
        """)
        
        layout = QVBoxLayout(self)
        
        # Título
        title_text = "🔐 Configurar Contraseña Maestra" if self.is_first_time else "🔐 Contraseña Maestra"
        title = QLabel(title_text)
        title.setFont(QFont("Arial", 16, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("color: #2C3E50; margin: 10px; font-weight: bold;")
        layout.addWidget(title)
        
        # Descripción con contraste mejorado
        if self.is_first_time:
            desc_text = ("🛡️ Para mayor seguridad, Driver Manager cifrará todas las credenciales\n"
                        "y datos sensibles con una contraseña maestra.\n\n"
                        "⚠️ IMPORTANTE: Si olvidas esta contraseña, perderás acceso\n"
                        "a todas las configuraciones guardadas.")
        else:
            desc_text = ("🔑 Ingresa tu contraseña maestra para acceder\n"
                        "a las configuraciones cifradas de Driver Manager.")
        
        desc = QLabel(desc_text)
        desc.setAlignment(Qt.AlignmentFlag.AlignCenter)
        desc.setStyleSheet("""
            QLabel {
                background-color: #F8F9FA;
                color: #2C3E50;
                padding: 15px;
                border-radius: 8px;
                border: 2px solid #BDC3C7;
                font-size: 11px;
                font-weight: normal;
            }
        """)
        layout.addWidget(desc)
        
        layout.addSpacing(20)
        
        # Campo de contraseña
        password_label = QLabel("Contraseña Maestra:")
        password_label.setFont(QFont("Arial", 11, QFont.Weight.Bold))
        password_label.setStyleSheet("color: #2C3E50; font-weight: bold;")
        layout.addWidget(password_label)
        
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("Mínimo 8 caracteres...")
        self.password_input.returnPressed.connect(self.accept_password)
        layout.addWidget(self.password_input)
        
        # Confirmar contraseña (solo primera vez)
        if self.is_first_time:
            confirm_label = QLabel("Confirmar Contraseña:")
            confirm_label.setFont(QFont("Arial", 11, QFont.Weight.Bold))
            confirm_label.setStyleSheet("color: #2C3E50; font-weight: bold;")
            layout.addWidget(confirm_label)
            
            self.confirm_input = QLineEdit()
            self.confirm_input.setEchoMode(QLineEdit.EchoMode.Password)
            self.confirm_input.setPlaceholderText("Repite la contraseña...")
            self.confirm_input.returnPressed.connect(self.accept_password)
            layout.addWidget(self.confirm_input)
        
        # Mostrar contraseña
        self.show_password_cb = QCheckBox("👁️ Mostrar contraseña")
        self.show_password_cb.setStyleSheet("color: #2C3E50; font-weight: normal;")
        self.show_password_cb.toggled.connect(self.toggle_password_visibility)
        layout.addWidget(self.show_password_cb)
        
        layout.addSpacing(20)
        
        # Botones
        buttons_layout = QHBoxLayout()
        
        if not self.is_first_time:
            cancel_btn = QPushButton("Cancelar")
            cancel_btn.clicked.connect(self.reject)
            cancel_btn.setStyleSheet("""
                QPushButton {
                    background-color: #95A5A6;
                    color: white;
                    padding: 10px 20px;
                    border-radius: 6px;
                    font-weight: bold;
                }
                QPushButton:hover {
                    background-color: #7F8C8D;
                }
            """)
            buttons_layout.addWidget(cancel_btn)
        
        accept_text = "🔐 Crear Contraseña" if self.is_first_time else "🔓 Desbloquear"
        accept_btn = QPushButton(accept_text)
        accept_btn.clicked.connect(self.accept_password)
        buttons_layout.addWidget(accept_btn)
        
        layout.addLayout(buttons_layout)
        
        # Focus en contraseña
        self.password_input.setFocus()
    
    def toggle_password_visibility(self, checked):
        """Alternar visibilidad de contraseña"""
        mode = QLineEdit.EchoMode.Normal if checked else QLineEdit.EchoMode.Password
        self.password_input.setEchoMode(mode)
        if hasattr(self, 'confirm_input'):
            self.confirm_input.setEchoMode(mode)
    
    def accept_password(self):
        """Validar y aceptar contraseña"""
        password = self.password_input.text()
        
        # Validar longitud mínima
        if len(password) < 8:
            QMessageBox.warning(
                self, 
                "Contraseña Débil", 
                "La contraseña debe tener al menos 8 caracteres."
            )
            return
        
        # Validar confirmación (primera vez)
        if self.is_first_time:
            confirm = self.confirm_input.text()
            if password != confirm:
                QMessageBox.warning(
                    self, 
                    "Error", 
                    "Las contraseñas no coinciden."
                )
                return
        
        self.password = password
        self.accept()
    
    def get_password(self):
        """Obtener contraseña ingresada"""
        return self.password


def show_master_password_dialog(parent=None, is_first_time=False):
    """Mostrar diálogo de contraseña maestra"""
    dialog = MasterPasswordDialog(parent, is_first_time)
    
    # Aplicar tema si el parent tiene theme_manager
    if parent and hasattr(parent, 'theme_manager'):
        try:
            stylesheet = parent.theme_manager.generate_stylesheet()
            dialog.setStyleSheet(stylesheet)
        except:
            pass
    
    if dialog.exec() == QDialog.DialogCode.Accepted:
        return dialog.get_password()
    return None