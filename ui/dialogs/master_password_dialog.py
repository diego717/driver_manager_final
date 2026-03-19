"""
Master password dialog.
"""

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import (
    QCheckBox,
    QDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
)

from core.password_policy import PasswordPolicy
from ui.theme_manager import resolve_theme_manager


class MasterPasswordDialog(QDialog):
    """Dialog used to unlock or create the master password."""

    def __init__(self, parent=None, is_first_time=False, allow_remember_option=False):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.is_first_time = is_first_time
        self.allow_remember_option = allow_remember_option
        self.password = None
        self.remember_password = None
        self.init_ui()

    def init_ui(self):
        self.setWindowTitle("Contrasena Maestra - SiteOps")
        self.setModal(True)
        self.setFixedSize(470, 380)
        self.setStyleSheet(self.theme_manager.generate_stylesheet())

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 22, 24, 24)
        layout.setSpacing(12)

        title_text = (
            "Configurar contrasena maestra" if self.is_first_time else "Contrasena maestra"
        )
        title = QLabel(title_text)
        title.setFont(QFont("Segoe UI Variable Text", 16, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setProperty("class", "heroTitle")
        layout.addWidget(title)

        if self.is_first_time:
            desc_text = (
                "SiteOps cifra la configuracion sensible con una contrasena maestra.\n\n"
                "Si la olvidas, puedes perder acceso a la configuracion cifrada."
            )
        else:
            desc_text = "Ingresa la contrasena maestra para desbloquear la configuracion cifrada."

        desc = QLabel(desc_text)
        desc.setAlignment(Qt.AlignmentFlag.AlignCenter)
        desc.setWordWrap(True)
        desc.setProperty("class", "info")
        layout.addWidget(desc)

        password_label = QLabel("Contrasena maestra")
        password_label.setFont(QFont("Segoe UI Variable Text", 11, QFont.Weight.Bold))
        layout.addWidget(password_label)

        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_input.setPlaceholderText(
            f"Minimo {PasswordPolicy.MIN_LENGTH} caracteres con complejidad"
        )
        self.password_input.returnPressed.connect(self.accept_password)
        layout.addWidget(self.password_input)

        if self.is_first_time:
            confirm_label = QLabel("Confirmar contrasena")
            confirm_label.setFont(QFont("Segoe UI Variable Text", 11, QFont.Weight.Bold))
            layout.addWidget(confirm_label)

            self.confirm_input = QLineEdit()
            self.confirm_input.setEchoMode(QLineEdit.EchoMode.Password)
            self.confirm_input.setPlaceholderText("Repite la contrasena")
            self.confirm_input.returnPressed.connect(self.accept_password)
            layout.addWidget(self.confirm_input)

        self.show_password_cb = QCheckBox("Mostrar contrasena")
        self.show_password_cb.toggled.connect(self.toggle_password_visibility)
        layout.addWidget(self.show_password_cb)

        if self.allow_remember_option:
            self.remember_password_cb = QCheckBox(
                "Recordar en este equipo (almacenamiento local seguro)"
            )
            self.remember_password_cb.setChecked(False)
            layout.addWidget(self.remember_password_cb)

        layout.addStretch()

        buttons_layout = QHBoxLayout()
        if not self.is_first_time:
            cancel_btn = QPushButton("Cancelar")
            cancel_btn.clicked.connect(self.reject)
            buttons_layout.addWidget(cancel_btn)

        accept_text = "Crear contrasena" if self.is_first_time else "Desbloquear"
        accept_btn = QPushButton(accept_text)
        accept_btn.setProperty("class", "primary")
        accept_btn.clicked.connect(self.accept_password)
        buttons_layout.addWidget(accept_btn)
        layout.addLayout(buttons_layout)

        self.password_input.setFocus()

    def toggle_password_visibility(self, checked):
        mode = QLineEdit.EchoMode.Normal if checked else QLineEdit.EchoMode.Password
        self.password_input.setEchoMode(mode)
        if hasattr(self, "confirm_input"):
            self.confirm_input.setEchoMode(mode)

    def accept_password(self):
        password = self.password_input.text()
        if not password:
            QMessageBox.warning(self, "Error", "Ingresa la contrasena maestra.")
            return

        if self.is_first_time:
            is_valid, message = PasswordPolicy.validate(password)
            if not is_valid:
                QMessageBox.warning(self, "Contrasena debil", message)
                return

            confirm = self.confirm_input.text()
            if password != confirm:
                QMessageBox.warning(self, "Error", "Las contrasenas no coinciden.")
                return

        self.password = password
        if hasattr(self, "remember_password_cb"):
            self.remember_password = self.remember_password_cb.isChecked()
        self.accept()

    def get_password(self):
        return self.password

    def get_remember_password(self):
        return self.remember_password


def show_master_password_dialog(
    parent=None,
    is_first_time=False,
    allow_remember_option=False,
    return_metadata=False,
):
    """Show master password dialog."""
    dialog = MasterPasswordDialog(
        parent,
        is_first_time,
        allow_remember_option=allow_remember_option,
    )

    if dialog.exec() == QDialog.DialogCode.Accepted:
        if return_metadata:
            return dialog.get_password(), dialog.get_remember_password()
        return dialog.get_password()

    if return_metadata:
        return None, None
    return None
