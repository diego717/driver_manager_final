import base64
from datetime import datetime, timedelta

from PyQt6.QtCore import (
    QAbstractListModel,
    QModelIndex,
    QObject,
    Qt,
    pyqtProperty,
    pyqtSignal,
    pyqtSlot,
)
from PyQt6.QtWidgets import QFileDialog, QInputDialog, QMessageBox

from core.logger import get_logger
from ui.main_window_incidents import open_photo_viewer

logger = get_logger()


class SimpleListModel(QAbstractListModel):
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


class IncidentsBridge(QObject):
    statusMessageChanged = pyqtSignal()
    busyChanged = pyqtSignal()
    limitChanged = pyqtSignal()
    severityChanged = pyqtSignal()
    periodChanged = pyqtSignal()
    currentRecordIndexChanged = pyqtSignal()
    currentIncidentIndexChanged = pyqtSignal()
    selectedChanged = pyqtSignal()
    metricsChanged = pyqtSignal()
    photoChanged = pyqtSignal()

    def __init__(self, window, parent=None):
        super().__init__(parent)
        self.window = window
        self.recordsModel = SimpleListModel(self)
        self.incidentsModel = SimpleListModel(self)
        self.photosModel = SimpleListModel(self)
        self.assignmentsModel = SimpleListModel(self)
        self._limit_options = ["Ultimas 10", "Ultimas 25", "Ultimas 50"]
        self._severity_options = ["Todas", "Critical", "High", "Medium", "Low"]
        self._period_options = ["Todos", "7 dias", "30 dias", "90 dias"]
        self._current_limit = self._limit_options[0]
        self._current_severity = self._severity_options[0]
        self._current_period = self._period_options[0]
        self._records = []
        self._filtered_records = []
        self._incidents = []
        self._filtered_incidents = []
        self._selected_record = None
        self._selected_incident = None
        self._current_record_index = -1
        self._current_incident_index = -1
        self._status_message = "Listo para cargar registros e incidencias."
        self._busy = False
        self._open_count = 0
        self._resolved_count = 0
        self._active_assignments = 0
        self._current_photo_index = -1
        self._current_photo_data_url = ""
        self._current_photo_caption = "Sin fotos asociadas."

    @pyqtProperty(QObject, constant=True)
    def recordsListModel(self):
        return self.recordsModel

    @pyqtProperty(QObject, constant=True)
    def incidentsListModel(self):
        return self.incidentsModel

    @pyqtProperty(QObject, constant=True)
    def photosListModel(self):
        return self.photosModel

    @pyqtProperty(QObject, constant=True)
    def assignmentsListModel(self):
        return self.assignmentsModel

    @pyqtProperty("QStringList", constant=True)
    def limitOptions(self):
        return self._limit_options

    @pyqtProperty("QStringList", constant=True)
    def severityOptions(self):
        return self._severity_options

    @pyqtProperty("QStringList", constant=True)
    def periodOptions(self):
        return self._period_options

    @pyqtProperty(str, notify=limitChanged)
    def currentLimit(self):
        return self._current_limit

    @pyqtProperty(str, notify=severityChanged)
    def currentSeverity(self):
        return self._current_severity

    @pyqtProperty(str, notify=periodChanged)
    def currentPeriod(self):
        return self._current_period

    @pyqtProperty(str, notify=statusMessageChanged)
    def statusMessage(self):
        return self._status_message

    @pyqtProperty(bool, notify=busyChanged)
    def busy(self):
        return self._busy

    @pyqtProperty(int, notify=currentRecordIndexChanged)
    def currentRecordIndex(self):
        return self._current_record_index

    @pyqtProperty(int, notify=currentIncidentIndexChanged)
    def currentIncidentIndex(self):
        return self._current_incident_index

    @pyqtProperty(str, notify=metricsChanged)
    def recordsMetric(self):
        return str(len(self._filtered_records))

    @pyqtProperty(str, notify=metricsChanged)
    def openIncidentsMetric(self):
        return str(self._open_count)

    @pyqtProperty(str, notify=metricsChanged)
    def assignmentsMetric(self):
        return str(self._active_assignments)

    @pyqtProperty(str, notify=photoChanged)
    def currentPhotoDataUrl(self):
        return self._current_photo_data_url

    @pyqtProperty(str, notify=photoChanged)
    def currentPhotoCaption(self):
        return self._current_photo_caption

    @pyqtProperty(str, notify=photoChanged)
    def currentPhotoCounter(self):
        photos = (self._selected_incident or {}).get("photos") or []
        if not photos:
            return "0 / 0"
        return f"{self._current_photo_index + 1} / {len(photos)}"

    @pyqtProperty(bool, notify=photoChanged)
    def canGoPrevPhoto(self):
        return self._current_photo_index > 0

    @pyqtProperty(bool, notify=photoChanged)
    def canGoNextPhoto(self):
        photos = (self._selected_incident or {}).get("photos") or []
        return bool(photos) and self._current_photo_index < len(photos) - 1

    @pyqtProperty(str, notify=selectedChanged)
    def selectedIncidentTitle(self):
        incident = self._selected_incident or {}
        if not incident:
            return "Selecciona una incidencia"
        return f"Incidencia #{incident.get('id', '-')}"

    @pyqtProperty(str, notify=selectedChanged)
    def selectedIncidentMeta(self):
        incident = self._selected_incident or {}
        if not incident:
            return "Abre un registro para revisar detalle, fotos y responsables."
        return (
            f"{self._severity_label(incident.get('severity'))} / "
            f"{self._status_label(incident.get('incident_status'))} / "
            f"Registro #{incident.get('installation_id', '-')}"
        )

    @pyqtProperty(str, notify=selectedChanged)
    def selectedIncidentSummary(self):
        incident = self._selected_incident or {}
        if not incident:
            return "Sin incidencia seleccionada."
        note = str(incident.get("note") or "Sin detalle.")
        reporter = str(incident.get("reporter_username") or "-")
        created = self._format_datetime(incident.get("created_at"))
        return (
            f"{note}\n\n"
            f"Reportado por: {reporter}\n"
            f"Creada: {created}\n"
            f"Estado: {self._status_label(incident.get('incident_status'))}\n"
            f"Severidad: {self._severity_label(incident.get('severity'))}"
        )

    @pyqtProperty(bool, notify=selectedChanged)
    def canCreateIncident(self):
        return bool(self._selected_record) and bool(
            getattr(self.window, "can_operate_incidents", getattr(self.window, "is_admin", False))
        )

    @pyqtProperty(bool, notify=selectedChanged)
    def canOperateSelectedIncident(self):
        return bool(self._selected_incident) and bool(
            getattr(self.window, "can_operate_incidents", getattr(self.window, "is_admin", False))
        )

    @pyqtProperty(bool, notify=selectedChanged)
    def canViewSelectedPhoto(self):
        incident = self._selected_incident or {}
        return bool(incident.get("photos"))

    def _emit_photo_changed(self):
        self.photoChanged.emit()
        self.selectedChanged.emit()

    def _set_busy(self, value):
        value = bool(value)
        if self._busy == value:
            return
        self._busy = value
        self.busyChanged.emit()

    def _set_status(self, message):
        message = str(message or "").strip()
        if self._status_message == message:
            return
        self._status_message = message
        self.statusMessageChanged.emit()
        try:
            self.window.statusBar().showMessage(message, 5000)
        except Exception:
            pass

    def _parse_limit(self):
        text = str(self._current_limit or "").lower()
        if "50" in text:
            return 50
        if "25" in text:
            return 25
        return 10

    def _period_days(self):
        text = str(self._current_period or "").lower()
        if "90" in text:
            return 90
        if "30" in text:
            return 30
        if "7" in text:
            return 7
        return None

    def _parse_datetime(self, raw_value):
        if not raw_value:
            return None
        raw = str(raw_value).strip()
        if raw.endswith("Z"):
            raw = f"{raw[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None
        if parsed.tzinfo is not None:
            return parsed.astimezone().replace(tzinfo=None)
        return parsed

    def _format_datetime(self, raw_value):
        parsed = self._parse_datetime(raw_value)
        if parsed is None:
            return str(raw_value or "-")
        return parsed.strftime("%d/%m/%Y %H:%M")

    def _status_label(self, raw_value):
        value = str(raw_value or "open").strip().lower()
        if value == "resolved":
            return "Resuelta"
        if value == "in_progress":
            return "En curso"
        if value == "paused":
            return "Pausada"
        return "Abierta"

    def _severity_label(self, raw_value):
        value = str(raw_value or "medium").strip().lower()
        labels = {
            "critical": "Critica",
            "high": "Alta",
            "medium": "Media",
            "low": "Baja",
        }
        return labels.get(value, "Media")

    def _record_attention_label(self, record):
        count = int(float(record.get("incident_active_count") or 0))
        state = str(record.get("attention_state") or "").strip().lower()
        if count <= 0:
            return "Sin incidencias"
        if state == "critical":
            return f"Critica ({count})"
        if state == "in_progress":
            return f"En curso ({count})"
        if state == "resolved":
            return f"Resuelta ({count})"
        return f"Abierta ({count})"

    def _serialize_record(self, record):
        brand = str(record.get("driver_brand") or "N/A")
        version = str(record.get("driver_version") or "N/A")
        client = str(record.get("client_name") or "Sin cliente")
        record_id = record.get("id") or "-"
        return {
            "title": f"#{record_id} {brand} v{version}",
            "meta": f"{client} - {self._format_datetime(record.get('timestamp'))}",
            "tag": self._record_attention_label(record),
        }

    def _serialize_incident(self, incident):
        incident_id = incident.get("id") or "-"
        note = str(incident.get("note") or "Sin detalle").strip()
        if len(note) > 88:
            note = f"{note[:85]}..."
        return {
            "title": f"#{incident_id} - {self._status_label(incident.get('incident_status'))}",
            "meta": f"{self._severity_label(incident.get('severity'))} - {self._format_datetime(incident.get('created_at'))}",
            "tag": note,
        }

    def _serialize_photo(self, photo):
        photo_id = photo.get("id") or "-"
        file_name = str(photo.get("file_name") or f"photo_{photo_id}")
        return {
            "title": file_name,
            "meta": str(photo.get("content_type") or "image/*"),
            "tag": f"#{photo_id}",
        }

    def _serialize_assignment(self, assignment):
        tech_name = assignment.get("technician_display_name") or f"Tecnico #{assignment.get('technician_id')}"
        role = str(assignment.get("assignment_role") or "assistant").strip().lower()
        return {
            "title": tech_name,
            "meta": str(assignment.get("technician_employee_code") or "").strip(),
            "tag": role,
        }

    def _apply_record_filters(self):
        days = self._period_days()
        severity = str(self._current_severity or "Todas").strip().lower()
        min_date = None
        if days:
            min_date = datetime.now() - timedelta(days=days)

        filtered = []
        open_count = 0
        resolved_count = 0
        for record in self._records:
            if min_date:
                record_dt = self._parse_datetime(record.get("timestamp"))
                if record_dt and record_dt < min_date:
                    continue
            if severity != "todas":
                severities = {
                    str(item.get("severity") or "medium").strip().lower()
                    for item in (record.get("incidents") or [])
                }
                if severity not in severities:
                    continue

            filtered.append(record)
            for incident in record.get("incidents") or []:
                status = str(incident.get("incident_status") or "open").strip().lower()
                if status == "resolved":
                    resolved_count += 1
                else:
                    open_count += 1

        self._filtered_records = filtered
        self._open_count = open_count
        self._resolved_count = resolved_count
        self.recordsModel.set_items([self._serialize_record(item) for item in filtered])
        self.metricsChanged.emit()

        if filtered:
            self.selectRecord(0)
        else:
            self._selected_record = None
            self._current_record_index = -1
            self.currentRecordIndexChanged.emit()
            self._set_selected_incident(None, -1)

    def _apply_incident_filters(self):
        severity = str(self._current_severity or "Todas").strip().lower()
        incidents = list((self._selected_record or {}).get("incidents") or [])
        filtered = []
        for incident in incidents:
            if severity != "todas" and str(incident.get("severity") or "medium").strip().lower() != severity:
                continue
            filtered.append(incident)

        self._filtered_incidents = filtered
        self.incidentsModel.set_items([self._serialize_incident(item) for item in filtered])
        if filtered:
            self._set_selected_incident(filtered[0], 0)
        else:
            self._set_selected_incident(None, -1)

    def _set_selected_incident(self, incident, index):
        self._selected_incident = incident
        self._current_incident_index = index
        self.currentIncidentIndexChanged.emit()

        photos = (incident or {}).get("photos") or []
        self.photosModel.set_items([self._serialize_photo(item) for item in photos])

        assignments = []
        self._active_assignments = 0
        if incident and incident.get("id") is not None:
            try:
                assignments = self.window.history.list_entity_technician_assignments(
                    "incident",
                    incident.get("id"),
                    include_inactive=False,
                )
            except Exception:
                assignments = []
        self._active_assignments = len(assignments)
        self.assignmentsModel.set_items([self._serialize_assignment(item) for item in assignments])
        if photos:
            self._set_current_photo(0)
        else:
            self._current_photo_index = -1
            self._current_photo_data_url = ""
            self._current_photo_caption = "Sin fotos asociadas."
            self.photoChanged.emit()
        self.metricsChanged.emit()
        self.selectedChanged.emit()

    def _set_current_photo(self, index):
        photos = (self._selected_incident or {}).get("photos") or []
        if not photos:
            self._current_photo_index = -1
            self._current_photo_data_url = ""
            self._current_photo_caption = "Sin evidencia visual."
            self.photoChanged.emit()
            return
        if index < 0 or index >= len(photos):
            return

        photo = photos[index]
        photo_id = photo.get("id")
        data_url = ""
        if photo_id is not None:
            try:
                photo_bytes, content_type = self.window.history.get_photo_content(photo_id)
                mime = str(content_type or "image/jpeg")
                encoded = base64.b64encode(photo_bytes).decode("ascii")
                data_url = f"data:{mime};base64,{encoded}"
            except Exception as error:
                logger.warning("No se pudo cargar preview de foto", details=str(error))
        self._current_photo_index = index
        self._current_photo_data_url = data_url
        self._current_photo_caption = (
            f"Evidencia visual {index + 1}" if data_url else f"Foto {index + 1} sin preview"
        )
        self.photoChanged.emit()

    @pyqtSlot()
    def refreshData(self):
        self._set_busy(True)
        try:
            installations = self.window.history.get_installations(limit=self._parse_limit()) or []
            records = []
            for installation in installations:
                record_id = installation.get("id")
                if record_id is None:
                    continue
                try:
                    incidents = self.window.history.get_incidents_for_installation(record_id) or []
                except Exception as error:
                    logger.warning("No se pudieron cargar incidencias de un registro", details=str(error))
                    incidents = []
                enriched = dict(installation)
                enriched["incidents"] = incidents
                records.append(enriched)
            self._records = records
            self._apply_record_filters()
            self._set_status(f"{len(self._filtered_records)} registros operativos cargados.")
        except Exception as error:
            logger.error("Error cargando incidencias v2", details=str(error), exc_info=True)
            self.recordsModel.set_items([])
            self.incidentsModel.set_items([])
            self.photosModel.set_items([])
            self.assignmentsModel.set_items([])
            self._records = []
            self._filtered_records = []
            self._set_selected_incident(None, -1)
            self._set_status(f"Error cargando incidencias: {error}")
        finally:
            self._set_busy(False)

    @pyqtSlot(str)
    def setLimitFilter(self, value):
        value = str(value or "").strip() or self._limit_options[0]
        if value == self._current_limit:
            return
        self._current_limit = value
        self.limitChanged.emit()
        self.refreshData()

    @pyqtSlot(str)
    def setSeverityFilter(self, value):
        value = str(value or "").strip() or self._severity_options[0]
        if value == self._current_severity:
            return
        self._current_severity = value
        self.severityChanged.emit()
        self._apply_record_filters()

    @pyqtSlot(str)
    def setPeriodFilter(self, value):
        value = str(value or "").strip() or self._period_options[0]
        if value == self._current_period:
            return
        self._current_period = value
        self.periodChanged.emit()
        self._apply_record_filters()

    @pyqtSlot(int)
    def selectRecord(self, row):
        if row < 0 or row >= len(self._filtered_records):
            self._selected_record = None
            self._current_record_index = -1
            self.currentRecordIndexChanged.emit()
            self._set_selected_incident(None, -1)
            return
        self._selected_record = self._filtered_records[row]
        self._current_record_index = row
        self.currentRecordIndexChanged.emit()
        self._apply_incident_filters()

    @pyqtSlot(int)
    def selectIncident(self, row):
        if row < 0 or row >= len(self._filtered_incidents):
            self._set_selected_incident(None, -1)
            return
        self._set_selected_incident(self._filtered_incidents[row], row)

    @pyqtSlot()
    def createIncident(self):
        if not self.canCreateIncident:
            self._set_status("Selecciona un registro y usa una sesion con permisos operativos.")
            return

        record_id = self._selected_record.get("id")
        note, ok = QInputDialog.getMultiLineText(
            self.window,
            f"Nueva incidencia para registro #{record_id}",
            "Detalle de la incidencia:",
            "",
        )
        if not ok:
            return
        note = str(note or "").strip()
        if not note:
            QMessageBox.warning(self.window, "Atencion", "La incidencia requiere un detalle.")
            return

        severity, ok = QInputDialog.getItem(
            self.window,
            "Severidad",
            "Selecciona severidad:",
            ["low", "medium", "high", "critical"],
            1,
            False,
        )
        if not ok:
            return

        apply_label, ok = QInputDialog.getItem(
            self.window,
            "Aplicar a registro",
            "¿Aplicar nota/tiempo al registro?",
            ["No", "Si"],
            0,
            False,
        )
        if not ok:
            return

        reporter = "desktop"
        if self.window.user_manager and self.window.user_manager.current_user:
            reporter = self.window.user_manager.current_user.get("username", "desktop")

        try:
            self.window.history.create_incident(
                installation_id=record_id,
                note=note,
                severity=severity,
                reporter_username=reporter,
                time_adjustment_seconds=0,
                apply_to_installation=(apply_label == "Si"),
                source="desktop",
            )
            self.refreshData()
            self._set_status(f"Incidencia creada para registro #{record_id}.")
        except Exception as error:
            QMessageBox.critical(self.window, "Error", f"No se pudo crear la incidencia:\n{error}")

    def _update_selected_status(self, new_status):
        if not self.canOperateSelectedIncident:
            self._set_status("Selecciona una incidencia operable primero.")
            return
        incident_id = self._selected_incident.get("id")
        resolution_note = ""
        if new_status == "resolved":
            resolution_note, ok = QInputDialog.getMultiLineText(
                self.window,
                "Resolver incidencia",
                "Nota de resolucion (opcional):",
                str((self._selected_incident or {}).get("resolution_note") or ""),
            )
            if not ok:
                return

        reporter = "desktop"
        if self.window.user_manager and self.window.user_manager.current_user:
            reporter = self.window.user_manager.current_user.get("username", "desktop")

        try:
            self.window.history.update_incident_status(
                incident_id=incident_id,
                incident_status=new_status,
                resolution_note=resolution_note,
                reporter_username=reporter,
            )
            self.refreshData()
            self._set_status(f"Incidencia #{incident_id} actualizada.")
        except Exception as error:
            QMessageBox.critical(self.window, "Error", f"No se pudo actualizar el estado:\n{error}")

    @pyqtSlot()
    def markOpen(self):
        self._update_selected_status("open")

    @pyqtSlot()
    def markInProgress(self):
        self._update_selected_status("in_progress")

    @pyqtSlot()
    def markResolved(self):
        self._update_selected_status("resolved")

    @pyqtSlot()
    def uploadPhoto(self):
        if not self.canOperateSelectedIncident:
            self._set_status("Selecciona una incidencia primero.")
            return
        incident_id = self._selected_incident.get("id")
        file_path, _ = QFileDialog.getOpenFileName(
            self.window,
            f"Subir foto a incidencia #{incident_id}",
            "",
            "Imagenes (*.jpg *.jpeg *.png *.webp)",
        )
        if not file_path:
            return
        try:
            self.window.history.upload_incident_photo(incident_id, file_path)
            self.refreshData()
            self._set_status(f"Foto subida a incidencia #{incident_id}.")
        except Exception as error:
            QMessageBox.critical(self.window, "Error", f"No se pudo subir la foto:\n{error}")

    @pyqtSlot()
    def viewPhoto(self):
        incident = self._selected_incident or {}
        photos = incident.get("photos") or []
        if not photos:
            QMessageBox.information(self.window, "Sin fotos", "Esta incidencia no tiene fotos asociadas.")
            return
        if self._current_photo_index < 0 or self._current_photo_index >= len(photos):
            self._set_current_photo(0)
        photo = photos[self._current_photo_index]
        photo_id = photo.get("id")
        if photo_id is None:
            return
        open_photo_viewer(
            self.window,
            photo_id,
            str(photo.get("file_name") or f"Foto #{photo_id}"),
        )

    @pyqtSlot()
    def prevPhoto(self):
        if self.canGoPrevPhoto:
            self._set_current_photo(self._current_photo_index - 1)

    @pyqtSlot()
    def nextPhoto(self):
        if self.canGoNextPhoto:
            self._set_current_photo(self._current_photo_index + 1)
