"""
Initial user setup wizard for the first super admin account.
"""

import re

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QDialog,
    QLabel,
    QLineEdit,
    QMessageBox,
    QProgressBar,
    QVBoxLayout,
    QWizard,
    QWizardPage,
)

from core.password_policy import PasswordPolicy
from ui.theme_manager import resolve_theme_manager


def _set_feedback_style(label, style_class, text):
    """Apply a semantic feedback class to an inline label."""
    label.setText(text)
    label.setProperty("class", style_class)
    label.style().unpolish(label)
    label.style().polish(label)


class WelcomePage(QWizardPage):
    """Welcome page for the setup wizard."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.setTitle("Bienvenido a SiteOps")
        self.setSubTitle("Prepara la cuenta principal y deja la base del sistema lista para operar.")

        layout = QVBoxLayout()
        layout.setSpacing(12)

        eyebrow = QLabel("PRIMER INICIO")
        eyebrow.setProperty("class", "chip")
        layout.addWidget(eyebrow, alignment=Qt.AlignmentFlag.AlignLeft)

        welcome_text = QLabel(
            "<div style='line-height:1.6;'>"
            "<div style='font-size:24px;font-weight:700;margin-bottom:10px;'>Activa la consola inicial</div>"
            "<div>Esta es la primera vez que ejecutas SiteOps en Windows.</div>"
            "<div style='margin-top:10px;'>Este asistente te va a guiar en tres pasos:</div>"
            "<ul>"
            "<li>Crear la cuenta de super administracion</li>"
            "<li>Confirmar los criterios base de seguridad</li>"
            "<li>Dejar preparado el entorno para seguir configurando</li>"
            "</ul>"
            "<div><b>Tiempo estimado:</b> 2-3 minutos</div>"
            "</div>"
        )
        welcome_text.setWordWrap(True)
        layout.addWidget(welcome_text)

        layout.addStretch()

        info_box = QLabel(
            "La cuenta que crees tendra privilegios completos para gestionar usuarios, "
            "drivers y configuraciones sensibles."
        )
        info_box.setWordWrap(True)
        info_box.setProperty("class", "info")
        layout.addWidget(info_box)

        self.setLayout(layout)


class AdminAccountPage(QWizardPage):
    """Page to create the first super admin account."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.setTitle("Crear cuenta de super administrador")
        self.setSubTitle("Esta sera la cuenta principal con todos los privilegios.")

        layout = QVBoxLayout()
        layout.setSpacing(10)

        intro = QLabel(
            "Usa un nombre claro y una contrasena fuerte. El sistema valida ambos "
            "campos en tiempo real para ayudarte a cerrar la configuracion sin errores."
        )
        intro.setWordWrap(True)
        intro.setProperty("class", "sectionMeta")
        layout.addWidget(intro)

        user_label = QLabel("Nombre de usuario")
        user_label.setFont(self.theme_manager.create_font("display", 10, 700))
        layout.addWidget(user_label)

        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Ej: admin, diego, operaciones")
        self.username_input.textChanged.connect(self._validate_fields)
        self.registerField("username*", self.username_input)
        layout.addWidget(self.username_input)

        self.username_hint = QLabel("Minimo 3 caracteres, solo letras, numeros, guiones y guion bajo.")
        self.username_hint.setWordWrap(True)
        self.username_hint.setProperty("class", "sectionMeta")
        layout.addWidget(self.username_hint)

        layout.addSpacing(8)

        pass_label = QLabel("Contrasena")
        pass_label.setFont(self.theme_manager.create_font("display", 10, 700))
        layout.addWidget(pass_label)

        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText(
            f"Minimo {PasswordPolicy.MIN_LENGTH} caracteres"
        )
        self.password_input.textChanged.connect(self._validate_fields)
        self.registerField("password*", self.password_input)
        layout.addWidget(self.password_input)

        self.password_strength = QProgressBar()
        self.password_strength.setMaximum(4)
        self.password_strength.setTextVisible(False)
        self.password_strength.setMaximumHeight(10)
        layout.addWidget(self.password_strength)

        self.password_hint = QLabel(PasswordPolicy.describe_requirements())
        self.password_hint.setWordWrap(True)
        self.password_hint.setProperty("class", "sectionMeta")
        layout.addWidget(self.password_hint)

        layout.addSpacing(8)

        confirm_label = QLabel("Confirmar contrasena")
        confirm_label.setFont(self.theme_manager.create_font("display", 10, 700))
        layout.addWidget(confirm_label)

        self.confirm_input = QLineEdit()
        self.confirm_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_input.setPlaceholderText("Repite la contrasena")
        self.confirm_input.textChanged.connect(self._validate_fields)
        self.registerField("confirm*", self.confirm_input)
        layout.addWidget(self.confirm_input)

        self.confirm_hint = QLabel("")
        self.confirm_hint.setWordWrap(True)
        self.confirm_hint.setProperty("class", "sectionMeta")
        layout.addWidget(self.confirm_hint)

        layout.addStretch()

        warning = QLabel(
            "Guarda esta contrasena en un lugar seguro. Si la pierdes, no podras "
            "recuperar facilmente el acceso administrativo."
        )
        warning.setWordWrap(True)
        warning.setProperty("class", "warning")
        layout.addWidget(warning)

        self.setLayout(layout)

    def _set_strength_chunk(self, color):
        self.password_strength.setStyleSheet(
            f"QProgressBar::chunk {{ background-color: {color}; border-radius: 5px; }}"
        )

    def _validate_fields(self):
        """Validate account fields in real time."""
        username = self.username_input.text()
        password = self.password_input.text()
        confirm = self.confirm_input.text()

        if username:
            if len(username) < 3:
                _set_feedback_style(
                    self.username_hint,
                    "status-error",
                    "Muy corto. Debe tener al menos 3 caracteres.",
                )
            elif not re.match(r"^[a-zA-Z0-9_-]+$", username):
                _set_feedback_style(
                    self.username_hint,
                    "status-error",
                    "Solo se permiten letras, numeros, guiones y guion bajo.",
                )
            else:
                _set_feedback_style(
                    self.username_hint,
                    "status-ok",
                    "Nombre de usuario valido.",
                )
        else:
            _set_feedback_style(
                self.username_hint,
                "sectionMeta",
                "Minimo 3 caracteres, solo letras, numeros, guiones y guion bajo.",
            )

        if password:
            analysis = PasswordPolicy.analyze(password, username=username)
            strength = self._calculate_password_strength(password)
            self.password_strength.setValue(strength)

            if analysis["is_valid"]:
                self._set_strength_chunk("#398f5f")
                _set_feedback_style(self.password_hint, "status-ok", "Contrasena valida.")
            else:
                first_error = (
                    analysis["errors"][0]
                    if analysis["errors"]
                    else PasswordPolicy.describe_requirements()
                )
                self._set_strength_chunk("#ba5142")
                _set_feedback_style(self.password_hint, "status-error", first_error)
        else:
            self.password_strength.setValue(0)
            self._set_strength_chunk("#9fb4ca")
            _set_feedback_style(
                self.password_hint,
                "sectionMeta",
                PasswordPolicy.describe_requirements(),
            )

        if confirm:
            if password == confirm:
                _set_feedback_style(
                    self.confirm_hint, "status-ok", "Las contrasenas coinciden."
                )
            else:
                _set_feedback_style(
                    self.confirm_hint, "status-error", "Las contrasenas no coinciden."
                )
        else:
            _set_feedback_style(
                self.confirm_hint,
                "sectionMeta",
                "Confirma la contrasena para continuar.",
            )

    def _calculate_password_strength(self, password):
        """Map the shared policy score to the wizard progress bar."""
        _, _, score = PasswordPolicy.validate_with_score(
            password,
            username=self.username_input.text(),
        )
        if score >= 85:
            return 4
        if score >= 70:
            return 3
        if score >= 50:
            return 2
        if score >= 25:
            return 1
        return 0

    def validatePage(self):
        """Validate before advancing to the next step."""
        username = self.username_input.text()
        password = self.password_input.text()
        confirm = self.confirm_input.text()

        if len(username) < 3:
            QMessageBox.warning(
                self, "Error", "El nombre de usuario debe tener al menos 3 caracteres."
            )
            return False

        if not re.match(r"^[a-zA-Z0-9_-]+$", username):
            QMessageBox.warning(
                self,
                "Error",
                "El nombre de usuario solo puede contener letras, numeros, guiones y guion bajo.",
            )
            return False

        if password != confirm:
            QMessageBox.warning(self, "Error", "Las contrasenas no coinciden.")
            return False

        is_valid, message = PasswordPolicy.validate(password, username=username)
        if not is_valid:
            QMessageBox.warning(self, "Contrasena debil", message)
            return False

        return True


