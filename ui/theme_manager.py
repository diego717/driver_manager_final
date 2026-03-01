"""
Gestor de Temas para Driver Manager
Proporciona temas claro y oscuro con contrastes optimizados
"""

import json
from pathlib import Path
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QSettings

class ThemeManager:
    """Gestor de temas de la aplicación"""
    
    def __init__(self):
        self.settings = QSettings("DriverManager", "Themes")
        self.current_theme = self.settings.value("current_theme", "light")
        
        # Definir paletas de colores
        self.themes = {
            "light": {
                "name": "Tema Claro",
                "colors": {
                    # Colores principales (Stitch v1)
                    "background": "#f5f7fa",  # --bg-primary
                    "surface": "#ffffff",     # --bg-secondary
                    "primary": "#1a1d23",     # --text-primary
                    "secondary": "#5f6b7a",   # --text-secondary
                    "accent": "#0f756d",      # --accent-primary
                    
                    # Texto
                    "text_primary": "#1a1d23",
                    "text_secondary": "#5f6b7a",
                    "text_muted": "#8b93a5",
                    "text_inverse": "#ffffff",
                    
                    # Estados
                    "success": "#0d9f6e",
                    "warning": "#d97706",
                    "error": "#dc2626",
                    "info": "#2563eb",
                    
                    # Bordes y separadores
                    "border": "#dce1e8",
                    "border_light": "#f0f2f5", # --bg-card
                    "separator": "#e4e7ec",    # --bg-hover
                    
                    # Botones
                    "button_primary": "#0f756d",
                    "button_primary_hover": "#14a89e", # --accent-secondary
                    "button_secondary": "#e4e7ec",
                    "button_secondary_hover": "#dce1e8",
                    "button_success": "#0d9f6e",
                    "button_success_hover": "#10b981",
                    "button_warning": "#d97706",
                    "button_warning_hover": "#f59e0b",
                    "button_danger": "#dc2626",
                    "button_danger_hover": "#ef4444",
                    
                    # Inputs
                    "input_background": "#ffffff",
                    "input_border": "#dce1e8",
                    "input_border_focus": "#0f756d",
                    "input_text": "#1a1d23",
                    
                    # Tablas y listas
                    "table_header": "#f5f7fa",
                    "table_row_even": "#ffffff",
                    "table_row_odd": "#f5f7fa",
                    "table_row_hover": "#e4e7ec",
                    "table_selected": "rgba(15, 117, 109, 0.08)", # --sidebar-active-bg
                    
                    # Paneles especiales (con alpha blends sugeridos)
                    "panel_info": "rgba(37, 99, 235, 0.1)",
                    "panel_success": "rgba(13, 159, 110, 0.1)",
                    "panel_warning": "rgba(217, 119, 6, 0.1)",
                    "panel_error": "rgba(220, 38, 38, 0.1)",
                    
                    # Estadísticas (contraste mejorado)
                    "stats_background": "#ffffff",
                    "stats_text": "#1a1d23",
                    "stats_border": "#dce1e8"
                }
            },
            
            "dark": {
                "name": "Tema Oscuro",
                "colors": {
                    # Colores principales (Stitch v1)
                    "background": "#0f1117",  # --bg-primary
                    "surface": "#1a1d27",     # --bg-secondary
                    "primary": "#eef0f4",     # --text-primary
                    "secondary": "#8b93a5",   # --text-secondary
                    "accent": "#14a89e",      # --accent-primary
                    
                    # Texto
                    "text_primary": "#eef0f4",
                    "text_secondary": "#8b93a5",
                    "text_muted": "#5f6b7a",
                    "text_inverse": "#0f1117",
                    
                    # Estados
                    "success": "#10b981",
                    "warning": "#f59e0b",
                    "error": "#ef4444",
                    "info": "#3b82f6",
                    
                    # Bordes y separadores
                    "border": "#2e3240",
                    "border_light": "#242833", # --bg-card
                    "separator": "#2e3240",    # --bg-hover
                    
                    # Botones
                    "button_primary": "#14a89e",
                    "button_primary_hover": "#2dd4c0", # equivalent --accent-secondary/gradient
                    "button_secondary": "#242833",
                    "button_secondary_hover": "#2e3240",
                    "button_success": "#10b981",
                    "button_success_hover": "#34d399",
                    "button_warning": "#f59e0b",
                    "button_warning_hover": "#fbbf24",
                    "button_danger": "#ef4444",
                    "button_danger_hover": "#f87171",
                    
                    # Inputs
                    "input_background": "#1a1d27",
                    "input_border": "#2e3240",
                    "input_border_focus": "#14a89e",
                    "input_text": "#eef0f4",
                    
                    # Tablas y listas
                    "table_header": "#0f1117",
                    "table_row_even": "#1a1d27",
                    "table_row_odd": "#0f1117",
                    "table_row_hover": "#2e3240",
                    "table_selected": "rgba(20, 168, 158, 0.12)", # --sidebar-active-bg
                    
                    # Paneles especiales
                    "panel_info": "rgba(59, 130, 246, 0.15)",
                    "panel_success": "rgba(16, 185, 129, 0.15)",
                    "panel_warning": "rgba(245, 158, 11, 0.15)",
                    "panel_error": "rgba(239, 68, 68, 0.15)",
                    
                    # Estadísticas (contraste mejorado)
                    "stats_background": "#1a1d27",
                    "stats_text": "#eef0f4",
                    "stats_border": "#2e3240"
                }
            }
        }
    
    def get_current_theme(self):
        """Obtener tema actual"""
        return self.current_theme
    
    def set_theme(self, theme_name):
        """Cambiar tema"""
        if theme_name in self.themes:
            self.current_theme = theme_name
            self.settings.setValue("current_theme", theme_name)
            return True
        return False
    
    def get_color(self, color_name):
        """Obtener color del tema actual"""
        return self.themes[self.current_theme]["colors"].get(color_name, "#000000")
    
    def get_theme_names(self):
        """Obtener nombres de temas disponibles"""
        return [(key, theme["name"]) for key, theme in self.themes.items()]
    
    def generate_stylesheet(self):
        """Generar stylesheet completo para la aplicación"""
        colors = self.themes[self.current_theme]["colors"]
        
        return f"""
        /* Estilo general de la aplicación */
        QMainWindow {{
            background-color: {colors['background']};
            color: {colors['text_primary']};
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }}
        
        QWidget {{
            background-color: {colors['background']};
            color: {colors['text_primary']};
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }}
        
        /* Tabs */
        QTabWidget::pane {{
            border: 1px solid {colors['border']};
            background-color: {colors['surface']};
            border-radius: 12px;
        }}
        
        QTabBar::tab {{
            background-color: {colors['surface']};
            color: {colors['text_secondary']};
            padding: 8px 16px;
            margin-right: 2px;
            border: 1px solid {colors['border']};
            border-bottom: none;
        }}
        
        QTabBar::tab:selected {{
            background-color: {colors['background']};
            color: {colors['text_primary']};
            font-weight: bold;
        }}
        
        QTabBar::tab:hover {{
            background-color: {colors['panel_info']};
        }}
        
        /* Botones */
        QPushButton {{
            background-color: {colors['button_primary']};
            color: {colors['text_inverse']};
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            font-weight: bold;
        }}
        
        QPushButton:hover {{
            background-color: {colors['button_primary_hover']};
        }}
        
        QPushButton:pressed {{
            background-color: {colors['button_primary_hover']};
        }}
        
        QPushButton:disabled {{
            background-color: {colors['button_secondary']};
            color: {colors['text_muted']};
        }}
        
        /* Botones de éxito */
        QPushButton[class="success"] {{
            background-color: {colors['button_success']};
        }}
        
        QPushButton[class="success"]:hover {{
            background-color: {colors['button_success_hover']};
        }}
        
        /* Botones de advertencia */
        QPushButton[class="warning"] {{
            background-color: {colors['button_warning']};
        }}
        
        QPushButton[class="warning"]:hover {{
            background-color: {colors['button_warning_hover']};
        }}
        
        /* Botones de peligro */
        QPushButton[class="danger"] {{
            background-color: {colors['button_danger']};
        }}
        
        QPushButton[class="danger"]:hover {{
            background-color: {colors['button_danger_hover']};
        }}
        
        /* Inputs */
        QLineEdit, QTextEdit, QComboBox {{
            background-color: {colors['input_background']};
            color: {colors['input_text']};
            border: 1px solid {colors['input_border']};
            border-radius: 8px;
            padding: 8px 12px;
        }}
        
        QLineEdit:focus, QTextEdit:focus, QComboBox:focus {{
            border-color: {colors['input_border_focus']};
        }}
        
        /* Listas y tablas */
        QListWidget, QTableWidget {{
            background-color: {colors['input_background']};
            color: {colors['text_primary']};
            border: 1px solid {colors['border']};
            alternate-background-color: {colors['table_row_odd']};
            border-radius: 12px;
        }}
        
        QListWidget::item, QTableWidget::item {{
            padding: 4px;
            border-bottom: 1px solid {colors['border_light']};
        }}
        
        QListWidget::item:selected, QTableWidget::item:selected {{
            background-color: {colors['table_selected']};
        }}
        
        QListWidget::item:hover, QTableWidget::item:hover {{
            background-color: {colors['table_row_hover']};
        }}
        
        QHeaderView::section {{
            background-color: {colors['table_header']};
            color: {colors['text_primary']};
            padding: 8px;
            border: 1px solid {colors['border']};
            font-weight: bold;
        }}
        
        /* GroupBox */
        QGroupBox {{
            font-weight: bold;
            border: 1px solid {colors['border']};
            border-radius: 12px;
            margin-top: 12px;
            padding-top: 12px;
            color: {colors['text_primary']};
            background-color: {colors['surface']};
        }}
        
        QGroupBox::title {{
            subcontrol-origin: margin;
            left: 10px;
            padding: 0 5px;
            color: {colors['text_primary']};
        }}
        
        /* Labels */
        QLabel {{
            color: {colors['text_primary']};
        }}
        
        /* Estadísticas mejoradas */
        QTextEdit[class="stats"] {{
            background-color: {colors['stats_background']};
            color: {colors['stats_text']};
            border: 2px solid {colors['stats_border']};
            border-radius: 6px;
            padding: 12px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 11px;
            font-weight: bold;
        }}
        
        /* Paneles de información */
        QLabel[class="info"] {{
            background-color: {colors['panel_info']};
            color: {colors['text_primary']};
            padding: 12px;
            border-radius: 8px;
            border: 1px solid {colors['info']};
        }}
        
        QLabel[class="success"] {{
            background-color: {colors['panel_success']};
            color: {colors['text_primary']};
            padding: 10px;
            border-radius: 4px;
        }}
        
        QLabel[class="warning"] {{
            background-color: {colors['panel_warning']};
            color: {colors['text_primary']};
            padding: 10px;
            border-radius: 4px;
        }}
        
        QLabel[class="error"] {{
            background-color: {colors['panel_error']};
            color: {colors['text_primary']};
            padding: 10px;
            border-radius: 4px;
        }}
        
        /* Scrollbars */
        QScrollBar:vertical {{
            background-color: {colors['surface']};
            width: 12px;
            border-radius: 6px;
        }}
        
        QScrollBar::handle:vertical {{
            background-color: {colors['button_secondary']};
            border-radius: 6px;
            min-height: 20px;
        }}
        
        QScrollBar::handle:vertical:hover {{
            background-color: {colors['button_secondary_hover']};
        }}
        
        /* Progress Bar */
        QProgressBar {{
            border: 1px solid {colors['border']};
            border-radius: 4px;
            text-align: center;
            color: {colors['text_primary']};
        }}
        
        QProgressBar::chunk {{
            background-color: {colors['accent']};
            border-radius: 3px;
        }}
        
        /* Status Bar */
        QStatusBar {{
            background-color: {colors['surface']};
            color: {colors['text_secondary']};
            border-top: 1px solid {colors['border']};
        }}
        """
    
    def apply_theme_to_widget(self, widget, widget_class=None):
        """Aplicar clase CSS específica a un widget"""
        if widget_class:
            widget.setProperty("class", widget_class)
            widget.style().unpolish(widget)
            widget.style().polish(widget)