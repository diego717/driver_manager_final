from datetime import datetime, timedelta
from pathlib import Path

from PyQt6.QtCore import (
    QAbstractListModel,
    QModelIndex,
    QObject,
    Qt,
    QUrl,
    pyqtProperty,
    pyqtSignal,
    pyqtSlot,
)
from PyQt6.QtGui import QDesktopServices

from core.logger import get_logger

logger = get_logger()


class HistoryListModel(QAbstractListModel):
    TitleRole = Qt.ItemDataRole.UserRole + 1
    MetaRole = Qt.ItemDataRole.UserRole + 2
    TagRole = Qt.ItemDataRole.UserRole + 3

    def __init__(self, parent=None):
        super().__init__(parent)
        self._items = []

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._items)

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid():
            return None
        row = index.row()
        if row < 0 or row >= len(self._items):
            return None
        item = self._items[row]
        if role == self.TitleRole:
            return item.get("title", "")
        if role == self.MetaRole:
            return item.get("meta", "")
        if role == self.TagRole:
            return item.get("tag", "")
        return None

    def roleNames(self):
        return {
            self.TitleRole: b"title",
            self.MetaRole: b"meta",
            self.TagRole: b"tag",
        }

    def set_items(self, items):
        self.beginResetModel()
        self._items = list(items or [])
        self.endResetModel()


