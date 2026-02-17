"""
Manejadores de reportes para Driver Manager.
"""

import os
import platform
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

from PyQt6.QtWidgets import QFileDialog, QMessageBox


class ReportHandlers:
    """Clase que maneja reportes y exportaciones."""

    def __init__(self, main_window):
        self.main = main_window

    def refresh_reports_preview(self, last_report_path=None, report_kind=None):
        """Actualizar vista previa de reportes."""
        history_tab = getattr(self.main, "history_tab", None)
        if history_tab is None:
            return

        preview = getattr(history_tab, "report_preview", None)
        if preview is None:
            return

        try:
            now = datetime.now()

            day_start_dt = now.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end_dt = day_start_dt + timedelta(days=1)
            day_stats = self.main.history.get_statistics(
                start_date=day_start_dt.isoformat(),
                end_date=day_end_dt.isoformat(),
            ) or {}

            month = history_tab.report_month_combo.currentIndex() + 1
            year = int(history_tab.report_year_combo.currentText())
            month_start_dt = datetime(year, month, 1)
            month_end_dt = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
            month_stats = self.main.history.get_statistics(
                start_date=month_start_dt.isoformat(),
                end_date=month_end_dt.isoformat(),
            ) or {}

            year_start_dt = datetime(year, 1, 1)
            year_end_dt = datetime(year + 1, 1, 1)
            year_stats = self.main.history.get_statistics(
                start_date=year_start_dt.isoformat(),
                end_date=year_end_dt.isoformat(),
            ) or {}

            month_name = history_tab.report_month_combo.currentText()

            # Colores según el tema
            is_dark = self.main.theme_manager.get_current_theme() == "dark"
            text_color = "#E8E8E8" if is_dark else "#2C3E50"
            border_color = "#404040" if is_dark else "#CCCCCC"
            accent_color = "#4FC3F7" if is_dark else "#3498DB"
            bg_last = "#0D47A1" if is_dark else "#EBF5FF"

            html = f"""
            <div style="font-family: Arial, sans-serif; color: {text_color};">
                <h3 style="margin: 0; color: {accent_color};">Resumen rápido para reportes</h3>
                <hr style="border: 0; border-top: 1px solid {border_color}; margin: 10px 0;">

                <table width="100%" style="border-collapse: collapse;">
                    <tr style="border-bottom: 1px solid {border_color};">
                        <th align="left" style="padding: 4px;">Período</th>
                        <th align="center" style="padding: 4px;">Total</th>
                        <th align="center" style="padding: 4px; color: #4CAF50;">✓</th>
                        <th align="center" style="padding: 4px; color: #F44336;">✗</th>
                    </tr>
                    <tr style="border-bottom: 1px solid {border_color};">
                        <td style="padding: 4px;"><b>Hoy</b></td>
                        <td align="center">{day_stats.get('total_installations', 0)}</td>
                        <td align="center">{day_stats.get('successful_installations', 0)}</td>
                        <td align="center">{day_stats.get('failed_installations', 0)}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid {border_color};">
                        <td style="padding: 4px;"><b>{month_name} {year}</b></td>
                        <td align="center">{month_stats.get('total_installations', 0)}</td>
                        <td align="center">{month_stats.get('successful_installations', 0)}</td>
                        <td align="center">{month_stats.get('failed_installations', 0)}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid {border_color};">
                        <td style="padding: 4px;"><b>Año {year}</b></td>
                        <td align="center">{year_stats.get('total_installations', 0)}</td>
                        <td align="center">{year_stats.get('successful_installations', 0)}</td>
                        <td align="center">{year_stats.get('failed_installations', 0)}</td>
                    </tr>
                </table>

                <p style="margin-top: 15px; color: gray; font-size: 11px;">
                    💡 <i>Los reportes se guardan en la carpeta Descargas.</i>
                </p>
            """

            if last_report_path:
                label = (report_kind or "Reporte").lower()
                html += f"""
                <div style="margin-top: 10px; padding: 8px; background-color: {bg_last}; border-left: 4px solid {accent_color}; border-radius: 4px;">
                    <b style="color: {accent_color};">Último {label} generado:</b><br>
                    <small style="word-break: break-all;">{last_report_path}</small>
                </div>
                """

            html += "</div>"
            preview.setHtml(html)
        except Exception as e:
            preview.setHtml(f"<p style='color: red;'>No se pudo cargar la vista previa de reportes.<br><br>Detalle: {e}</p>")

    def generate_daily_report_simple(self):
        """Generar reporte del dia actual."""
        try:
            self.main.statusBar().showMessage("Generando reporte diario...")
            report_path = self.main.report_gen.generate_daily_report()
            self.refresh_reports_preview(last_report_path=report_path, report_kind="Reporte diario")
            self.main.statusBar().showMessage("Reporte generado")

            msg = QMessageBox(self.main)
            msg.setIcon(QMessageBox.Icon.Information)
            msg.setWindowTitle("Reporte Generado")
            msg.setText("Reporte diario generado exitosamente")
            msg.setInformativeText(
                f"El reporte se guardo en:\n{report_path}\n\n"
                "Deseas abrir el archivo ahora?"
            )
            msg.setStandardButtons(
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )

            if msg.exec() == QMessageBox.StandardButton.Yes:
                self._open_file(report_path)

        except Exception as e:
            self.main.statusBar().showMessage("Error generando reporte")
            QMessageBox.critical(self.main, "Error", f"Error al generar reporte:\n{e}")

    def generate_monthly_report_simple(self):
        """Generar reporte del mes seleccionado."""
        try:
            month = self.main.history_tab.report_month_combo.currentIndex() + 1
            year = int(self.main.history_tab.report_year_combo.currentText())
            month_name = self.main.history_tab.report_month_combo.currentText()

            self.main.statusBar().showMessage(f"Generando reporte del mes {month_name} {year}...")
            report_path = self.main.report_gen.generate_monthly_report(year, month)
            self.refresh_reports_preview(last_report_path=report_path, report_kind="Reporte mensual")
            self.main.statusBar().showMessage("Reporte generado")

            msg = QMessageBox(self.main)
            msg.setIcon(QMessageBox.Icon.Information)
            msg.setWindowTitle("Reporte Generado")
            msg.setText(f"Reporte de {month_name} {year} generado")
            msg.setInformativeText(
                f"El reporte se guardo en:\n{report_path}\n\n"
                "Deseas abrir el archivo ahora?"
            )
            msg.setStandardButtons(
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )

            if msg.exec() == QMessageBox.StandardButton.Yes:
                self._open_file(report_path)

        except Exception as e:
            self.main.statusBar().showMessage("Error generando reporte")
            QMessageBox.critical(self.main, "Error", f"Error al generar reporte:\n{e}")

    def generate_yearly_report_simple(self):
        """Generar reporte anual para el ano seleccionado."""
        try:
            year = int(self.main.history_tab.report_year_combo.currentText())

            self.main.statusBar().showMessage(f"Generando reporte anual {year}...")
            report_path = self.main.report_gen.generate_yearly_report(year)
            self.refresh_reports_preview(last_report_path=report_path, report_kind="Reporte anual")
            self.main.statusBar().showMessage("Reporte generado")

            msg = QMessageBox(self.main)
            msg.setIcon(QMessageBox.Icon.Information)
            msg.setWindowTitle("Reporte Generado")
            msg.setText(f"Reporte anual {year} generado")
            msg.setInformativeText(
                f"El reporte se guardo en:\n{report_path}\n\n"
                "Deseas abrir el archivo ahora?"
            )
            msg.setStandardButtons(
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )

            if msg.exec() == QMessageBox.StandardButton.Yes:
                self._open_file(report_path)

        except Exception as e:
            self.main.statusBar().showMessage("Error generando reporte")
            QMessageBox.critical(self.main, "Error", f"Error al generar reporte:\n{e}")

    def export_history_json(self):
        """Exportar historial completo a JSON."""
        try:
            default_path = Path.home() / "Downloads" / f"historial_export_{datetime.now().strftime('%Y%m%d')}.json"

            file_path, _ = QFileDialog.getSaveFileName(
                self.main,
                "Exportar Historial",
                str(default_path),
                "JSON Files (*.json);;All Files (*.*)",
            )

            if file_path:
                self.main.statusBar().showMessage("Exportando historial...")
                self.main.history.export_to_json(file_path)
                self.main.statusBar().showMessage("Historial exportado")

                QMessageBox.information(
                    self.main,
                    "Exportacion Completa",
                    f"Historial exportado exitosamente\n\nArchivo: {file_path}",
                )

        except Exception as e:
            self.main.statusBar().showMessage("Error exportando")
            QMessageBox.critical(self.main, "Error", f"Error al exportar:\n{e}")

    def export_audit_log(self):
        """Exportar log de auditoria a archivo."""
        try:
            logs = self.main.history.get_audit_log(limit=1000)

            if not logs:
                QMessageBox.information(
                    self.main,
                    "Log Vacio",
                    "No hay registros en el log de auditoria para exportar.",
                )
                return

            default_path = Path.home() / "Downloads" / f"audit_log_{datetime.now().strftime('%Y%m%d')}.txt"

            file_path, _ = QFileDialog.getSaveFileName(
                self.main,
                "Exportar Log de Auditoria",
                str(default_path),
                "Text Files (*.txt);;All Files (*.*)",
            )

            if file_path:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write("=" * 80 + "\n")
                    f.write("LOG DE AUDITORIA - DRIVER MANAGER\n")
                    f.write(f"Exportado: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
                    f.write("=" * 80 + "\n\n")

                    for log in logs:
                        timestamp = datetime.fromisoformat(log["timestamp"])
                        f.write(f"Fecha: {timestamp.strftime('%d/%m/%Y %H:%M:%S')}\n")
                        f.write(f"Usuario: {log['user']}\n")
                        f.write(f"Accion: {log['action']}\n")
                        f.write(f"Detalles: {log['details']}\n")
                        f.write(f"Items eliminados: {log['items_deleted']}\n")
                        f.write(f"Computadora: {log.get('computer_name', 'N/A')}\n")
                        f.write("-" * 80 + "\n\n")

                QMessageBox.information(
                    self.main,
                    "Log Exportado",
                    f"Log de auditoria exportado\n\nArchivo: {file_path}",
                )
        except Exception as e:
            QMessageBox.critical(self.main, "Error", f"Error al exportar log:\n{e}")

    def _open_file(self, file_path):
        """Abrir archivo con la aplicacion predeterminada del sistema."""
        try:
            if platform.system() == "Windows":
                os.startfile(file_path)
            elif platform.system() == "Darwin":
                subprocess.run(["open", file_path], check=False)
            else:
                subprocess.run(["xdg-open", file_path], check=False)
        except Exception as e:
            QMessageBox.warning(
                self.main,
                "Error al abrir archivo",
                f"No se pudo abrir el archivo automaticamente:\n{e}\n\n"
                f"Ubicacion: {file_path}",
            )
