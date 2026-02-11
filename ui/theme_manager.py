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
                    # Colores principales
                    "background": "#FFFFFF",
                    "surface": "#F8F9FA",
                    "primary": "#2C3E50",
                    "secondary": "#34495E",
                    "accent": "#3498DB",
                    
                    # Texto
                    "text_primary": "#2C3E50",
                    "text_secondary": "#5D6D7E",
                    "text_muted": "#85929E",
                    "text_inverse": "#FFFFFF",
                    
                    # Estados
                    "success": "#27AE60",
                    "warning": "#F39C12",
                    "error": "#E74C3C",
                    "info": "#3498DB",
                    
                    # Bordes y separadores
                    "border": "#BDC3C7",
                    "border_light": "#ECF0F1",
                    "separator": "#D5DBDB",
                    
                    # Botones
                    "button_primary": "#3498DB",
                    "button_primary_hover": "#2980B9",
                    "button_secondary": "#95A5A6",
                    "button_secondary_hover": "#7F8C8D",
                    "button_success": "#27AE60",
                    "button_success_hover": "#229954",
                    "button_warning": "#F39C12",
                    "button_warning_hover": "#E67E22",
                    "button_danger": "#E74C3C",
                    "button_danger_hover": "#C0392B",
                    
                    # Inputs
                    "input_background": "#FFFFFF",
                    "input_border": "#BDC3C7",
                    "input_border_focus": "#3498DB",
                    "input_text": "#2C3E50",
                    
                    # Tablas y listas
                    "table_header": "#ECF0F1",
                    "table_row_even": "#FFFFFF",
                    "table_row_odd": "#F8F9FA",
                    "table_row_hover": "#EBF5FF",
                    "table_selected": "#D6EAF8",
                    
                    # Paneles especiales
                    "panel_info": "#EBF5FF",
                    "panel_success": "#E8F8F5",
                    "panel_warning": "#FEF9E7",
                    "panel_error": "#FDEDEC",
                    
                    # Estadísticas (contraste mejorado)
                    "stats_background": "#F8F9FA",
                    "stats_text": "#2C3E50",
                    "stats_border": "#D5DBDB"
                }
            },
            
            "dark": {
                "name": "Tema Oscuro",
                "colors": {
                    # Colores principales
                    "background": "#1E1E1E",
                    "surface": "#2D2D30",
                    "primary": "#E8E8E8",
                    "secondary": "#CCCCCC",
                    "accent": "#4FC3F7",
                    
                    # Texto
                    "text_primary": "#E8E8E8",
                    "text_secondary": "#CCCCCC",
                    "text_muted": "#999999",
                    "text_inverse": "#1E1E1E",
                    
                    # Estados
                    "success": "#4CAF50",
                    "warning": "#FF9800",
                    "error": "#F44336",
                    "info": "#2196F3",
                    
                    # Bordes y separadores
                    "border": "#404040",
                    "border_light": "#333333",
                    "separator": "#404040",
                    
                    # Botones
                    "button_primary": "#2196F3",
                    "button_primary_hover": "#1976D2",
                    "button_secondary": "#616161",
                    "button_secondary_hover": "#424242",
                    "button_success": "#4CAF50",
                    "button_success_hover": "#388E3C",
                    "button_warning": "#FF9800",
                    "button_warning_hover": "#F57C00",
                    "button_danger": "#F44336",
                    "button_danger_hover": "#D32F2F",
                    
                    # Inputs
                    "input_background": "#2D2D30",
                    "input_border": "#404040",
                    "input_border_focus": "#4FC3F7",
                    "input_text": "#E8E8E8",
                    
                    # Tablas y listas
                    "table_header": "#333333",
                    "table_row_even": "#2D2D30",
                    "table_row_odd": "#252526",
                    "table_row_hover": "#094771",
                    "table_selected": "#0E4F79",
                    
                    # Paneles especiales
                    "panel_info": "#0D47A1",
                    "panel_success": "#1B5E20",
                    "panel_warning": "#E65100",
                    "panel_error": "#B71C1C",
                    
                    # Estadísticas (contraste mejorado)
                    "stats_background": "#2D2D30",
                    "stats_text": "#E8E8E8",
                    "stats_border": "#404040"
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
        }}
        
        QWidget {{
            background-color: {colors['background']};
            color: {colors['text_primary']};
        }}
        
        /* Tabs */
        QTabWidget::pane {{
            border: 1px solid {colors['border']};
            background-color: {colors['surface']};
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
            border: 2px solid {colors['input_border']};
            border-radius: 4px;
            padding: 6px;
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
            border: 2px solid {colors['border']};
            border-radius: 5px;
            margin-top: 10px;
            padding-top: 10px;
            color: {colors['text_primary']};
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
            padding: 10px;
            border-radius: 4px;
            border: 1px solid {colors['border']};
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