class SecurityPage(QWizardPage):
    """Security overview page."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setTitle("Configuracion de seguridad")
        self.setSubTitle("Revisa el esquema base con el que se protege la informacion sensible.")

        layout = QVBoxLayout()
        layout.setSpacing(12)

        intro = QLabel(
            "SiteOps protege credenciales y secretos con cifrado robusto. "
            "Este resumen deja visibles las decisiones base antes de terminar la configuracion."
        )
        intro.setWordWrap(True)
        intro.setProperty("class", "sectionMeta")
        layout.addWidget(intro)

        encryption_info = QLabel(
            "<b>Proteccion de datos</b><br>"
            "AES-256-CBC para cifrado operativo<br>"
            "PBKDF2-HMAC-SHA256 para derivacion de claves<br>"
            "HMAC-SHA256 para integridad<br>"
            "Bcrypt (12 rounds) para passwords"
        )
        encryption_info.setWordWrap(True)
        encryption_info.setProperty("class", "info")
        layout.addWidget(encryption_info)

        options_title = QLabel("Capas siguientes")
        options_title.setProperty("class", "sectionTitle")
        layout.addWidget(options_title)

        options = QLabel(
            "2FA para cuentas administrativas\n"
            "Alertas de inicio de sesion\n"
            "Sesiones con expiracion controlada\n"
            "Rotacion automatica de credenciales"
        )
        options.setWordWrap(True)
        options.setProperty("class", "sectionMeta")
        layout.addWidget(options)

        layout.addStretch()
        self.setLayout(layout)


class CompletePage(QWizardPage):
    """Final success page."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setTitle("Configuracion completa")
        self.setSubTitle("La consola ya esta lista para pasar a la configuracion operativa.")

        layout = QVBoxLayout()
        layout.setSpacing(12)

        eyebrow = QLabel("READY TO OPERATE")
        eyebrow.setProperty("class", "chip")
        layout.addWidget(eyebrow, alignment=Qt.AlignmentFlag.AlignLeft)

        success_text = QLabel(
            "<div style='font-size:24px;font-weight:700;margin-bottom:8px;'>Todo listo</div>"
            "<div>La cuenta de super administracion fue creada correctamente.</div>"
        )
        success_text.setWordWrap(True)
        layout.addWidget(success_text)

        next_steps = QLabel(
            "<b>Proximos pasos</b><br><br>"
            "1. Configura Cloudflare R2 desde Administracion.<br>"
            "2. Crea usuarios adicionales segun tu operativa.<br>"
            "3. Empieza a trabajar con drivers, activos e incidencias."
        )
        next_steps.setWordWrap(True)
        next_steps.setProperty("class", "success")
        layout.addWidget(next_steps)

        layout.addStretch()

        tip = QLabel(
            "Consejo: guarda la contrasena administrativa en un gestor seguro como "
            "Bitwarden, 1Password o KeePass."
        )
        tip.setWordWrap(True)
        tip.setProperty("class", "warning")
        layout.addWidget(tip)

        self.setLayout(layout)


