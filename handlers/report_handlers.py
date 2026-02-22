"""
Manejadores de reportes para Driver Manager.
"""

import os
import platform
import subprocess
import json
from datetime import datetime, timedelta
from pathlib import Path

def _qt_widgets():
    """Import Qt widgets lazily to avoid hard dependency during headless test imports."""
    from PyQt6.QtWidgets import QFileDialog, QMessageBox

    return QFileDialog, QMessageBox


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
            lines = [
                "Resumen rapido para reportes",
                "",
                f"Hoy ({now.strftime('%d/%m/%Y')}):",
                f"- Registros: {day_stats.get('total_installations', 0)}",
                f"- Exitosas: {day_stats.get('successful_installations', 0)}",
                f"- Fallidas: {day_stats.get('failed_installations', 0)}",
                "",
                f"{month_name} {year} (mes seleccionado):",
                f"- Registros: {month_stats.get('total_installations', 0)}",
                f"- Exitosas: {month_stats.get('successful_installations', 0)}",
                f"- Fallidas: {month_stats.get('failed_installations', 0)}",
                "",
                f"Ano {year}:",
                f"- Registros: {year_stats.get('total_installations', 0)}",
                f"- Exitosas: {year_stats.get('successful_installations', 0)}",
                f"- Fallidas: {year_stats.get('failed_installations', 0)}",
                "",
                "Los reportes se guardan en la carpeta Descargas.",
            ]

            if last_report_path:
                label = (report_kind or "Reporte").lower()
                lines.extend([
                    "",
                    f"Ultimo {label} generado:",
                    str(last_report_path),
                ])

            preview.setPlainText("\n".join(lines))
        except Exception as e:
            preview.setPlainText(f"No se pudo cargar la vista previa de reportes.\n\nDetalle: {e}")

    def generate_daily_report_simple(self):
        """Generar reporte del dia actual."""
        try:
            _, QMessageBox = _qt_widgets()
            now = datetime.now()
            day_start_dt = now.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end_dt = day_start_dt + timedelta(days=1)

            try:
                installations = self.main.history.get_installations(
                    start_date=day_start_dt.isoformat(),
                    end_date=day_end_dt.isoformat(),
                )
                stats = self.main.history.get_statistics(
                    start_date=day_start_dt.isoformat(),
                    end_date=day_end_dt.isoformat(),
                )
            except ConnectionError as e:
                self.main.statusBar().showMessage("Error generando reporte")
                QMessageBox.critical(self.main, "Error", f"Error al generar reporte:\n{e}")
                return False

            if installations is None or stats is None:
                self.main.statusBar().showMessage("Sin datos para reporte diario")
                QMessageBox.information(
                    self.main,
                    "Sin Datos",
                    "No hay datos de historial disponibles para generar el reporte diario.",
                )
                return False

            self.main.statusBar().showMessage("Generando reporte diario...")
            report_path = self.main.report_gen.generate_daily_report()
            if not report_path:
                self.main.statusBar().showMessage("Sin datos para reporte diario")
                QMessageBox.information(
                    self.main,
                    "Sin Datos",
                    "No se pudo generar el reporte diario por falta de datos.",
                )
                return False

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
            return True

        except Exception as e:
            self.main.statusBar().showMessage("Error generando reporte")
            QMessageBox.critical(self.main, "Error", f"Error al generar reporte:\n{e}")
            return False

    def generate_monthly_report_simple(self):
        """Generar reporte del mes seleccionado."""
        try:
            _, QMessageBox = _qt_widgets()
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
            _, QMessageBox = _qt_widgets()
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
            QFileDialog, QMessageBox = _qt_widgets()
            default_path = Path.home() / "Downloads" / f"historial_export_{datetime.now().strftime('%Y%m%d')}.json"

            file_path, _ = QFileDialog.getSaveFileName(
                self.main,
                "Exportar Historial",
                str(default_path),
                "JSON Files (*.json);;All Files (*.*)",
            )

            if file_path:
                self.main.statusBar().showMessage("Exportando historial...")
                history_records = self.main.history.get_installations() or []
                export_payload = {
                    "exported_at": datetime.now().isoformat(),
                    "total_records": len(history_records),
                    "records": history_records,
                }
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(export_payload, f, ensure_ascii=False, indent=2)
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
            QFileDialog, QMessageBox = _qt_widgets()
            logs = self._get_audit_logs(limit=1000)

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
                        if not isinstance(log, dict):
                            continue

                        timestamp_value = self._extract_timestamp_value(log)
                        timestamp_text = self._format_timestamp_value(timestamp_value)
                        username = log.get("username") or log.get("user") or "N/A"
                        action = log.get("action") or "N/A"
                        success_value = log.get("success")
                        if success_value is True:
                            success_text = "OK"
                        elif success_value is False:
                            success_text = "ERROR"
                        else:
                            success_text = "N/A"

                        details = log.get("details", {})
                        if isinstance(details, (dict, list)):
                            details_text = json.dumps(details, ensure_ascii=False)
                        else:
                            details_text = str(details)

                        system_info = log.get("system_info") or {}
                        if not isinstance(system_info, dict):
                            system_info = {}

                        computer_name = (
                            log.get("computer_name")
                            or system_info.get("computer_name")
                            or "N/A"
                        )
                        ip_address = (
                            log.get("ip_address")
                            or system_info.get("ip")
                            or "N/A"
                        )
                        platform_name = (
                            log.get("platform")
                            or system_info.get("platform")
                            or "N/A"
                        )

                        f.write(f"Fecha: {timestamp_text}\n")
                        f.write(f"Usuario: {username}\n")
                        f.write(f"Accion: {action}\n")
                        f.write(f"Resultado: {success_text}\n")
                        f.write(f"Detalles: {details_text}\n")
                        f.write(f"Computadora: {computer_name}\n")
                        f.write(f"IP: {ip_address}\n")
                        f.write(f"Plataforma: {platform_name}\n")
                        f.write("-" * 80 + "\n\n")

                QMessageBox.information(
                    self.main,
                    "Log Exportado",
                    f"Log de auditoria exportado\n\nArchivo: {file_path}",
                )
        except Exception as e:
            QMessageBox.critical(self.main, "Error", f"Error al exportar log:\n{e}")

    def _get_audit_logs(self, limit=1000):
        """Obtener logs de auditoria desde la fuente disponible."""
        user_manager = getattr(self.main, "user_manager", None)
        if user_manager and hasattr(user_manager, "get_access_logs"):
            try:
                return user_manager.get_access_logs(limit=limit) or []
            except Exception:
                pass

        history_manager = getattr(self.main, "history_manager", None)
        if history_manager and hasattr(history_manager, "_make_request"):
            try:
                return history_manager._make_request(
                    "get",
                    "audit-logs",
                    params={"limit": max(1, int(limit or 1000))},
                ) or []
            except Exception:
                pass

        return []

    def _extract_timestamp_value(self, log):
        """Extraer timestamp tolerando variantes legacy de clave."""
        direct_value = log.get("timestamp")
        if direct_value:
            return direct_value

        for key, value in log.items():
            if not isinstance(key, str):
                continue
            lowered = key.lower()
            if "timestamp" in lowered:
                return value
            if lowered.startswith("timest") and "mp" in lowered:
                return value
        return None

    def _format_timestamp_value(self, raw_value):
        """Formatear timestamp ISO para exportacion legible."""
        if not raw_value:
            return "N/A"
        try:
            parsed = datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
            return parsed.strftime("%d/%m/%Y %H:%M:%S")
        except Exception:
            return str(raw_value)

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
            _, QMessageBox = _qt_widgets()
            QMessageBox.warning(
                self.main,
                "Error al abrir archivo",
                f"No se pudo abrir el archivo automaticamente:\n{e}\n\n"
                f"Ubicacion: {file_path}",
            )
