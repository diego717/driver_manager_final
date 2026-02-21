"""
Widget personalizado para zona de Drag & Drop
Proporciona feedback visual durante el arrastre
"""

from PyQt6.QtWidgets import QWidget, QVBoxLayout, QLabel
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QPainter, QColor, QPen, QFont
from pathlib import Path

from core.logger import get_logger

logger = get_logger()


class DropZoneWidget(QWidget):
    """
    Widget de zona de drop con feedback visual
    Señales:
        file_dropped(str): Emitida cuando se suelta un archivo válido
    """
    
    file_dropped = pyqtSignal(str)  # Señal con la ruta del archivo
    
    def __init__(self, parent=None, accepted_extensions=None):
        super().__init__(parent)
        
        # Extensiones aceptadas
        if accepted_extensions is None:
            self.accepted_extensions = ['.exe', '.zip', '.msi']
        else:
            self.accepted_extensions = accepted_extensions
        
        # Estados visuales
        self.is_dragging = False
        self.is_valid_file = False
        
        # Configurar UI
        self.setAcceptDrops(True)
        self.setMinimumHeight(150)
        self.init_ui()
    
    def init_ui(self):
        """Inicializar interfaz"""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        
        # Icono y texto
        self.icon_label = QLabel("📦")
        self.icon_label.setFont(QFont("Arial", 48))
        self.icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.icon_label)
        
        self.text_label = QLabel("Arrastra un driver aquí")
        self.text_label.setFont(QFont("Arial", 14))
        self.text_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.text_label)
        
        self.hint_label = QLabel("o haz clic para seleccionar")
        self.hint_label.setFont(QFont("Arial", 10))
        self.hint_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.hint_label.setStyleSheet("color: #888;")
        layout.addWidget(self.hint_label)
        
        # Extensiones aceptadas
        extensions_text = ", ".join(self.accepted_extensions)
        self.extensions_label = QLabel(f"Archivos: {extensions_text}")
        self.extensions_label.setFont(QFont("Arial", 9))
        self.extensions_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.extensions_label.setStyleSheet("color: #666;")
        layout.addWidget(self.extensions_label)
        
        # Estilo base
        self.update_style(state="normal")
    
    def update_style(self, state="normal"):
        """
        Actualizar estilo según estado
        Estados: normal, dragging_valid, dragging_invalid, error
        """
        # Intentar obtener colores del theme_manager del padre si existe
        bg_normal = "#F8F9FA"
        border_normal = "#BDC3C7"
        bg_hover = "#EBF5FF"
        accent = "#3498DB"
        success = "#27AE60"
        error = "#E74C3C"
        bg_success = "#E8F8F5"
        bg_error = "#FDEDEC"

        # Si tenemos acceso al theme_manager de MainWindow
        try:
            if hasattr(self.parent(), 'parent') and hasattr(self.parent().parent, 'theme_manager'):
                tm = self.parent().parent.theme_manager
                bg_normal = tm.get_color('surface')
                border_normal = tm.get_color('border')
                bg_hover = tm.get_color('table_row_hover')
                accent = tm.get_color('accent')
                success = tm.get_color('success')
                error = tm.get_color('error')
                bg_success = tm.get_color('panel_success')
                bg_error = tm.get_color('panel_error')
        except:
            pass

        styles = {
            "normal": f"""
                QWidget {{
                    background-color: {bg_normal};
                    border: 2px dashed {border_normal};
                    border-radius: 12px;
                }}
                QWidget:hover {{
                    background-color: {bg_hover};
                    border-color: {accent};
                }}
            """,
            "dragging_valid": f"""
                QWidget {{
                    background-color: {bg_success};
                    border: 3px dashed {success};
                    border-radius: 12px;
                }}
            """,
            "dragging_invalid": f"""
                QWidget {{
                    background-color: {bg_error};
                    border: 3px dashed {error};
                    border-radius: 12px;
                }}
            """,
            "error": f"""
                QWidget {{
                    background-color: {bg_error};
                    border: 2px solid {error};
                    border-radius: 12px;
                }}
            """
        }
        
        self.setStyleSheet(styles.get(state, styles["normal"]))
        
        # Actualizar texto según estado
        if state == "dragging_valid":
            self.icon_label.setText("✅")
            self.text_label.setText("Suelta para subir")
        elif state == "dragging_invalid":
            self.icon_label.setText("❌")
            self.text_label.setText("Archivo no válido")
        elif state == "error":
            self.icon_label.setText("⚠️")
            self.text_label.setText("Error al procesar")
        else:
            self.icon_label.setText("📦")
            self.text_label.setText("Arrastra un driver aquí")
    
    def dragEnterEvent(self, event):
        """Cuando entra un archivo arrastrado"""
        logger.debug("Drag enter event")
        
        if event.mimeData().hasUrls():
            urls = event.mimeData().urls()
            
            # Verificar que sea un solo archivo
            if len(urls) == 1:
                file_path = urls[0].toLocalFile()
                
                # Verificar extensión
                if self._is_valid_file(file_path):
                    event.acceptProposedAction()
                    self.is_dragging = True
                    self.is_valid_file = True
                    self.update_style("dragging_valid")
                    logger.debug(f"Valid file detected: {file_path}")
                else:
                    self.is_dragging = True
                    self.is_valid_file = False
                    self.update_style("dragging_invalid")
                    logger.debug(f"Invalid file extension: {file_path}")
            else:
                self.is_dragging = True
                self.is_valid_file = False
                self.update_style("dragging_invalid")
                logger.debug(f"Multiple files not supported: {len(urls)} files")
    
    def dragMoveEvent(self, event):
        """Mientras se mueve sobre el widget"""
        if self.is_valid_file:
            event.acceptProposedAction()
    
    def dragLeaveEvent(self, event):
        """Cuando sale del widget"""
        logger.debug("Drag leave event")
        self.is_dragging = False
        self.is_valid_file = False
        self.update_style("normal")
    
    def dropEvent(self, event):
        """Cuando suelta el archivo"""
        logger.operation_start("drop_file")
        
        self.is_dragging = False
        self.update_style("normal")
        
        if event.mimeData().hasUrls():
            urls = event.mimeData().urls()
            
            if len(urls) == 1:
                file_path = urls[0].toLocalFile()
                
                if self._is_valid_file(file_path):
                    logger.info(f"File dropped: {file_path}")
                    self.file_dropped.emit(file_path)
                    logger.operation_end("drop_file", success=True)
                else:
                    logger.warning(f"Invalid file dropped: {file_path}")
                    self.update_style("error")
                    logger.operation_end("drop_file", success=False)
    
    def mousePressEvent(self, event):
        """Click para abrir diálogo de archivo"""
        if event.button() == Qt.MouseButton.LeftButton:
            self.open_file_dialog()
    
    def open_file_dialog(self):
        """Abrir diálogo de selección de archivo"""
        from PyQt6.QtWidgets import QFileDialog
        
        extensions_filter = " ".join(f"*{ext}" for ext in self.accepted_extensions)
        filter_string = f"Driver Files ({extensions_filter});;All Files (*.*)"
        
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Seleccionar Driver",
            "",
            filter_string
        )
        
        if file_path:
            logger.info(f"File selected via dialog: {file_path}")
            self.file_dropped.emit(file_path)
    
    def _is_valid_file(self, file_path):
        """Verificar si el archivo es válido"""
        path = Path(file_path)
        
        # Verificar que existe
        if not path.exists():
            return False
        
        # Verificar que es archivo (no directorio)
        if not path.is_file():
            return False
        
        # Verificar extensión
        extension = path.suffix.lower()
        return extension in self.accepted_extensions