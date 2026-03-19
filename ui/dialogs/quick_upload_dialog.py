"""
Quick dialog to complete driver metadata before uploading.
"""

import re
from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
)

from core.logger import get_logger
from ui.theme_manager import resolve_theme_manager

logger = get_logger()


class QuickUploadDialog(QDialog):
    """Driver upload dialog with live validation."""

    def __init__(self, file_path, parent=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.colors = self.theme_manager.get_theme_colors()
        self.file_path = Path(file_path)
        self.is_valid = False

        self.setWindowTitle("Subir driver")
        self.setModal(True)
        self.setMinimumWidth(540)
        self.setStyleSheet(self.theme_manager.generate_stylesheet())

        self.init_ui()
        self.auto_detect_info()

    def init_ui(self):
        """Build the dialog UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 22, 24, 24)
        layout.setSpacing(12)

        header_layout = QVBoxLayout()
        eyebrow = QLabel("DESKTOP / CARGA")
        eyebrow.setProperty("class", "chip")
        eyebrow.setAlignment(Qt.AlignmentFlag.AlignLeft)
        header_layout.addWidget(eyebrow, alignment=Qt.AlignmentFlag.AlignLeft)

        title = QLabel("Subir driver")
        title.setFont(QFont("Segoe UI Variable Text", 16, QFont.Weight.Bold))
        title.setProperty("class", "heroTitle")
        header_layout.addWidget(title)

        subtitle = QLabel("Completa los metadatos antes de enviar el archivo a la nube.")
        subtitle.setProperty("class", "sectionMeta")
        subtitle.setWordWrap(True)
        header_layout.addWidget(subtitle)
        layout.addLayout(header_layout)

        file_group = QGroupBox("Archivo seleccionado")
        file_layout = QVBoxLayout(file_group)

        self.filename_label = QLabel(self.file_path.name)
        self.filename_label.setFont(QFont("Segoe UI Variable Text", 11, QFont.Weight.Bold))
        file_layout.addWidget(self.filename_label)

        file_info_layout = QHBoxLayout()
        size_mb = self.file_path.stat().st_size / (1024 * 1024)
        size_label = QLabel(f"Tamano: {size_mb:.2f} MB")
        size_label.setProperty("class", "subtle")
        file_info_layout.addWidget(size_label)

        extension = self.file_path.suffix.upper()
        type_label = QLabel(f"Tipo: {extension}")
        type_label.setProperty("class", "subtle")
        file_info_layout.addWidget(type_label)
        file_info_layout.addStretch()
        file_layout.addLayout(file_info_layout)
        layout.addWidget(file_group)

        form_group = QGroupBox("Informacion del driver")
        form_layout = QFormLayout(form_group)
        form_layout.setHorizontalSpacing(14)
        form_layout.setVerticalSpacing(10)

        self.brand_combo = QComboBox()
        self.brand_combo.addItems(
            ["Magicard", "Zebra", "Entrust Sigma", "Evolis", "Fargo", "Datacard"]
        )
        self.brand_combo.currentTextChanged.connect(self.validate_form)
        form_layout.addRow("Marca *", self.brand_combo)

        version_layout = QHBoxLayout()
        version_layout.setSpacing(8)
        self.version_input = QLineEdit()
        self.version_input.setPlaceholderText("Ej: 1.2.3, 2.0.1, 5.4")
        self.version_input.textChanged.connect(self.on_version_changed)
        version_layout.addWidget(self.version_input, 1)

        self.version_status = QLabel("")
        self.version_status.setMinimumWidth(120)
        self.version_status.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )
        version_layout.addWidget(self.version_status)
        form_layout.addRow("Version *", version_layout)

        self.description_input = QTextEdit()
        self.description_input.setPlaceholderText(
            "Descripcion opcional del driver, compatibilidad o notas importantes."
        )
        self.description_input.setMaximumHeight(88)
        self.description_input.textChanged.connect(self.on_description_changed)
        form_layout.addRow("Descripcion", self.description_input)

        self.char_counter = QLabel("0 / 500 caracteres")
        self.char_counter.setAlignment(Qt.AlignmentFlag.AlignRight)
        form_layout.addRow("", self.char_counter)
        self.update_description_counter()
        layout.addWidget(form_group)

        self.required_note = QLabel("* Campos obligatorios")
        self.required_note.setProperty("class", "warning")
        layout.addWidget(self.required_note)

        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        layout.addWidget(self.progress_bar)

        button_box = QDialogButtonBox()
        self.upload_btn = QPushButton("Subir a la nube")
        self.upload_btn.setProperty("class", "primary")
        self.upload_btn.setEnabled(False)
        self.upload_btn.clicked.connect(self.accept)
        button_box.addButton(self.upload_btn, QDialogButtonBox.ButtonRole.AcceptRole)

        cancel_btn = QPushButton("Cancelar")
        cancel_btn.clicked.connect(self.reject)
        button_box.addButton(cancel_btn, QDialogButtonBox.ButtonRole.RejectRole)
        layout.addWidget(button_box)

        self.version_input.setFocus()

    def auto_detect_info(self):
        """Attempt to detect brand and version from the filename."""
        logger.debug(f"Auto-detecting info from filename: {self.file_path.name}")
        filename = self.file_path.stem.lower()

        brand_keywords = {
            "magicard": "Magicard",
            "zebra": "Zebra",
            "entrust": "Entrust Sigma",
            "evolis": "Evolis",
            "fargo": "Fargo",
            "datacard": "Datacard",
        }
        for keyword, brand in brand_keywords.items():
            if keyword in filename:
                index = self.brand_combo.findText(brand)
                if index >= 0:
                    self.brand_combo.setCurrentIndex(index)
                    logger.debug(f"Auto-detected brand: {brand}")
                break

        version_patterns = [
            r"v?(\d+\.\d+\.\d+)",
            r"v?(\d+\.\d+)",
            r"_(\d+)_(\d+)",
        ]
        for pattern in version_patterns:
            match = re.search(pattern, filename)
            if match:
                version = match.group(1) if len(match.groups()) == 1 else ".".join(match.groups())
                self.version_input.setText(version)
                logger.debug(f"Auto-detected version: {version}")
                break

    def on_version_changed(self, text):
        """Validate version format in real time."""
        if not text:
            self.version_status.setText("")
            self.version_status.setProperty("class", "")
            self.validate_form()
            return

        version_regex = r"^\d+(\.\d+){0,3}$"
        if re.match(version_regex, text):
            self.version_status.setText("Formato valido")
            self.version_status.setProperty("class", "status-ok")
        else:
            self.version_status.setText("Revisa el formato")
            self.version_status.setProperty("class", "status-error")
        self.version_status.style().unpolish(self.version_status)
        self.version_status.style().polish(self.version_status)
        self.validate_form()

    def on_description_changed(self):
        """Keep the counter and validation in sync."""
        self.update_description_counter()
        self.validate_form()

    def update_description_counter(self):
        """Update the description counter."""
        char_count = len(self.description_input.toPlainText())
        self.char_counter.setText(f"{char_count} / 500 caracteres")
        if char_count > 500:
            self.char_counter.setProperty("class", "status-error")
        else:
            self.char_counter.setProperty("class", "subtle")
        self.char_counter.style().unpolish(self.char_counter)
        self.char_counter.style().polish(self.char_counter)

    def validate_form(self):
        """Validate the complete form."""
        version = self.version_input.text().strip()
        description = self.description_input.toPlainText().strip()
        is_valid = bool(version) and bool(re.match(r"^\d+(\.\d+){0,3}$", version))
        if len(description) > 500:
            is_valid = False

        self.upload_btn.setEnabled(is_valid)
        self.is_valid = is_valid
        logger.debug(f"Form validation: valid={is_valid}")

    def get_data(self):
        """Return form data."""
        return {
            "brand": self.brand_combo.currentText(),
            "version": self.version_input.text().strip(),
            "description": self.description_input.toPlainText().strip(),
        }

    def set_progress(self, value):
        """Update the progress bar."""
        if not self.progress_bar.isVisible():
            self.progress_bar.setVisible(True)
        self.progress_bar.setValue(value)

    def show_error(self, message):
        """Show an error dialog."""
        QMessageBox.critical(self, "Error", message)


class UploadSuccessDialog(QDialog):
    """Confirmation dialog after a successful upload."""

    def __init__(self, driver_info, parent=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.driver_info = driver_info

        self.setWindowTitle("Subida exitosa")
        self.setModal(True)
        self.setFixedSize(420, 270)
        self.setStyleSheet(self.theme_manager.generate_stylesheet())

        self.init_ui()

    def init_ui(self):
        """Build the success layout."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 22, 24, 24)
        layout.setSpacing(10)

        eyebrow = QLabel("CARGA COMPLETADA")
        eyebrow.setProperty("class", "chip")
        eyebrow.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(eyebrow, alignment=Qt.AlignmentFlag.AlignCenter)

        title = QLabel("Driver subido correctamente")
        title.setFont(QFont("Segoe UI Variable Text", 14, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setProperty("class", "heroTitle")
        layout.addWidget(title)

        brand_label = QLabel(f"{self.driver_info['brand']} v{self.driver_info['version']}")
        brand_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        brand_label.setFont(QFont("Segoe UI Variable Text", 11, QFont.Weight.Bold))
        layout.addWidget(brand_label)

        if self.driver_info.get("description"):
            desc_label = QLabel(self.driver_info["description"])
            desc_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            desc_label.setWordWrap(True)
            desc_label.setProperty("class", "sectionMeta")
            layout.addWidget(desc_label)

        layout.addStretch()

        ok_btn = QPushButton("Aceptar")
        ok_btn.setProperty("class", "primary")
        ok_btn.clicked.connect(self.accept)
        layout.addWidget(ok_btn, alignment=Qt.AlignmentFlag.AlignCenter)
