"""
Theme manager for the desktop application.
Provides consistent light and dark themes for Windows-focused UI.
"""

import sys

from PyQt6.QtCore import QSettings


def resolve_theme_manager(parent=None):
    """Reuse the parent theme manager when available, otherwise create one."""
    manager = getattr(parent, "theme_manager", None)
    if manager is not None:
        return manager
    return ThemeManager()


class ThemeManager:
    """Theme manager for the desktop application."""

    def __init__(self):
        self.settings = QSettings("DriverManager", "Themes")
        self.current_theme = self.settings.value("current_theme", "light")
        self.is_windows = sys.platform.startswith("win")
        self.themes = {
            "light": {
                "name": "Tema Claro",
                "colors": {
                    "background": "#eef2f6",
                    "surface": "#f7f9fc",
                    "surface_raised": "#ffffff",
                    "surface_alt": "#e6ebf2",
                    "surface_hover": "#dde5ef",
                    "surface_pressed": "#d2dbe6",
                    "text_primary": "#16202c",
                    "text_secondary": "#4d5d70",
                    "text_muted": "#748399",
                    "text_inverse": "#f7faff",
                    "accent": "#1f5b93",
                    "accent_hover": "#2a6aa5",
                    "accent_soft": "rgba(31, 91, 147, 0.14)",
                    "success": "#2f7d52",
                    "success_hover": "#398f5f",
                    "warning": "#8b5a1c",
                    "warning_hover": "#9d6821",
                    "error": "#a74234",
                    "error_hover": "#ba5142",
                    "info": "#2b6aa6",
                    "border": "#c7d0db",
                    "border_strong": "#aebbc9",
                    "border_light": "#e2e8f0",
                    "separator": "#d9e0e8",
                    "input_background": "#ffffff",
                    "input_background_focus": "#ffffff",
                    "input_border": "#bcc8d5",
                    "input_border_focus": "#1f5b93",
                    "selection": "rgba(31, 91, 147, 0.16)",
                    "selection_text": "#16202c",
                    "table_header": "#edf2f7",
                    "table_row_even": "#ffffff",
                    "table_row_odd": "#f7f9fc",
                    "table_row_hover": "#eaf0f6",
                    "table_selected": "rgba(31, 91, 147, 0.14)",
                    "panel_info": "rgba(43, 106, 166, 0.12)",
                    "panel_success": "rgba(47, 125, 82, 0.13)",
                    "panel_warning": "rgba(139, 90, 28, 0.15)",
                    "panel_error": "rgba(167, 66, 52, 0.14)",
                    "stats_background": "#f3f6fa",
                    "stats_text": "#16202c",
                    "stats_border": "#c7d0db",
                    "log_background": "#f3f6fa",
                    "dropzone_background": "#f8fafc",
                    "dropzone_hover": "#eef4fb",
                },
            },
            "dark": {
                "name": "Tema Oscuro",
                "colors": {
                    "background": "#0c131b",
                    "surface": "#131b24",
                    "surface_raised": "#192330",
                    "surface_alt": "#101821",
                    "surface_hover": "#1e2a38",
                    "surface_pressed": "#243243",
                    "text_primary": "#e8edf4",
                    "text_secondary": "#a6b4c4",
                    "text_muted": "#7d8da1",
                    "text_inverse": "#f7faff",
                    "accent": "#3f6f9c",
                    "accent_hover": "#4f80af",
                    "accent_soft": "rgba(79, 128, 175, 0.22)",
                    "success": "#367a55",
                    "success_hover": "#439265",
                    "warning": "#a16a22",
                    "warning_hover": "#b57a2a",
                    "error": "#a94a42",
                    "error_hover": "#c25a51",
                    "info": "#4d81ba",
                    "border": "#2f3b4a",
                    "border_strong": "#415266",
                    "border_light": "#203040",
                    "separator": "#263444",
                    "input_background": "#101821",
                    "input_background_focus": "#131c26",
                    "input_border": "#354557",
                    "input_border_focus": "#5a88b5",
                    "selection": "rgba(79, 128, 175, 0.28)",
                    "selection_text": "#e8edf4",
                    "table_header": "#101821",
                    "table_row_even": "#16202b",
                    "table_row_odd": "#101821",
                    "table_row_hover": "#1f2b39",
                    "table_selected": "rgba(79, 128, 175, 0.24)",
                    "panel_info": "rgba(77, 129, 186, 0.18)",
                    "panel_success": "rgba(54, 122, 85, 0.22)",
                    "panel_warning": "rgba(161, 106, 34, 0.22)",
                    "panel_error": "rgba(169, 74, 66, 0.24)",
                    "stats_background": "#101821",
                    "stats_text": "#e8edf4",
                    "stats_border": "#334457",
                    "log_background": "#101821",
                    "dropzone_background": "#101821",
                    "dropzone_hover": "#162331",
                },
            },
        }

    def get_current_theme(self):
        """Return the active theme name."""
        return self.current_theme

    def set_theme(self, theme_name):
        """Change the active theme."""
        if theme_name in self.themes:
            self.current_theme = theme_name
            self.settings.setValue("current_theme", theme_name)
            return True
        return False

    def get_color(self, color_name):
        """Get a single color from the active theme."""
        return self.themes[self.current_theme]["colors"].get(color_name, "#000000")

    def get_theme_colors(self):
        """Get a copy of the active color palette."""
        return dict(self.themes[self.current_theme]["colors"])

    def get_theme_names(self):
        """Return available themes."""
        return [(key, theme["name"]) for key, theme in self.themes.items()]

    def generate_stylesheet(self):
        """Generate the application stylesheet."""
        colors = self.themes[self.current_theme]["colors"]
        button_padding_v = 7 if self.is_windows else 9
        button_padding_h = 14 if self.is_windows else 16
        button_min_height = 38 if self.is_windows else 44
        input_padding_v = 5 if self.is_windows else 8
        input_padding_h = 10 if self.is_windows else 12
        input_min_height = 36 if self.is_windows else 44
        tab_padding_v = 8 if self.is_windows else 9
        tab_padding_h = 16 if self.is_windows else 18
        tab_min_height = 40 if self.is_windows else 44

        return f"""
        QMainWindow, QDialog {{
            background-color: {colors['background']};
            color: {colors['text_primary']};
            font-family: 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
        }}

        QWidget {{
            background-color: {colors['background']};
            color: {colors['text_primary']};
            font-family: 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
            selection-background-color: {colors['selection']};
            selection-color: {colors['selection_text']};
        }}

        QToolTip {{
            background-color: {colors['surface_raised']};
            color: {colors['text_primary']};
            border: 1px solid {colors['border_strong']};
            padding: 6px 8px;
        }}

        QTabWidget::pane {{
            border: 1px solid {colors['border_strong']};
            background-color: {colors['surface_raised']};
            border-radius: 16px;
            top: -1px;
        }}

        QTabBar::tab {{
            background-color: {colors['surface']};
            color: {colors['text_secondary']};
            padding: {tab_padding_v}px {tab_padding_h}px;
            min-height: {tab_min_height}px;
            margin-right: 6px;
            border: 1px solid {colors['border']};
            border-bottom: none;
            border-top-left-radius: 12px;
            border-top-right-radius: 12px;
            font-weight: 600;
        }}

        QTabBar::tab:selected {{
            background-color: {colors['surface_raised']};
            color: {colors['text_primary']};
            border-color: {colors['border_strong']};
            border-bottom: 2px solid {colors['accent']};
        }}

        QTabBar::tab:hover {{
            background-color: {colors['surface_hover']};
            color: {colors['text_primary']};
        }}

        QPushButton {{
            background-color: {colors['surface_raised']};
            color: {colors['text_primary']};
            border: 1px solid {colors['border']};
            padding: {button_padding_v}px {button_padding_h}px;
            border-radius: 9px;
            font-weight: 600;
            min-height: {button_min_height}px;
        }}

        QPushButton:hover {{
            background-color: {colors['surface_hover']};
            border-color: {colors['border_strong']};
        }}

        QPushButton:pressed {{
            background-color: {colors['surface_pressed']};
        }}

        QPushButton:disabled {{
            background-color: {colors['surface']};
            color: {colors['text_muted']};
            border-color: {colors['border']};
        }}

        QPushButton:focus {{
            border: 2px solid {colors['input_border_focus']};
        }}

        QPushButton[class="primary"] {{
            background-color: {colors['accent']};
            color: {colors['text_inverse']};
            border: 1px solid {colors['accent']};
            font-weight: 700;
        }}

        QPushButton[class="primary"]:hover {{
            background-color: {colors['accent_hover']};
            border-color: {colors['accent_hover']};
        }}

        QPushButton[class="success"] {{
            background-color: {colors['success']};
            color: {colors['text_inverse']};
            border-color: {colors['success']};
        }}

        QPushButton[class="success"]:hover {{
            background-color: {colors['success_hover']};
            border-color: {colors['success_hover']};
        }}

        QPushButton[class="warning"] {{
            background-color: {colors['warning']};
            color: {colors['text_inverse']};
            border-color: {colors['warning']};
        }}

        QPushButton[class="warning"]:hover {{
            background-color: {colors['warning_hover']};
            border-color: {colors['warning_hover']};
        }}

        QPushButton[class="danger"] {{
            background-color: {colors['error']};
            color: {colors['text_inverse']};
            border-color: {colors['error']};
        }}

        QPushButton[class="danger"]:hover {{
            background-color: {colors['error_hover']};
            border-color: {colors['error_hover']};
        }}

        QPushButton[class="info"] {{
            background-color: {colors['panel_info']};
            color: {colors['text_primary']};
            border-color: {colors['info']};
        }}

        QPushButton[class="info"]:hover {{
            background-color: {colors['accent_soft']};
            border-color: {colors['info']};
        }}

        QPushButton[class="flat"] {{
            background-color: transparent;
            border-color: transparent;
        }}

        QPushButton[class="flat"]:hover {{
            background-color: {colors['surface_hover']};
            border-color: {colors['border']};
        }}

        QLineEdit, QTextEdit, QPlainTextEdit, QComboBox, QSpinBox {{
            background-color: {colors['input_background']};
            color: {colors['text_primary']};
            border: 1px solid {colors['input_border']};
            border-radius: 9px;
            padding: {input_padding_v}px {input_padding_h}px;
            min-height: {input_min_height}px;
        }}

        QLineEdit[readOnly="true"], QTextEdit[readOnly="true"], QPlainTextEdit[readOnly="true"] {{
            background-color: {colors['surface']};
            color: {colors['text_secondary']};
        }}

        QLineEdit::placeholder, QTextEdit::placeholder {{
            color: {colors['text_muted']};
        }}

        QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QComboBox:focus, QSpinBox:focus {{
            background-color: {colors['input_background_focus']};
            border: 2px solid {colors['input_border_focus']};
        }}

        QListWidget, QTableWidget {{
            background-color: {colors['surface_raised']};
            color: {colors['text_primary']};
            border: 1px solid {colors['border']};
            alternate-background-color: {colors['table_row_odd']};
            border-radius: 12px;
            gridline-color: {colors['border_light']};
        }}

        QListWidget::item, QTableWidget::item {{
            padding: 8px 10px;
            border-bottom: 1px solid {colors['border_light']};
        }}

        QListWidget::item:selected, QTableWidget::item:selected {{
            background-color: {colors['table_selected']};
            color: {colors['text_primary']};
        }}

        QListWidget::item:hover, QTableWidget::item:hover {{
            background-color: {colors['table_row_hover']};
        }}

        QHeaderView::section {{
            background-color: {colors['table_header']};
            color: {colors['text_secondary']};
            padding: 10px 12px;
            border: none;
            border-bottom: 1px solid {colors['border_strong']};
            font-weight: 700;
        }}

        QGroupBox {{
            font-weight: 700;
            border: 1px solid {colors['border']};
            border-radius: 14px;
            margin-top: 18px;
            padding: 18px 16px 14px 16px;
            color: {colors['text_primary']};
            background-color: {colors['surface_raised']};
        }}

        QGroupBox::title {{
            subcontrol-origin: margin;
            left: 14px;
            padding: 0 6px;
            color: {colors['text_secondary']};
            background-color: {colors['background']};
        }}

        QLabel {{
            color: {colors['text_primary']};
        }}

        QLabel[class="heroTitle"] {{
            font-size: 22px;
            font-weight: 700;
            color: {colors['text_primary']};
        }}

        QLabel[class="sectionTitle"] {{
            font-size: 15px;
            font-weight: 700;
            color: {colors['text_primary']};
        }}

        QLabel[class="sectionMeta"], QLabel[class="subtle"] {{
            color: {colors['text_secondary']};
        }}

        QLabel[class="heroIcon"] {{
            color: {colors['accent']};
            font-weight: 700;
        }}

        QLabel[class="chip"] {{
            background-color: {colors['surface_alt']};
            color: {colors['text_secondary']};
            border: 1px solid {colors['border']};
            border-radius: 999px;
            padding: 4px 10px;
        }}

        QLabel[class="info"] {{
            background-color: {colors['panel_info']};
            color: {colors['text_primary']};
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid {colors['info']};
        }}

        QLabel[class="success"] {{
            background-color: {colors['panel_success']};
            color: {colors['text_primary']};
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid {colors['success']};
        }}

        QLabel[class="warning"] {{
            background-color: {colors['panel_warning']};
            color: {colors['text_primary']};
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid {colors['warning']};
        }}

        QLabel[class="error"], QLabel[class="error-inline"] {{
            background-color: {colors['panel_error']};
            color: {colors['text_primary']};
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid {colors['error']};
        }}

        QLabel[class="status-ok"] {{
            color: {colors['success']};
            font-weight: 700;
        }}

        QLabel[class="status-error"] {{
            color: {colors['error']};
            font-weight: 700;
        }}

        QTextEdit[class="stats"] {{
            background-color: {colors['stats_background']};
            color: {colors['stats_text']};
            border: 1px solid {colors['stats_border']};
            border-radius: 12px;
            padding: 12px;
            font-family: 'Cascadia Mono', 'Consolas', monospace;
            font-size: 11px;
        }}

        QTextEdit[class="logPanel"] {{
            background-color: {colors['log_background']};
            color: {colors['text_primary']};
            border: 1px solid {colors['stats_border']};
            border-radius: 12px;
            padding: 12px;
            font-family: 'Cascadia Mono', 'Consolas', monospace;
            font-size: 11px;
        }}

        QProgressBar {{
            background-color: {colors['surface_alt']};
            color: {colors['text_primary']};
            border: 1px solid {colors['border']};
            border-radius: 6px;
            text-align: center;
            min-height: 18px;
        }}

        QProgressBar::chunk {{
            background-color: {colors['accent']};
            border-radius: 5px;
        }}

        QScrollBar:vertical {{
            background-color: {colors['surface']};
            width: 12px;
            border-radius: 6px;
            margin: 3px;
        }}

        QScrollBar::handle:vertical {{
            background-color: {colors['surface_hover']};
            border-radius: 6px;
            min-height: 24px;
        }}

        QScrollBar::handle:vertical:hover {{
            background-color: {colors['separator']};
        }}

        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical,
        QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{
            background: none;
            border: none;
        }}

        QCheckBox {{
            spacing: 8px;
            color: {colors['text_secondary']};
        }}

        QSplitter::handle {{
            background-color: {colors['border_light']};
        }}

        QStatusBar {{
            background-color: {colors['surface']};
            color: {colors['text_secondary']};
            border-top: 1px solid {colors['border']};
        }}
        """

    def apply_theme_to_widget(self, widget, widget_class=None):
        """Apply a custom property class to a widget and repolish it."""
        if widget_class:
            widget.setProperty("class", widget_class)
            widget.style().unpolish(widget)
            widget.style().polish(widget)
