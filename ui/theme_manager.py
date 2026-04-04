"""
Theme manager for the desktop application.
Provides consistent light and dark themes for Windows-focused UI.
"""

import sys
from pathlib import Path

from PyQt6.QtCore import QSettings
from PyQt6.QtGui import QFont, QFontDatabase, QGuiApplication


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
        self.font_families = self._load_font_families()
        self.themes = {
            "light": {
                "name": "Tema Claro",
                "colors": {
                    "background": "#edf3fb",
                    "surface": "#f6faff",
                    "surface_raised": "#ffffff",
                    "surface_alt": "#e5eef9",
                    "surface_hover": "#dde9f6",
                    "surface_pressed": "#d2e0ef",
                    "text_primary": "#102033",
                    "text_secondary": "#425874",
                    "text_muted": "#6f8299",
                    "text_inverse": "#f7faff",
                    "accent": "#1c5f96",
                    "accent_hover": "#2674b3",
                    "accent_soft": "rgba(28, 95, 150, 0.15)",
                    "success": "#2f7d52",
                    "success_hover": "#398f5f",
                    "warning": "#8b5a1c",
                    "warning_hover": "#9d6821",
                    "error": "#a74234",
                    "error_hover": "#ba5142",
                    "info": "#2b6aa6",
                    "border": "#c2d1e2",
                    "border_strong": "#9fb4ca",
                    "border_light": "#dce6f2",
                    "separator": "#d2deec",
                    "input_background": "#ffffff",
                    "input_background_focus": "#ffffff",
                    "input_border": "#b6c8dc",
                    "input_border_focus": "#1c5f96",
                    "selection": "rgba(28, 95, 150, 0.16)",
                    "selection_text": "#102033",
                    "table_header": "#eef4fb",
                    "table_row_even": "#ffffff",
                    "table_row_odd": "#f8fbff",
                    "table_row_hover": "#eaf2fc",
                    "table_selected": "rgba(28, 95, 150, 0.14)",
                    "panel_info": "rgba(43, 106, 166, 0.12)",
                    "panel_success": "rgba(47, 125, 82, 0.13)",
                    "panel_warning": "rgba(139, 90, 28, 0.15)",
                    "panel_error": "rgba(167, 66, 52, 0.14)",
                    "stats_background": "#f1f6fd",
                    "stats_text": "#102033",
                    "stats_border": "#c7d6e8",
                    "log_background": "#f2f7ff",
                    "dropzone_background": "#f7fbff",
                    "dropzone_hover": "#edf5ff",
                },
            },
            "dark": {
                "name": "Tema Oscuro",
                "colors": {
                    "background": "#07101a",
                    "surface": "#101c29",
                    "surface_raised": "#162535",
                    "surface_alt": "#0e1824",
                    "surface_hover": "#1c3044",
                    "surface_pressed": "#23384f",
                    "text_primary": "#e7eff8",
                    "text_secondary": "#9fb4ca",
                    "text_muted": "#7791aa",
                    "text_inverse": "#f7faff",
                    "accent": "#4b84ba",
                    "accent_hover": "#5f98ce",
                    "accent_soft": "rgba(96, 152, 206, 0.24)",
                    "success": "#367a55",
                    "success_hover": "#439265",
                    "warning": "#a16a22",
                    "warning_hover": "#b57a2a",
                    "error": "#a94a42",
                    "error_hover": "#c25a51",
                    "info": "#4d81ba",
                    "border": "#2a4055",
                    "border_strong": "#3d5d79",
                    "border_light": "#1d3144",
                    "separator": "#2a4056",
                    "input_background": "#0f1b29",
                    "input_background_focus": "#122233",
                    "input_border": "#314e67",
                    "input_border_focus": "#67a0d6",
                    "selection": "rgba(96, 152, 206, 0.3)",
                    "selection_text": "#e7eff8",
                    "table_header": "#0f1b29",
                    "table_row_even": "#152435",
                    "table_row_odd": "#102030",
                    "table_row_hover": "#1d3247",
                    "table_selected": "rgba(96, 152, 206, 0.26)",
                    "panel_info": "rgba(77, 129, 186, 0.18)",
                    "panel_success": "rgba(54, 122, 85, 0.22)",
                    "panel_warning": "rgba(161, 106, 34, 0.22)",
                    "panel_error": "rgba(169, 74, 66, 0.24)",
                    "stats_background": "#0e1a28",
                    "stats_text": "#e7eff8",
                    "stats_border": "#34536f",
                    "log_background": "#0d1926",
                    "dropzone_background": "#0f1a28",
                    "dropzone_hover": "#15283b",
                },
            },
        }

    def _load_font_family(self, relative_path):
        """Load a bundled font and return its primary family name."""
        if QGuiApplication.instance() is None:
            return None
        font_path = Path(__file__).resolve().parents[1] / relative_path
        if not font_path.exists():
            return None
        font_id = QFontDatabase.addApplicationFont(str(font_path))
        if font_id < 0:
            return None
        families = QFontDatabase.applicationFontFamilies(font_id)
        return families[0] if families else None

    def _load_font_families(self):
        """Resolve the preferred UI font families for desktop."""
        body_family = self._load_font_family("mobile-app/assets/fonts/SourceSans3-Regular.ttf")
        display_family = self._load_font_family(
            "mobile-app/assets/fonts/IBMPlexSansCondensed-Regular.ttf"
        )
        mono_family = self._load_font_family("mobile-app/assets/fonts/IBMPlexMono-Regular.ttf")
        if not mono_family:
            mono_family = self._load_font_family("mobile-app/assets/fonts/SpaceMono-Regular.ttf")
        return {
            "body": body_family or "Segoe UI Variable Text",
            "display": display_family or body_family or "Segoe UI Variable Text",
            "mono": mono_family or "Cascadia Mono",
        }

    def get_font_family(self, role="body"):
        """Return a font family for the requested semantic role."""
        return self.font_families.get(role, self.font_families["body"])

    def create_font(self, role="body", point_size=10, weight=None):
        """Create a QFont using the active semantic family."""
        font = QFont(self.get_font_family(role), point_size)
        if weight is not None:
            try:
                font.setWeight(QFont.Weight(weight))
            except Exception:
                font.setWeight(weight)
        return font

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
        body_font = self.get_font_family("body")
        display_font = self.get_font_family("display")
        mono_font = self.get_font_family("mono")
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
            font-family: '{body_font}', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
        }}

        QWidget {{
            background-color: {colors['background']};
            color: {colors['text_primary']};
            font-family: '{body_font}', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
            selection-background-color: {colors['selection']};
            selection-color: {colors['selection_text']};
        }}

        QWidget#appShell {{
            background-color: qlineargradient(
                x1:0, y1:0, x2:1, y2:1,
                stop:0 {colors['background']},
                stop:1 {colors['surface']}
            );
        }}

        QWidget#appHeader {{
            background-color: {colors['surface_raised']};
            border: 1px solid {colors['border']};
            border-radius: 16px;
        }}

        QLabel[class="appHeaderTitle"] {{
            font-family: '{display_font}', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
            font-size: 20px;
            font-weight: 700;
            color: {colors['text_primary']};
        }}

        QLabel[class="appHeaderSubtitle"] {{
            color: {colors['text_secondary']};
            font-size: 12px;
        }}

        QLabel[class="appHeaderBadge"] {{
            font-family: '{mono_font}', 'Cascadia Mono', 'Consolas', monospace;
            background-color: {colors['accent_soft']};
            border: 1px solid {colors['accent']};
            border-radius: 999px;
            padding: 3px 12px;
            color: {colors['accent']};
            font-weight: 700;
            min-width: 64px;
        }}

        QToolTip {{
            background-color: {colors['surface_raised']};
            color: {colors['text_primary']};
            border: 1px solid {colors['border_strong']};
            padding: 6px 8px;
        }}

        QTabWidget#mainTabs::pane {{
            border: 1px solid {colors['border_strong']};
            background-color: {colors['surface_raised']};
            border-radius: 18px;
            top: -1px;
        }}

        QTabWidget#mainTabs QTabBar::tab {{
            background-color: {colors['surface']};
            color: {colors['text_secondary']};
            padding: {tab_padding_v}px {tab_padding_h}px;
            min-height: {tab_min_height}px;
            margin-right: 6px;
            border: 1px solid {colors['border']};
            border-bottom: none;
            border-top-left-radius: 13px;
            border-top-right-radius: 13px;
            font-weight: 600;
        }}

        QTabWidget#mainTabs QTabBar::tab:selected {{
            background-color: {colors['surface_raised']};
            color: {colors['text_primary']};
            border-color: {colors['border_strong']};
            border-bottom: 2px solid {colors['accent']};
        }}

        QTabWidget#mainTabs QTabBar::tab:hover {{
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

        QPushButton[class="quickAction"] {{
            text-align: left;
            padding: 14px 16px;
            border-radius: 14px;
            min-height: 64px;
            background-color: {colors['surface']};
            border: 1px solid {colors['border']};
            font-family: '{display_font}', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: 700;
            line-height: 1.35em;
        }}

        QPushButton[class="quickAction"]:hover {{
            background-color: {colors['surface_hover']};
            border-color: {colors['accent']};
        }}

        QPushButton#teamActionButton {{
            min-height: 72px;
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
            font-family: '{mono_font}', 'Cascadia Mono', 'Consolas', monospace;
            font-weight: 700;
        }}

        QGroupBox {{
            font-weight: 700;
            border: 1px solid {colors['border']};
            border-radius: 15px;
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
            font-family: '{display_font}', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
        }}

        QLabel {{
            color: {colors['text_primary']};
            background-color: transparent;
        }}

        QLabel[class="heroTitle"] {{
            font-family: '{display_font}', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
            font-size: 22px;
            font-weight: 700;
            color: {colors['text_primary']};
        }}

        QLabel[class="sectionTitle"] {{
            font-family: '{display_font}', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
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
            font-family: '{mono_font}', 'Cascadia Mono', 'Consolas', monospace;
            background-color: {colors['surface_alt']};
            color: {colors['text_secondary']};
            border: 1px solid {colors['border']};
            border-radius: 999px;
            padding: 4px 10px;
        }}

        QWidget#driversHeroStrip {{
            background-color: transparent;
        }}

        QWidget#driversMetricCard {{
            background-color: {colors['surface_raised']};
            border: 1px solid {colors['border']};
            border-radius: 18px;
        }}

        QWidget#driversMetricCard:hover {{
            border-color: {colors['border_strong']};
            background-color: {colors['surface']};
        }}

        QLabel[class="metricValue"] {{
            font-family: '{display_font}', 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
            font-size: 15px;
            font-weight: 700;
            color: {colors['text_primary']};
        }}

        QLabel[class="metricMeta"] {{
            color: {colors['text_secondary']};
            font-size: 12px;
        }}

        QGroupBox#driversCatalogPanel, QGroupBox#driversDetailPanel {{
            border-radius: 18px;
        }}

        QListWidget#driversCatalogList {{
            border-radius: 14px;
            padding: 6px;
        }}

        QListWidget#driversCatalogList::item {{
            min-height: 24px;
            margin: 2px 0;
            border-radius: 10px;
        }}

        QTextEdit#driverDetailsPane {{
            border-radius: 16px;
            padding: 14px;
        }}

        QPushButton#driverDownloadButton {{
            min-height: 42px;
        }}

        QPushButton#driverInstallButton {{
            min-height: 46px;
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
            font-family: '{mono_font}', 'Cascadia Mono', 'Consolas', monospace;
            font-size: 11px;
        }}

        QTextEdit[class="logPanel"] {{
            background-color: {colors['log_background']};
            color: {colors['text_primary']};
            border: 1px solid {colors['stats_border']};
            border-radius: 12px;
            padding: 12px;
            font-family: '{mono_font}', 'Cascadia Mono', 'Consolas', monospace;
            font-size: 11px;
        }}

        QProgressBar {{
            background-color: {colors['surface_alt']};
            color: {colors['text_primary']};
            border: 1px solid {colors['border']};
            border-radius: 7px;
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
