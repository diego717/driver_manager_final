"""
Manejadores de reportes para Driver Manager
"""

import os
import json
import subprocess
import platform
from pathlib import Path
from datetime import datetime
from PyQt6.QtWidgets import QMessageBox, QFileDialog


class ReportHandlers:
    """Clase que maneja todos los reportes y exportaciones"""
    
    def __init__(self, main_window):
        self.main = main_window
    
    def generate_daily_report_simple(self):
        """Generar reporte del día de hoy"""
        try:
            self.main.statusBar().showMessage("📄 Generando reporte diario...")
            report_path = self.main.report_gen.generate_daily_report()
            self.main.statusBar().showMessage("✅ Reporte generado")
            
            msg = QMessageBox(self.main)
            msg.setIcon(QMessageBox.Icon.Information)
            msg.setWindowTitle("Reporte Generado")
            msg.setText("✅ Reporte diario generado exitosamente")
            msg.setInformativeText(
                f"El reporte se guardó en:\n{report_path}\n\n"
                "¿Deseas abrir el archivo ahora?"
            )
            msg.setStandardButtons(
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )
            
            if msg.exec() == QMessageBox.StandardButton.Yes:
                self._open_file(report_path)
        
        except Exception as e:
            self.main.statusBar().showMessage("❌ Error generando reporte")
            QMessageBox.critical(
                self.main,
                "Error",
                f"Error al generar reporte:\n{str(e)}"
            )
    
    def generate_monthly_report_simple(self):
        """Generar reporte mensual"""
        try:
            month = self.main.history_tab.report_month_combo.currentIndex() + 1
            year = int(self.main.history_tab.report_year_combo.currentText())
            
            self.main.statusBar().showMessage(f"📄 Generando reporte de {self.main.history_tab.report_month_combo.currentText()} {year}...")
            report_path = self.main.report_gen.generate_monthly_report(year, month)
            self.main.statusBar().showMessage("✅ Reporte generado")
            
            msg = QMessageBox(self.main)
            msg.setIcon(QMessageBox.Icon.Information)
            msg.setWindowTitle("Reporte Generado")
            msg.setText(f"✅ Reporte de {self.main.history_tab.report_month_combo.currentText()} {year} generado")
            msg.setInformativeText(
                f"El reporte se guardó en:\n{report_path}\n\n"
                "¿Deseas abrir el archivo ahora?"
            )
            msg.setStandardButtons(
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )
            
            if msg.exec() == QMessageBox.StandardButton.Yes:
                self._open_file(report_path)
        
        except Exception as e:
            self.main.statusBar().showMessage("❌ Error generando reporte")
            QMessageBox.critical(self.main, "Error", f"Error al generar reporte:\n{str(e)}")
    
    def export_history_json(self):
        """Exportar historial completo a JSON"""
        try:
            default_path = Path.home() / "Downloads" / f"historial_export_{datetime.now().strftime('%Y%m%d')}.json"
            
            file_path, _ = QFileDialog.getSaveFileName(
                self.main,
                "Exportar Historial",
                str(default_path),
                "JSON Files (*.json);;All Files (*.*)"
            )
            
            if file_path:
                self.main.statusBar().showMessage("💾 Exportando historial...")
                self.main.history.export_to_json(file_path)
                self.main.statusBar().showMessage("✅ Historial exportado")
                
                QMessageBox.information(
                    self.main,
                    "Exportación Completa",
                    f"✅ Historial exportado exitosamente\n\n"
                    f"Archivo: {file_path}"
                )
        
        except Exception as e:
            self.main.statusBar().showMessage("❌ Error exportando")
            QMessageBox.critical(self.main, "Error", f"Error al exportar:\n{str(e)}")
    
    def export_audit_log(self):
        """Exportar log de auditoría a archivo"""
        try:
            logs = self.main.history.get_audit_log(limit=1000)
            
            if not logs:
                QMessageBox.information(
                    self.main,
                    "Log Vacío",
                    "No hay registros en el log de auditoría para exportar."
                )
                return
            
            default_path = Path.home() / "Downloads" / f"audit_log_{datetime.now().strftime('%Y%m%d')}.txt"
            
            file_path, _ = QFileDialog.getSaveFileName(
                self.main,
                "Exportar Log de Auditoría",
                str(default_path),
                "Text Files (*.txt);;All Files (*.*)"
            )
            
            if file_path:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write("="*80 + "\n")
                    f.write("LOG DE AUDITORÍA - DRIVER MANAGER\n")
                    f.write(f"Exportado: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
                    f.write("="*80 + "\n\n")
                    
                    for log in logs:
                        timestamp = datetime.fromisoformat(log['timestamp'])
                        f.write(f"Fecha: {timestamp.strftime('%d/%m/%Y %H:%M:%S')}\n")
                        f.write(f"Usuario: {log['user']}\n")
                        f.write(f"Acción: {log['action']}\n")
                        f.write(f"Detalles: {log['details']}\n")
                        f.write(f"Items eliminados: {log['items_deleted']}\n")
                        f.write(f"Computadora: {log.get('computer_name', 'N/A')}\n")
                        f.write("-"*80 + "\n\n")
                
                QMessageBox.information(
                    self.main,
                    "Log Exportado",
                    f"✅ Log de auditoría exportado\n\nArchivo: {file_path}"
                )
        except Exception as e:
            QMessageBox.critical(self.main, "Error", f"Error al exportar log:\n{str(e)}")
    
    def _open_file(self, file_path):
        """Abrir archivo con la aplicación predeterminada del sistema"""
        try:
            if platform.system() == 'Windows':
                os.startfile(file_path)
            elif platform.system() == 'Darwin':
                subprocess.run(['open', file_path])
            else:
                subprocess.run(['xdg-open', file_path])
        except Exception as e:
            QMessageBox.warning(
                self.main,
                "Error al abrir archivo",
                f"No se pudo abrir el archivo automáticamente:\n{str(e)}\n\n"
                f"Ubicación: {file_path}"
            )