"""
Diálogo rápido para completar información al subir un driver
"""

from PyQt6.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
                             QLabel, QLineEdit, QComboBox, QTextEdit, QPushButton,
                             QDialogButtonBox, QGroupBox, QProgressBar, QMessageBox)
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QFont, QPixmap, QIcon
from pathlib import Path
import re

from core.logger import get_logger
from core.exceptions import ValidationError, validate_min_length

logger = get_logger()


class QuickUploadDialog(QDialog):
    """
    Diálogo rápido para subir drivers con validación en tiempo real
    """
    
    def __init__(self, file_path, parent=None):
        super().__init__(parent)
        self.file_path = Path(file_path)
        self.is_valid = False
        
        # Configuración
        self.setWindowTitle("Subir Driver a la Nube")
        self.setModal(True)
        self.setMinimumWidth(500)
        
        # Aplicar tema del parent si existe
        if parent and hasattr(parent, 'theme_manager'):
            try:
                stylesheet = parent.theme_manager.generate_stylesheet()
                self.setStyleSheet(stylesheet)
            except:
                pass
        
        self.init_ui()
        self.auto_detect_info()
    
    def init_ui(self):
        """Inicializar interfaz"""
        layout = QVBoxLayout(self)
        
        # Header con icono
        header_layout = QHBoxLayout()
        
        icon_label = QLabel("☁️")
        icon_label.setFont(QFont("Arial", 48))
        header_layout.addWidget(icon_label)
        
        title_layout = QVBoxLayout()
        title = QLabel("Subir Driver")
        title.setFont(QFont("Arial", 16, QFont.Weight.Bold))
        title_layout.addWidget(title)
        
        subtitle = QLabel("Completa la información del driver")
        subtitle.setStyleSheet("color: #666;")
        title_layout.addWidget(subtitle)
        
        header_layout.addLayout(title_layout)
        header_layout.addStretch()
        
        layout.addLayout(header_layout)
        
        # Información del archivo
        file_group = QGroupBox("📁 Archivo")
        file_layout = QVBoxLayout()
        
        self.filename_label = QLabel(self.file_path.name)
        self.filename_label.setFont(QFont("Arial", 11, QFont.Weight.Bold))
        file_layout.addWidget(self.filename_label)
        
        file_info_layout = QHBoxLayout()
        
        # Tamaño
        size_mb = self.file_path.stat().st_size / (1024 * 1024)
        size_label = QLabel(f"📊 Tamaño: {size_mb:.2f} MB")
        size_label.setStyleSheet("color: #666;")
        file_info_layout.addWidget(size_label)
        
        # Tipo
        extension = self.file_path.suffix.upper()
        type_label = QLabel(f"📄 Tipo: {extension}")
        type_label.setStyleSheet("color: #666;")
        file_info_layout.addWidget(type_label)
        
        file_info_layout.addStretch()
        file_layout.addLayout(file_info_layout)
        
        file_group.setLayout(file_layout)
        layout.addWidget(file_group)
        
        # Formulario de datos
        form_group = QGroupBox("ℹ️ Información del Driver")
        form_layout = QFormLayout()
        
        # Marca
        self.brand_combo = QComboBox()
        self.brand_combo.addItems(["Magicard", "Zebra", "Entrust Sigma", "Evolis", "Fargo", "Datacard"])
        self.brand_combo.currentTextChanged.connect(self.validate_form)
        form_layout.addRow("Marca: *", self.brand_combo)
        
        # Versión
        version_layout = QHBoxLayout()
        self.version_input = QLineEdit()
        self.version_input.setPlaceholderText("Ej: 1.2.3, 2.0.1, 5.4")
        self.version_input.textChanged.connect(self.on_version_changed)
        version_layout.addWidget(self.version_input)
        
        self.version_status = QLabel()
        version_layout.addWidget(self.version_status)
        
        form_layout.addRow("Versión: *", version_layout)
        
        # Descripción
        self.description_input = QTextEdit()
        self.description_input.setPlaceholderText(
            "Descripción opcional del driver (características, compatibilidad, notas importantes...)"
        )
        self.description_input.setMaximumHeight(80)
        self.description_input.textChanged.connect(self.on_description_changed)
        form_layout.addRow("Descripción:", self.description_input)
        
        # Contador de caracteres
        self.char_counter = QLabel("0 / 500 caracteres")
        self.char_counter.setStyleSheet("color: #888; font-size: 9pt;")
        self.char_counter.setAlignment(Qt.AlignmentFlag.AlignRight)
        form_layout.addRow("", self.char_counter)
        self.update_description_counter()
        form_group.setLayout(form_layout)
        layout.addWidget(form_group)
        
        # Nota de campos obligatorios
        required_note = QLabel("* Campos obligatorios")
        required_note.setStyleSheet("color: #E74C3C; font-size: 9pt; font-style: italic;")
        layout.addWidget(required_note)
        
        # Progress bar (oculto por defecto)
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        layout.addWidget(self.progress_bar)
        
        # Botones
        button_box = QDialogButtonBox()
        
        self.upload_btn = QPushButton("☁️ Subir a la Nube")
        self.upload_btn.setStyleSheet("""
            QPushButton {
                background-color: #27AE60;
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                font-weight: bold;
                font-size: 12pt;
            }
            QPushButton:hover {
                background-color: #229954;
            }
            QPushButton:disabled {
                background-color: #BDC3C7;
                color: #7F8C8D;
            }
        """)
        self.upload_btn.setEnabled(False)
        self.upload_btn.clicked.connect(self.accept)
        button_box.addButton(self.upload_btn, QDialogButtonBox.ButtonRole.AcceptRole)
        
        cancel_btn = QPushButton("Cancelar")
        cancel_btn.clicked.connect(self.reject)
        button_box.addButton(cancel_btn, QDialogButtonBox.ButtonRole.RejectRole)
        
        layout.addWidget(button_box)
        
        # Focus en versión (marca ya tiene default)
        self.version_input.setFocus()
    
    def auto_detect_info(self):
        """Intentar detectar automáticamente marca y versión del nombre del archivo"""
        logger.debug(f"Auto-detecting info from filename: {self.file_path.name}")
        
        filename = self.file_path.stem.lower()  # Sin extensión
        
        # Detectar marca
        brand_keywords = {
            "magicard": "Magicard",
            "zebra": "Zebra",
            "entrust": "Entrust Sigma",
            "evolis": "Evolis",
            "fargo": "Fargo",
            "datacard": "Datacard"
        }
        
        for keyword, brand in brand_keywords.items():
            if keyword in filename:
                index = self.brand_combo.findText(brand)
                if index >= 0:
                    self.brand_combo.setCurrentIndex(index)
                    logger.debug(f"Auto-detected brand: {brand}")
                break
        
        # Detectar versión (buscar patrones como v1.2.3, 1.2.3, etc)
        version_patterns = [
            r'v?(\d+\.\d+\.\d+)',  # 1.2.3 o v1.2.3
            r'v?(\d+\.\d+)',        # 1.2 o v1.2
            r'_(\d+)_(\d+)',        # driver_5_4
        ]
        
        for pattern in version_patterns:
            match = re.search(pattern, filename)
            if match:
                if len(match.groups()) == 1:
                    version = match.group(1)
                else:
                    version = '.'.join(match.groups())
                
                self.version_input.setText(version)
                logger.debug(f"Auto-detected version: {version}")
                break
    
    def on_version_changed(self, text):
        """Validar versión en tiempo real"""
        if not text:
            self.version_status.setText("")
            self.validate_form()
            return
        
        # Validar formato de versión
        version_regex = r'^\d+(\.\d+){0,3}$'  # 1, 1.2, 1.2.3, 1.2.3.4
        
        if re.match(version_regex, text):
            self.version_status.setText("✅")
            self.version_status.setStyleSheet("color: #27AE60; font-size: 14pt;")
        else:
            self.version_status.setText("❌")
            self.version_status.setStyleSheet("color: #E74C3C; font-size: 14pt;")
        self.validate_form()

    def on_description_changed(self):
        """Actualizar contador de descripción y validar formulario."""
        self.update_description_counter()
        self.validate_form()

    def update_description_counter(self):
        """Actualizar contador visual de caracteres para la descripción."""
        char_count = len(self.description_input.toPlainText())
        self.char_counter.setText(f"{char_count} / 500 caracteres")

        if char_count > 500:
            self.char_counter.setStyleSheet("color: #E74C3C; font-size: 9pt; font-weight: bold;")
        else:
            self.char_counter.setStyleSheet("color: #888; font-size: 9pt;")
    
    def validate_form(self):
        """Validar formulario completo"""
        version = self.version_input.text().strip()
        description = self.description_input.toPlainText().strip()
        
        # Validaciones
        is_valid = True
        
        # Versión obligatoria y con formato correcto
        if not version:
            is_valid = False
        elif not re.match(r'^\d+(\.\d+){0,3}$', version):
            is_valid = False
        
        # Descripción no puede exceder 500 caracteres
        if len(description) > 500:
            is_valid = False
        
        # Actualizar estado del botón
        self.upload_btn.setEnabled(is_valid)
        self.is_valid = is_valid
        
        logger.debug(f"Form validation: valid={is_valid}")
    
    def get_data(self):
        """
        Obtener datos del formulario
        Returns:
            dict: {'brand', 'version', 'description'}
        """
        return {
            'brand': self.brand_combo.currentText(),
            'version': self.version_input.text().strip(),
            'description': self.description_input.toPlainText().strip()
        }
    
    def set_progress(self, value):
        """Actualizar barra de progreso"""
        if not self.progress_bar.isVisible():
            self.progress_bar.setVisible(True)
        
        self.progress_bar.setValue(value)
    
    def show_error(self, message):
        """Mostrar mensaje de error"""
        QMessageBox.critical(self, "Error", message)


