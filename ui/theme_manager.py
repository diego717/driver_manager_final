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
                    "secondary": "#445264",   # --text-secondary
                    "accent": "#0b6d66",      # --accent-primary
                    
                    # Texto
                    "text_primary": "#1a1d23",
                    "text_secondary": "#445264",
                    "text_muted": "#6d7890",
                    "text_inverse": "#ffffff",
                    
                    # Estados
                    "success": "#0d9f6e",
                    "warning": "#d97706",
                    "error": "#dc2626",
                    "info": "#2563eb",
                    
                    # Bordes y separadores
                    "border": "#cfd6df",
                    "border_light": "#eceff4", # --bg-card
                    "separator": "#dbe2ea",    # --bg-hover
                    
                    # Botones
                    "button_primary": "#0b6d66",
                    "button_primary_hover": "#16a39a", # --accent-secondary
                    "button_secondary": "#eceff4",
                    "button_secondary_hover": "#dbe2ea",
                    "button_success": "#0d9f6e",
                    "button_success_hover": "#10b981",
                    "button_warning": "#d97706",
                    "button_warning_hover": "#f59e0b",
                    "button_danger": "#dc2626",
                    "button_danger_hover": "#ef4444",
                    
                    # Inputs
                    "input_background": "#ffffff",
                    "input_border": "#cfd6df",
                    "input_border_focus": "#0b6d66",
                    "input_text": "#1a1d23",
                    
                    # Tablas y listas
                    "table_header": "#f5f7fa",
                    "table_row_even": "#ffffff",
                    "table_row_odd": "#f5f7fa",
                    "table_row_hover": "#e4e7ec",
                    "table_selected": "rgba(11, 109, 102, 0.14)", # --sidebar-active-bg
                    
                    # Paneles especiales (con alpha blends sugeridos)
                    "panel_info": "rgba(37, 99, 235, 0.12)",
                    "panel_success": "rgba(13, 159, 110, 0.12)",
                    "panel_warning": "rgba(217, 119, 6, 0.12)",
                    "panel_error": "rgba(220, 38, 38, 0.12)",
                    
                    # Estadísticas (contraste mejorado)
                    "stats_background": "#ffffff",
                    "stats_text": "#1a1d23",
                    "stats_border": "#cfd6df"
                }
            },
            
            "dark": {
                "name": "Tema Oscuro",
                "colors": {
                    # Colores principales (Stitch v1)
                    "background": "#0f1117",  # --bg-primary
                    "surface": "#1a1d27",     # --bg-secondary
                    "primary": "#eef0f4",     # --text-primary
                    "secondary": "#a4afc1",   # --text-secondary
                    "accent": "#1ab3a7",      # --accent-primary
                    
                    # Texto
                    "text_primary": "#eef0f4",
                    "text_secondary": "#a4afc1",
                    "text_muted": "#778199",
                    "text_inverse": "#0f1117",
                    
                    # Estados
                    "success": "#10b981",
                    "warning": "#f59e0b",
                    "error": "#ef4444",
                    "info": "#3b82f6",
                    
                    # Bordes y separadores
                    "border": "#3b4353",
                    "border_light": "#262c38", # --bg-card
                    "separator": "#333a48",    # --bg-hover
                    
                    # Botones
                    "button_primary": "#1ab3a7",
                    "button_primary_hover": "#35d9c8", # equivalent --accent-secondary/gradient
                    "button_secondary": "#262c38",
                    "button_secondary_hover": "#333a48",
                    "button_success": "#10b981",
                    "button_success_hover": "#34d399",
                    "button_warning": "#f59e0b",
                    "button_warning_hover": "#fbbf24",
                    "button_danger": "#ef4444",
                    "button_danger_hover": "#f87171",
                    
                    # Inputs
                    "input_background": "#1a1d27",
                    "input_border": "#3b4353",
                    "input_border_focus": "#1ab3a7",
                    "input_text": "#eef0f4",
                    
                    # Tablas y listas
                    "table_header": "#0f1117",
                    "table_row_even": "#1a1d27",
                    "table_row_odd": "#0f1117",
                    "table_row_hover": "#333a48",
                    "table_selected": "rgba(26, 179, 167, 0.22)", # --sidebar-active-bg
                    
                    # Paneles especiales
                    "panel_info": "rgba(59, 130, 246, 0.15)",
                    "panel_success": "rgba(16, 185, 129, 0.15)",
                    "panel_warning": "rgba(245, 158, 11, 0.15)",
                    "panel_error": "rgba(239, 68, 68, 0.15)",
                    
                    # Estadísticas (contraste mejorado)
                    "stats_background": "#1a1d27",
                    "stats_text": "#eef0f4",
                    "stats_border": "#3b4353"
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
            font-family: 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
        }}
        
        QWidget {{
            background-color: {colors['background']};
            color: {colors['text_primary']};
            font-family: 'Segoe UI Variable Text', 'Segoe UI', sans-serif;
        }}
        
        /* Tabs */
        QTabWidget::pane {{
            border: 1px solid {colors['border']};
            background-color: {colors['surface']};
            border-radius: 14px;
        }}
        
        QTabBar::tab {{
            background-color: {colors['surface']};
            color: {colors['text_secondary']};
            padding: 9px 18px;
            margin-right: 2px;
            border: 1px solid {colors['border']};
            border-bottom: none;
            border-top-left-radius: 10px;
            border-top-right-radius: 10px;
            font-weight: 600;
        }}
        
        QTabBar::tab:selected {{
            background-color: {colors['button_primary']};
            color: {colors['text_inverse']};
            font-weight: 700;
            border-color: {colors['button_primary']};
        }}
        
        QTabBar::tab:hover {{
            background-color: {colors['panel_info']};
            color: {colors['text_primary']};
        }}
        
        /* Botones */
        QPushButton {{
            background-color: {colors['button_secondary']};
            color: {colors['text_primary']};
            border: 1px solid {colors['border']};
            padding: 9px 16px;
            border-radius: 10px;
            font-weight: 600;
            min-height: 38px;
        }}
        
        QPushButton:hover {{
            background-color: {colors['button_secondary_hover']};
            border-color: {colors['input_border_focus']};
        }}
        
        QPushButton:pressed {{
            background-color: {colors['separator']};
        }}
        
        QPushButton:disabled {{
            background-color: {colors['button_secondary']};
            color: {colors['text_muted']};
            border-color: {colors['border']};
        }}

        QPushButton:focus {{
            border: 2px solid {colors['input_border_focus']};
        }}

        QPushButton[class="primary"] {{
            background-color: {colors['button_primary']};
            color: {colors['text_inverse']};
            border: 1px solid {colors['button_primary']};
            font-weight: 700;
        }}

        QPushButton[class="primary"]:hover {{
            background-color: {colors['button_primary_hover']};
            border: 1px solid {colors['button_primary_hover']};
        }}
        
        /* Botones de éxito */
        QPushButton[class="success"] {{
            background-color: {colors['button_success']};
            color: {colors['text_inverse']};
            border: 1px solid {colors['button_success']};
        }}
        
        QPushButton[class="success"]:hover {{
            background-color: {colors['button_success_hover']};
        }}
        
        /* Botones de advertencia */
        QPushButton[class="warning"] {{
            background-color: {colors['button_warning']};
            color: {colors['text_inverse']};
            border: 1px solid {colors['button_warning']};
        }}
        
        QPushButton[class="warning"]:hover {{
            background-color: {colors['button_warning_hover']};
        }}
        
        /* Botones de peligro */
        QPushButton[class="danger"] {{
            background-color: {colors['button_danger']};
            color: {colors['text_inverse']};
            border: 1px solid {colors['button_danger']};
        }}
        
        QPushButton[class="danger"]:hover {{
            background-color: {colors['button_danger_hover']};
        }}

        QPushButton[class="info"] {{
            background-color: {colors['panel_info']};
            color: {colors['text_primary']};
            border: 1px solid {colors['info']};
            font-weight: 600;
        }}

        QPushButton[class="info"]:hover {{
            background-color: {colors['info']};
            color: {colors['text_inverse']};
            border: 1px solid {colors['info']};
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
            border-width: 2px;
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
            padding: 6px;
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
            padding: 9px;
            border: 1px solid {colors['border']};
            font-weight: 700;
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