class HistoryBridge(QObject):
    statusMessageChanged = pyqtSignal()
    busyChanged = pyqtSignal()
    limitChanged = pyqtSignal()
    monthChanged = pyqtSignal()
    yearChanged = pyqtSignal()
    metricsChanged = pyqtSignal()
    previewChanged = pyqtSignal()
    selectedChanged = pyqtSignal()
    currentRecordIndexChanged = pyqtSignal()
    lastReportPathChanged = pyqtSignal()

    def __init__(self, window, parent=None):
        super().__init__(parent)
        self.window = window
        self.recordsModel = HistoryListModel(self)
        self._limit_options = ["Ultimas 10", "Ultimas 25", "Ultimas 50"]
        self._month_options = [
            "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
        ]
        current_year = datetime.now().year
        self._year_options = [str(year) for year in range(current_year - 2, current_year + 2)]
        self._current_limit = self._limit_options[0]
        self._current_month = self._month_options[datetime.now().month - 1]
        self._current_year = str(current_year)
        self._status_message = "Listo para cargar historial y reportes."
        self._busy = False
        self._records = []
        self._selected_record = None
        self._current_record_index = -1
        self._report_preview = "Cargando resumen historico..."
        self._last_report_path = ""
        self._total_records_metric = "0"
        self._success_rate_metric = "0%"
        self._failed_metric = "0"
        self._selected_month_metric = "0"

    @pyqtProperty(QObject, constant=True)
    def recordsListModel(self):
        return self.recordsModel

    @pyqtProperty("QStringList", constant=True)
    def limitOptions(self):
        return self._limit_options

    @pyqtProperty("QStringList", constant=True)
    def monthOptions(self):
        return self._month_options

    @pyqtProperty("QStringList", constant=True)
    def yearOptions(self):
        return self._year_options

    @pyqtProperty(str, notify=statusMessageChanged)
    def statusMessage(self):
        return self._status_message

    @pyqtProperty(bool, notify=busyChanged)
    def busy(self):
        return self._busy

    @pyqtProperty(str, notify=limitChanged)
    def currentLimit(self):
        return self._current_limit

    @pyqtProperty(str, notify=monthChanged)
    def currentMonth(self):
        return self._current_month

    @pyqtProperty(str, notify=yearChanged)
    def currentYear(self):
        return self._current_year

    @pyqtProperty(str, notify=metricsChanged)
    def totalRecordsMetric(self):
        return self._total_records_metric

    @pyqtProperty(str, notify=metricsChanged)
    def successRateMetric(self):
        return self._success_rate_metric

    @pyqtProperty(str, notify=metricsChanged)
    def failedMetric(self):
        return self._failed_metric

    @pyqtProperty(str, notify=metricsChanged)
    def selectedMonthMetric(self):
        return self._selected_month_metric

    @pyqtProperty(str, notify=previewChanged)
    def reportPreview(self):
        return self._report_preview

    @pyqtProperty(str, notify=lastReportPathChanged)
    def lastReportPath(self):
        return self._last_report_path

    @pyqtProperty(bool, notify=lastReportPathChanged)
    def hasLastReport(self):
        return bool(self._last_report_path)

    @pyqtProperty(int, notify=currentRecordIndexChanged)
    def currentRecordIndex(self):
        return self._current_record_index

    @pyqtProperty(str, notify=selectedChanged)
    def selectedRecordTitle(self):
        record = self._selected_record or {}
        if not record:
            return "Selecciona un registro"
        record_id = record.get("id")
        brand = str(record.get("driver_brand") or "Caso manual")
        version = str(record.get("driver_version") or "sin version")
        return f"#{record_id} {brand} {version}".strip()

    @pyqtProperty(str, notify=selectedChanged)
    def selectedRecordMeta(self):
        record = self._selected_record or {}
        if not record:
            return "El detalle del registro seleccionado aparece aca, junto con contexto para reportes."
        timestamp = self._format_timestamp(record.get("timestamp"))
        client_name = str(record.get("client_name") or "Sin cliente")
        return f"{client_name} · {timestamp}"

    @pyqtProperty(str, notify=selectedChanged)
    def selectedRecordDetails(self):
        record = self._selected_record or {}
        if not record:
            return "Sin seleccion."

        notes = str(record.get("notes") or "").strip() or "Sin notas operativas."
        return (
            f"Cliente: {record.get('client_name') or 'N/A'}\n"
            f"Marca: {record.get('driver_brand') or 'N/A'}\n"
            f"Version: {record.get('driver_version') or 'N/A'}\n"
            f"Estado: {self._status_label(record.get('status'))}\n"
            f"Fecha: {self._format_timestamp(record.get('timestamp'))}\n"
            f"Incidencias activas: {int(record.get('incident_active_count') or 0)}\n"
            f"Tiempo: {self._format_duration(record.get('installation_time_seconds'))}\n\n"
            f"Notas:\n{notes}"
        )

    def _set_busy(self, value):
        normalized = bool(value)
        if self._busy == normalized:
            return
        self._busy = normalized
        self.busyChanged.emit()

    def _set_status(self, message):
        normalized = str(message or "").strip()
        if self._status_message == normalized:
            return
        self._status_message = normalized
        self.statusMessageChanged.emit()
        try:
            self.window.statusBar().showMessage(normalized, 5000)
        except Exception:
            pass

    def _set_last_report_path(self, report_path):
        normalized = str(report_path or "").strip()
        if self._last_report_path == normalized:
            return
        self._last_report_path = normalized
        self.lastReportPathChanged.emit()

    def _parse_limit(self):
        label = str(self._current_limit or "")
        for value in (10, 25, 50, 100):
            if str(value) in label:
                return value
        return 10

    def _current_month_index(self):
        try:
            return self._month_options.index(self._current_month) + 1
        except ValueError:
            return datetime.now().month

    def _selected_period(self):
        year = int(self._current_year)
        month = self._current_month_index()
        start = datetime(year, month, 1)
        end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
        return start, end

    def _status_label(self, raw_status):
        label = str(raw_status or "").strip().lower()
        if label in {"ok", "success", "completed", "successful"}:
            return "Exitosa"
        if label in {"failed", "error"}:
            return "Fallida"
        if label:
            return label.capitalize()
        return "Sin estado"

    def _format_timestamp(self, raw_value):
        if not raw_value:
            return "Sin fecha"
        raw = str(raw_value).strip()
        if raw.endswith("Z"):
            raw = f"{raw[:-1]}+00:00"
        try:
            dt = datetime.fromisoformat(raw)
        except ValueError:
            return str(raw_value)
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt.strftime("%d/%m/%Y %H:%M")

    def _format_duration(self, raw_seconds):
        try:
            total_seconds = int(float(raw_seconds or 0))
        except Exception:
            return "N/A"
        if total_seconds <= 0:
            return "N/A"
        minutes, seconds = divmod(total_seconds, 60)
        if minutes >= 60:
            hours, minutes = divmod(minutes, 60)
            return f"{hours}h {minutes}m"
        return f"{minutes}m {seconds}s"

    def _build_record_row(self, record):
        brand = str(record.get("driver_brand") or "Caso manual").strip()
        version = str(record.get("driver_version") or "sin version").strip()
        client_name = str(record.get("client_name") or "Sin cliente").strip()
        record_id = record.get("id", "-")
        attention_count = int(record.get("incident_active_count") or 0)
        tag = "Sin incidencias" if attention_count <= 0 else f"{attention_count} incidencias activas"
        return {
            "title": f"#{record_id} {brand} {version}",
            "meta": f"{client_name} · {self._format_timestamp(record.get('timestamp'))}",
            "tag": tag,
        }

    def _refresh_preview(self):
        try:
            now = datetime.now()
            day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            day_stats = self.window.history.get_statistics(
                start_date=day_start.isoformat(),
                end_date=day_end.isoformat(),
            ) or {}

            month_start, month_end = self._selected_period()
            month_stats = self.window.history.get_statistics(
                start_date=month_start.isoformat(),
                end_date=month_end.isoformat(),
            ) or {}

            year = int(self._current_year)
            year_start = datetime(year, 1, 1)
            year_end = datetime(year + 1, 1, 1)
            year_stats = self.window.history.get_statistics(
                start_date=year_start.isoformat(),
                end_date=year_end.isoformat(),
            ) or {}

            preview_lines = [
                "Resumen rapido de reportes",
                "",
                f"Hoy ({now.strftime('%d/%m/%Y')}):",
                f"- Registros: {int(day_stats.get('total_installations') or 0)}",
                f"- Exitosas: {int(day_stats.get('successful_installations') or 0)}",
                f"- Fallidas: {int(day_stats.get('failed_installations') or 0)}",
                "",
                f"{self._current_month} {self._current_year}:",
                f"- Registros: {int(month_stats.get('total_installations') or 0)}",
                f"- Exitosas: {int(month_stats.get('successful_installations') or 0)}",
                f"- Fallidas: {int(month_stats.get('failed_installations') or 0)}",
                "",
                f"Ano {self._current_year}:",
                f"- Registros: {int(year_stats.get('total_installations') or 0)}",
                f"- Exitosas: {int(year_stats.get('successful_installations') or 0)}",
                f"- Fallidas: {int(year_stats.get('failed_installations') or 0)}",
                "",
                "Los reportes se guardan en Descargas.",
            ]

            if self._last_report_path:
                preview_lines.extend([
                    "",
                    "Ultimo reporte generado:",
                    self._last_report_path,
                ])

            preview = "\n".join(preview_lines)
            if self._report_preview != preview:
                self._report_preview = preview
                self.previewChanged.emit()

            self._selected_month_metric = str(int(month_stats.get("total_installations") or 0))
            self.metricsChanged.emit()
        except Exception as error:
            logger.error(f"No se pudo actualizar la vista previa de reportes v2: {error}")
            preview = f"No se pudo cargar el resumen de reportes.\n\nDetalle: {error}"
            if self._report_preview != preview:
                self._report_preview = preview
                self.previewChanged.emit()

    @pyqtSlot()
    def refreshHistory(self):
        self._set_busy(True)
        self._set_status("Cargando historial y reportes...")
        previous_id = None
        if self._selected_record:
            previous_id = self._selected_record.get("id")

        try:
            records = self.window.history.get_installations(limit=self._parse_limit()) or []
            stats = self.window.history.get_statistics() or {}

            self._records = [record for record in records if isinstance(record, dict)]
            self.recordsModel.set_items([self._build_record_row(record) for record in self._records])

            self._total_records_metric = str(int(stats.get("total_installations") or 0))
            success_rate = float(stats.get("success_rate") or 0)
            self._success_rate_metric = f"{success_rate:.0f}%"
            self._failed_metric = str(int(stats.get("failed_installations") or 0))
            self.metricsChanged.emit()

            selected_index = -1
            if previous_id is not None:
                for index, record in enumerate(self._records):
                    if record.get("id") == previous_id:
                        selected_index = index
                        break
            if selected_index < 0 and self._records:
                selected_index = 0

            if selected_index >= 0:
                self._selected_record = self._records[selected_index]
                self._current_record_index = selected_index
            else:
                self._selected_record = None
                self._current_record_index = -1

            self.currentRecordIndexChanged.emit()
            self.selectedChanged.emit()
            self._refresh_preview()
            self._set_status(f"{len(self._records)} registros cargados para seguimiento.")
        except Exception as error:
            logger.error(f"Error cargando historial v2: {error}", exc_info=True)
            self.recordsModel.set_items([])
            self._records = []
            self._selected_record = None
            self._current_record_index = -1
            self.currentRecordIndexChanged.emit()
            self.selectedChanged.emit()
            self._set_status(f"No se pudo cargar historial: {error}")
        finally:
            self._set_busy(False)

    @pyqtSlot(str)
    def setLimitFilter(self, value):
        normalized = str(value or "").strip()
        if not normalized or normalized == self._current_limit:
            return
        self._current_limit = normalized
        self.limitChanged.emit()
        self.refreshHistory()

    @pyqtSlot(str)
    def setMonthFilter(self, value):
        normalized = str(value or "").strip()
        if not normalized or normalized == self._current_month:
            return
        self._current_month = normalized
        self.monthChanged.emit()
        self._refresh_preview()

    @pyqtSlot(str)
    def setYearFilter(self, value):
        normalized = str(value or "").strip()
        if not normalized or normalized == self._current_year:
            return
        self._current_year = normalized
        self.yearChanged.emit()
        self._refresh_preview()

    @pyqtSlot(int)
    def selectRecord(self, index):
        if index < 0 or index >= len(self._records):
            return
        self._selected_record = self._records[index]
        if self._current_record_index != index:
            self._current_record_index = index
            self.currentRecordIndexChanged.emit()
        self.selectedChanged.emit()

    def _generate_report(self, kind):
        try:
            self._set_busy(True)
            if kind == "daily":
                self._set_status("Generando reporte diario...")
                report_path = self.window.report_gen.generate_daily_report()
            elif kind == "monthly":
                self._set_status(f"Generando reporte de {self._current_month} {self._current_year}...")
                report_path = self.window.report_gen.generate_monthly_report(
                    int(self._current_year),
                    self._current_month_index(),
                )
            else:
                self._set_status(f"Generando reporte anual {self._current_year}...")
                report_path = self.window.report_gen.generate_yearly_report(int(self._current_year))

            if not report_path:
                self._set_status("No se pudo generar el reporte.")
                return

            self._set_last_report_path(report_path)
            self._refresh_preview()
            self._set_status(f"Reporte generado en {report_path}")
        except Exception as error:
            logger.error(f"Error generando reporte v2 ({kind}): {error}", exc_info=True)
            self._set_status(f"No se pudo generar el reporte: {error}")
        finally:
            self._set_busy(False)

    @pyqtSlot()
    def generateDailyReport(self):
        self._generate_report("daily")

    @pyqtSlot()
    def generateMonthlyReport(self):
        self._generate_report("monthly")

    @pyqtSlot()
    def generateYearlyReport(self):
        self._generate_report("yearly")

    @pyqtSlot()
    def openLastReport(self):
        if not self._last_report_path:
            self._set_status("Todavia no hay reportes generados en esta sesion.")
            return
        opened = QDesktopServices.openUrl(QUrl.fromLocalFile(self._last_report_path))
        if not opened:
            self._set_status("No se pudo abrir el ultimo reporte.")

    @pyqtSlot()
    def openDownloadsFolder(self):
        downloads_path = Path.home() / "Downloads"
        opened = QDesktopServices.openUrl(QUrl.fromLocalFile(str(downloads_path)))
        if not opened:
            self._set_status("No se pudo abrir la carpeta Descargas.")
