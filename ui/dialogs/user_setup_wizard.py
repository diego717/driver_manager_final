"""
Asistente de Configuración Inicial de Usuario
Guía al usuario en la creación del primer super_admin
"""

from PyQt6.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel, 
                             QLineEdit, QPushButton, QWizard, QWizardPage,
                             QMessageBox, QProgressBar)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont, QPixmap
import re


class WelcomePage(QWizardPage):
    """Página de bienvenida del wizard"""
    
    def __init__(self):
        super().__init__()
        self.setTitle("🎉 Bienvenido a Driver Manager")
        
        layout = QVBoxLayout()
        
        welcome_text = QLabel(
            "<h2>¡Bienvenido!</h2>"
            "<p>Esta es la primera vez que ejecutas Driver Manager.</p>"
            "<p>Este asistente te guiará en la configuración inicial:</p>"
            "<ul>"
            "<li>✅ Crear tu cuenta de super administrador</li>"
            "<li>✅ Configurar la seguridad del sistema</li>"
            "<li>✅ Establecer preferencias iniciales</li>"
            "</ul>"
            "<p><b>Tiempo estimado:</b> 2-3 minutos</p>"
        )
        welcome_text.setWordWrap(True)
        layout.addWidget(welcome_text)
        
        layout.addStretch()
        
        info_box = QLabel(
            "ℹ️ <b>Nota:</b> La cuenta que crees tendrá privilegios completos "
            "para gestionar usuarios, drivers y configuraciones."
        )
        info_box.setWordWrap(True)
        info_box.setStyleSheet("""
            QLabel {
                background-color: #E3F2FD;
                color: #1565C0;
                padding: 15px;
                border-radius: 5px;
                border: 1px solid #90CAF9;
            }
        """)
        layout.addWidget(info_box)
        
        self.setLayout(layout)