class UploadSuccessDialog(QDialog):
    """Diálogo de confirmación de subida exitosa"""
    
    def __init__(self, driver_info, parent=None):
        super().__init__(parent)
        self.driver_info = driver_info
        
        self.setWindowTitle("¡Subida Exitosa!")
        self.setModal(True)
        self.setFixedSize(400, 250)
        
        self.init_ui()
    
    def init_ui(self):
        """Inicializar interfaz"""
        layout = QVBoxLayout(self)
        
        # Icono de éxito
        success_icon = QLabel("✅")
        success_icon.setFont(QFont("Arial", 72))
        success_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(success_icon)
        
        # Título
        title = QLabel("¡Driver subido exitosamente!")
        title.setFont(QFont("Arial", 14, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)
        
        # Detalles
        details_layout = QVBoxLayout()
        details_layout.setSpacing(5)
        
        brand_label = QLabel(f"📦 {self.driver_info['brand']} v{self.driver_info['version']}")
        brand_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        brand_label.setStyleSheet("font-size: 12pt;")
        details_layout.addWidget(brand_label)
        
        if self.driver_info.get('description'):
            desc_label = QLabel(f"ℹ️ {self.driver_info['description']}")
            desc_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            desc_label.setStyleSheet("color: #666;")
            desc_label.setWordWrap(True)
            details_layout.addWidget(desc_label)
        
        layout.addLayout(details_layout)
        
        layout.addSpacing(20)
        
        # Botón OK
        ok_btn = QPushButton("Aceptar")
        ok_btn.setStyleSheet("""
            QPushButton {
                background-color: #27AE60;
                color: white;
                padding: 10px 30px;
                border-radius: 5px;
                font-weight: bold;
            }
        """)
        ok_btn.clicked.connect(self.accept)
        layout.addWidget(ok_btn, alignment=Qt.AlignmentFlag.AlignCenter)