class UserSetupWizard(QWizard):
    """Initial setup wizard shown when no admin user exists."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.setObjectName("userSetupWizard")
        self.setWindowTitle("Configuracion inicial - SiteOps")
        self.setWizardStyle(QWizard.WizardStyle.ModernStyle)
        self.setFixedSize(640, 560)
        self.setStyleSheet(
            self.theme_manager.generate_stylesheet()
            + """
            QWizard#userSetupWizard {
                background-color: transparent;
            }
            QWizard#userSetupWizard QWizardPage {
                background-color: transparent;
            }
            QWizard#userSetupWizard QLabel[title="true"] {
                font-size: 22px;
                font-weight: 700;
            }
            """
        )

        self.welcome_page = WelcomePage(self)
        self.account_page = AdminAccountPage(self)
        self.security_page = SecurityPage(self)
        self.complete_page = CompletePage(self)

        self.addPage(self.welcome_page)
        self.addPage(self.account_page)
        self.addPage(self.security_page)
        self.addPage(self.complete_page)

        self.setButtonText(QWizard.WizardButton.NextButton, "Siguiente >")
        self.setButtonText(QWizard.WizardButton.BackButton, "< Atras")
        self.setButtonText(QWizard.WizardButton.FinishButton, "Finalizar")
        self.setButtonText(QWizard.WizardButton.CancelButton, "Cancelar")

    def get_user_data(self):
        """Return the credentials captured by the wizard."""
        return {
            "username": self.field("username"),
            "password": self.field("password"),
        }


def show_user_setup_wizard(parent=None):
    """Show the initial setup wizard and return the created user data."""
    wizard = UserSetupWizard(parent)

    if wizard.exec() == QDialog.DialogCode.Accepted:
        return wizard.get_user_data()

    return None


if __name__ == "__main__":
    import sys
    from PyQt6.QtWidgets import QApplication

    app = QApplication(sys.argv)

    user_data = show_user_setup_wizard()

    if user_data:
        print(f"OK: Usuario creado: {user_data['username']}")
    else:
        print("ERROR: Configuracion cancelada")

    sys.exit()