class AdminAccountPage(QWizardPage):
    """Página de creación de cuenta de administrador"""
    
    def __init__(self):
        super().__init__()
        self.setTitle("👤 Crear Cuenta de Super Administrador")
        self.setSubTitle("Esta será la cuenta principal con todos los privilegios")
        
        layout = QVBoxLayout()
        
        # Campo de usuario
        user_label = QLabel("Nombre de Usuario:")
        user_label.setFont(QFont("Arial", 10, QFont.Weight.Bold))
        layout.addWidget(user_label)
        
        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Ej: admin, tu_nombre, etc.")
        self.username_input.textChanged.connect(self._validate_fields)
        self.registerField("username*", self.username_input)
        layout.addWidget(self.username_input)
        
        self.username_hint = QLabel("Mínimo 3 caracteres, solo letras, números y guiones")
        self.username_hint.setStyleSheet("color: #666; font-size: 9pt;")
        layout.addWidget(self.username_hint)
        
        layout.addSpacing(20)
        
        # Campo de contraseña
        pass_label = QLabel("Contraseña:")
        pass_label.setFont(QFont("Arial", 10, QFont.Weight.Bold))
        layout.addWidget(pass_label)
        
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText("Mínimo 8 caracteres")
        self.password_input.textChanged.connect(self._validate_fields)
        self.registerField("password*", self.password_input)
        layout.addWidget(self.password_input)
        
        self.password_strength = QProgressBar()
        self.password_strength.setMaximum(4)
        self.password_strength.setTextVisible(False)
        self.password_strength.setMaximumHeight(10)
        layout.addWidget(self.password_strength)
        
        self.password_hint = QLabel("La contraseña debe tener al menos 8 caracteres")
        self.password_hint.setStyleSheet("color: #666; font-size: 9pt;")
        layout.addWidget(self.password_hint)
        
        layout.addSpacing(20)
        
        # Confirmar contraseña
        confirm_label = QLabel("Confirmar Contraseña:")
        confirm_label.setFont(QFont("Arial", 10, QFont.Weight.Bold))
        layout.addWidget(confirm_label)
        
        self.confirm_input = QLineEdit()
        self.confirm_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_input.setPlaceholderText("Repite la contraseña")
        self.confirm_input.textChanged.connect(self._validate_fields)
        self.registerField("confirm*", self.confirm_input)
        layout.addWidget(self.confirm_input)
        
        self.confirm_hint = QLabel("")
        self.confirm_hint.setStyleSheet("color: #666; font-size: 9pt;")
        layout.addWidget(self.confirm_hint)
        
        layout.addStretch()
        
        # Advertencia de seguridad
        warning = QLabel(
            "⚠️ <b>IMPORTANTE:</b> Guarda esta contraseña en un lugar seguro. "
            "Si la pierdes, no podrás recuperar el acceso al sistema."
        )
        warning.setWordWrap(True)
        warning.setStyleSheet("""
            QLabel {
                background-color: #FFF3E0;
                color: #E65100;
                padding: 15px;
                border-radius: 5px;
                border: 1px solid #FFB74D;
            }
        """)
        layout.addWidget(warning)
        
        self.setLayout(layout)
    
    def _validate_fields(self):
        """Validar campos en tiempo real"""
        username = self.username_input.text()
        password = self.password_input.text()
        confirm = self.confirm_input.text()
        
        # Validar usuario
        if username:
            if len(username) < 3:
                self.username_hint.setText("❌ Muy corto (mínimo 3 caracteres)")
                self.username_hint.setStyleSheet("color: #D32F2F; font-size: 9pt;")
            elif not re.match(r'^[a-zA-Z0-9_-]+$', username):
                self.username_hint.setText("❌ Solo letras, números, guiones y guiones bajos")
                self.username_hint.setStyleSheet("color: #D32F2F; font-size: 9pt;")
            else:
                self.username_hint.setText("✅ Nombre de usuario válido")
                self.username_hint.setStyleSheet("color: #388E3C; font-size: 9pt;")
        
        # Validar fortaleza de contraseña
        if password:
            strength = self._calculate_password_strength(password)
            self.password_strength.setValue(strength)
            
            if strength == 0:
                self.password_strength.setStyleSheet("QProgressBar::chunk { background-color: #D32F2F; }")
                self.password_hint.setText("❌ Contraseña muy débil")
                self.password_hint.setStyleSheet("color: #D32F2F; font-size: 9pt;")
            elif strength == 1:
                self.password_strength.setStyleSheet("QProgressBar::chunk { background-color: #F57C00; }")
                self.password_hint.setText("⚠️ Contraseña débil")
                self.password_hint.setStyleSheet("color: #F57C00; font-size: 9pt;")
            elif strength == 2:
                self.password_strength.setStyleSheet("QProgressBar::chunk { background-color: #FBC02D; }")
                self.password_hint.setText("👍 Contraseña aceptable")
                self.password_hint.setStyleSheet("color: #F9A825; font-size: 9pt;")
            elif strength == 3:
                self.password_strength.setStyleSheet("QProgressBar::chunk { background-color: #7CB342; }")
                self.password_hint.setText("💪 Contraseña fuerte")
                self.password_hint.setStyleSheet("color: #558B2F; font-size: 9pt;")
            else:
                self.password_strength.setStyleSheet("QProgressBar::chunk { background-color: #388E3C; }")
                self.password_hint.setText("🔒 Contraseña muy fuerte")
                self.password_hint.setStyleSheet("color: #1B5E20; font-size: 9pt;")
        
        # Validar confirmación
        if confirm:
            if password == confirm:
                self.confirm_hint.setText("✅ Las contraseñas coinciden")
                self.confirm_hint.setStyleSheet("color: #388E3C; font-size: 9pt;")
            else:
                self.confirm_hint.setText("❌ Las contraseñas no coinciden")
                self.confirm_hint.setStyleSheet("color: #D32F2F; font-size: 9pt;")
    
    def _calculate_password_strength(self, password):
        """Calcular fortaleza de contraseña (0-4)"""
        if len(password) < 8:
            return 0
        
        strength = 1
        
        # Longitud
        if len(password) >= 12:
            strength += 1
        
        # Mayúsculas y minúsculas
        if re.search(r'[a-z]', password) and re.search(r'[A-Z]', password):
            strength += 1
        
        # Números
        if re.search(r'\d', password):
            strength += 1
        
        # Caracteres especiales
        if re.search(r'[!@#$%^&*()_+\-=\[\]{};:\'",.<>?/\\|`~]', password):
            strength += 1
        
        return min(strength, 4)
    
    def validatePage(self):
        """Validar antes de avanzar"""
        username = self.username_input.text()
        password = self.password_input.text()
        confirm = self.confirm_input.text()
        
        # Validar usuario
        if len(username) < 3:
            QMessageBox.warning(self, "Error", "El nombre de usuario debe tener al menos 3 caracteres")
            return False
        
        if not re.match(r'^[a-zA-Z0-9_-]+$', username):
            QMessageBox.warning(self, "Error", "El nombre de usuario solo puede contener letras, números, guiones y guiones bajos")
            return False
        
        # Validar contraseña
        if len(password) < 8:
            QMessageBox.warning(self, "Error", "La contraseña debe tener al menos 8 caracteres")
            return False
        
        if password != confirm:
            QMessageBox.warning(self, "Error", "Las contraseñas no coinciden")
            return False
        
        # Advertir si la contraseña es débil
        strength = self._calculate_password_strength(password)
        if strength < 2:
            reply = QMessageBox.question(
                self, 
                "Contraseña Débil",
                "Tu contraseña es débil y podría ser fácil de adivinar.\n\n"
                "¿Deseas continuar de todas formas?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )
            return reply == QMessageBox.StandardButton.Yes
        
        return True


class SecurityPage(QWizardPage):
    """Página de configuración de seguridad"""
    
    def __init__(self):
        super().__init__()
        self.setTitle("🔒 Configuración de Seguridad")
        self.setSubTitle("Ajusta las opciones de seguridad del sistema")
        
        layout = QVBoxLayout()
        
        intro = QLabel(
            "Driver Manager utiliza cifrado AES-256 para proteger tus credenciales. "
            "A continuación, configura las opciones de seguridad adicionales:"
        )
        intro.setWordWrap(True)
        layout.addWidget(intro)
        
        layout.addSpacing(20)
        
        # Información de cifrado
        encryption_info = QLabel(
            "<b>🔐 Cifrado de Datos</b><br>"
            "• Algoritmo: AES-256-CBC<br>"
            "• Derivación de Claves: PBKDF2-HMAC-SHA256<br>"
            "• Integridad: HMAC-SHA256<br>"
            "• Passwords: Bcrypt (12 rounds)"
        )
        encryption_info.setWordWrap(True)
        encryption_info.setStyleSheet("""
            QLabel {
                background-color: #F5F5F5;
                padding: 15px;
                border-radius: 5px;
                border: 1px solid #E0E0E0;
            }
        """)
        layout.addWidget(encryption_info)
        
        layout.addSpacing(20)
        
        # Opciones de seguridad (futuras)
        options_label = QLabel("<b>Opciones Adicionales</b> (próximamente):")
        layout.addWidget(options_label)
        
        options = QLabel(
            "• 🔑 Autenticación de dos factores (2FA)\n"
            "• 📱 Notificaciones de inicio de sesión\n"
            "• 🕐 Sesiones con tiempo de expiración\n"
            "• 🔄 Rotación automática de credenciales"
        )
        options.setStyleSheet("color: #666; padding-left: 20px;")
        layout.addWidget(options)
        
        layout.addStretch()
        
        self.setLayout(layout)


class CompletePage(QWizardPage):
    """Página final del wizard"""
    
    def __init__(self):
        super().__init__()
        self.setTitle("✅ Configuración Completa")
        
        layout = QVBoxLayout()
        
        success_text = QLabel(
            "<h2>🎉 ¡Listo!</h2>"
            "<p>Tu cuenta de super administrador ha sido creada exitosamente.</p>"
        )
        success_text.setWordWrap(True)
        layout.addWidget(success_text)
        
        layout.addSpacing(20)
        
        next_steps = QLabel(
            "<b>Próximos pasos:</b><br><br>"
            "1️⃣ <b>Configurar Cloudflare R2</b><br>"
            "   Ve a la pestaña 'Administración' y configura tus credenciales<br><br>"
            "2️⃣ <b>Crear usuarios adicionales</b><br>"
            "   Usa el botón 'Gestionar Usuarios' para crear más cuentas<br><br>"
            "3️⃣ <b>Comenzar a usar Driver Manager</b><br>"
            "   Descarga e instala drivers para tus impresoras de tarjetas"
        )
        next_steps.setWordWrap(True)
        next_steps.setStyleSheet("""
            QLabel {
                background-color: #E8F5E9;
                color: #1B5E20;
                padding: 20px;
                border-radius: 5px;
                border: 1px solid #A5D6A7;
            }
        """)
        layout.addWidget(next_steps)
        
        layout.addStretch()
        
        tip = QLabel(
            "💡 <b>Consejo:</b> Guarda tu contraseña en un gestor de contraseñas seguro "
            "como Bitwarden, 1Password o KeePass."
        )
        tip.setWordWrap(True)
        tip.setStyleSheet("""
            QLabel {
                background-color: #FFF9C4;
                color: #F57F17;
                padding: 15px;
                border-radius: 5px;
                border: 1px solid #FFF59D;
            }
        """)
        layout.addWidget(tip)
        
        self.setLayout(layout)


class UserSetupWizard(QWizard):
    """Wizard de configuración inicial de usuario"""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Configuración Inicial - Driver Manager")
        self.setWizardStyle(QWizard.WizardStyle.ModernStyle)
        self.setFixedSize(600, 500)
        
        # Páginas
        self.welcome_page = WelcomePage()
        self.account_page = AdminAccountPage()
        self.security_page = SecurityPage()
        self.complete_page = CompletePage()
        
        self.addPage(self.welcome_page)
        self.addPage(self.account_page)
        self.addPage(self.security_page)
        self.addPage(self.complete_page)
        
        # Botones personalizados
        self.setButtonText(QWizard.WizardButton.NextButton, "Siguiente →")
        self.setButtonText(QWizard.WizardButton.BackButton, "← Atrás")
        self.setButtonText(QWizard.WizardButton.FinishButton, "Finalizar")
        self.setButtonText(QWizard.WizardButton.CancelButton, "Cancelar")
        
        # Estilo
        self.setStyleSheet("""
            QWizard {
                background-color: #FFFFFF;
            }
            QWizardPage {
                background-color: #FFFFFF;
            }
            QPushButton {
                padding: 8px 20px;
                border-radius: 4px;
                font-weight: bold;
            }
            QPushButton:disabled {
                background-color: #E0E0E0;
                color: #9E9E9E;
            }
        """)
    
    def get_user_data(self):
        """Obtener datos del usuario creado"""
        return {
            'username': self.field('username'),
            'password': self.field('password')
        }


def show_user_setup_wizard(parent=None):
    """Mostrar el wizard de configuración inicial"""
    wizard = UserSetupWizard(parent)
    
    if wizard.exec() == QDialog.DialogCode.Accepted:
        return wizard.get_user_data()
    
    return None


# Testing
if __name__ == "__main__":
    import sys
    from PyQt6.QtWidgets import QApplication
    
    app = QApplication(sys.argv)
    
    user_data = show_user_setup_wizard()
    
    if user_data:
        print(f"✅ Usuario creado: {user_data['username']}")
    else:
        print("❌ Configuración cancelada")
    
    sys.exit()
