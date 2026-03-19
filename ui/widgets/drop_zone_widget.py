"""
Custom drag and drop zone for driver uploads.
"""

from pathlib import Path

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import QFileDialog, QLabel, QVBoxLayout, QWidget

from core.logger import get_logger
from ui.theme_manager import resolve_theme_manager

logger = get_logger()


class DropZoneWidget(QWidget):
    """
    Drag and drop zone with themed visual feedback.

    Signals:
        file_dropped(str): emitted when a valid file is dropped or selected
    """

    file_dropped = pyqtSignal(str)

    def __init__(self, parent=None, accepted_extensions=None):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.accepted_extensions = accepted_extensions or [".exe", ".zip", ".msi"]
        self.is_dragging = False
        self.is_valid_file = False

        self.setAcceptDrops(True)
        self.setMinimumHeight(150)
        self.setAccessibleName("Zona de carga de drivers")
        extensions = ", ".join(self.accepted_extensions)
        self.setAccessibleDescription(
            "Arrastra y suelta un archivo de driver o haz clic para seleccionarlo. "
            f"Extensiones permitidas: {extensions}"
        )
        self.init_ui()

    def init_ui(self):
        """Build the widget layout."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(6)

        self.icon_label = QLabel("DRV")
        self.icon_label.setFont(QFont("Segoe UI Variable Text", 24, QFont.Weight.Bold))
        self.icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.icon_label.setProperty("class", "heroIcon")
        layout.addWidget(self.icon_label)

        self.text_label = QLabel("Arrastra un driver aqui")
        self.text_label.setFont(QFont("Segoe UI Variable Text", 13, QFont.Weight.Bold))
        self.text_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.text_label)

        self.hint_label = QLabel("o haz clic para seleccionar")
        self.hint_label.setFont(QFont("Segoe UI Variable Text", 10))
        self.hint_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.hint_label.setProperty("class", "subtle")
        layout.addWidget(self.hint_label)

        extensions_text = ", ".join(self.accepted_extensions)
        self.extensions_label = QLabel(f"Archivos permitidos: {extensions_text}")
        self.extensions_label.setFont(QFont("Segoe UI Variable Text", 9))
        self.extensions_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.extensions_label.setProperty("class", "subtle")
        layout.addWidget(self.extensions_label)

        self.update_style("normal")

    def update_style(self, state="normal"):
        """Update colors and copy based on the current drag state."""
        colors = self.theme_manager.get_theme_colors()
        styles = {
            "normal": f"""
                QWidget {{
                    background-color: {colors['dropzone_background']};
                    border: 2px dashed {colors['border_strong']};
                    border-radius: 14px;
                }}
                QWidget:hover {{
                    background-color: {colors['dropzone_hover']};
                    border-color: {colors['accent']};
                }}
            """,
            "dragging_valid": f"""
                QWidget {{
                    background-color: {colors['panel_success']};
                    border: 2px dashed {colors['success']};
                    border-radius: 14px;
                }}
            """,
            "dragging_invalid": f"""
                QWidget {{
                    background-color: {colors['panel_error']};
                    border: 2px dashed {colors['error']};
                    border-radius: 14px;
                }}
            """,
            "error": f"""
                QWidget {{
                    background-color: {colors['panel_error']};
                    border: 2px solid {colors['error']};
                    border-radius: 14px;
                }}
            """,
        }
        self.setStyleSheet(styles.get(state, styles["normal"]))

        if state == "dragging_valid":
            self.icon_label.setText("OK")
            self.text_label.setText("Suelta para subir")
        elif state == "dragging_invalid":
            self.icon_label.setText("NO")
            self.text_label.setText("Archivo no valido")
        elif state == "error":
            self.icon_label.setText("ERR")
            self.text_label.setText("Error al procesar")
        else:
            self.icon_label.setText("DRV")
            self.text_label.setText("Arrastra un driver aqui")

    def refresh_theme(self):
        """Refresh colors after a global theme change."""
        self.theme_manager = resolve_theme_manager(self.parent())
        self.update_style("normal")

    def dragEnterEvent(self, event):
        """Handle a dragged file entering the zone."""
        logger.debug("Drag enter event")

        if event.mimeData().hasUrls():
            urls = event.mimeData().urls()
            if len(urls) == 1:
                file_path = urls[0].toLocalFile()
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
        """Keep accepting the drag while the file stays valid."""
        if self.is_valid_file:
            event.acceptProposedAction()

    def dragLeaveEvent(self, event):
        """Reset state when the drag leaves the zone."""
        logger.debug("Drag leave event")
        self.is_dragging = False
        self.is_valid_file = False
        self.update_style("normal")

    def dropEvent(self, event):
        """Handle a dropped file."""
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
        """Open the file picker on click."""
        if event.button() == Qt.MouseButton.LeftButton:
            self.open_file_dialog()

    def open_file_dialog(self):
        """Open a file picker for the accepted extensions."""
        extensions_filter = " ".join(f"*{ext}" for ext in self.accepted_extensions)
        filter_string = f"Driver Files ({extensions_filter});;All Files (*.*)"

        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Seleccionar Driver",
            "",
            filter_string,
        )

        if file_path:
            logger.info(f"File selected via dialog: {file_path}")
            self.file_dropped.emit(file_path)

    def _is_valid_file(self, file_path):
        """Return True when the selected path matches the accepted files."""
        path = Path(file_path)
        if not path.exists():
            return False
        if not path.is_file():
            return False
        return path.suffix.lower() in self.accepted_extensions
