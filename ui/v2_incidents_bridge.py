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
    currentAssignmentIndexChanged = pyqtSignal()

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
        self._incidents_by_record_id = {}
        self._incident_errors_by_record_id = {}
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
        self._assignments = []
        self._current_assignment_index = -1

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

    @pyqtProperty(int, notify=currentAssignmentIndexChanged)
    def currentAssignmentIndex(self):
        return self._current_assignment_index

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

    @pyqtProperty(bool, notify=selectedChanged)
    def canManageAssignments(self):
        return bool(
            self._selected_incident
            and getattr(self.window, "can_manage_operational_records", getattr(self.window, "is_admin", False))
        )

    @pyqtProperty(bool, notify=selectedChanged)
    def canRemoveAssignment(self):
        return self.canManageAssignments and 0 <= self._current_assignment_index < len(self._assignments)

    @pyqtProperty(str, notify=selectedChanged)
    def assignmentPanelTitle(self):
        if self._current_assignment_index < 0 or self._current_assignment_index >= len(self._assignments):
            return "Sin responsable seleccionado"
        assignment = self._assignments[self._current_assignment_index]
        return str(
            assignment.get("technician_display_name")
            or f"Tecnico #{assignment.get('technician_id')}"
        )

    @pyqtProperty(str, notify=selectedChanged)
    def assignmentPanelMeta(self):
        if self._current_assignment_index < 0 or self._current_assignment_index >= len(self._assignments):
            return "Selecciona una asignacion para ver rol y contexto."
        assignment = self._assignments[self._current_assignment_index]
        employee_code = str(assignment.get("technician_employee_code") or "").strip()
        role = self._assignment_role_label(assignment.get("assignment_role"))
        if employee_code:
            return f"{role} - {employee_code}"
        return role

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

    def _assignment_role_label(self, raw_value):
        value = str(raw_value or "assistant").strip().lower()
        labels = {
            "owner": "Responsable",
            "assistant": "Apoyo",
            "reviewer": "Revision",
        }
        return labels.get(value, value.title() or "Apoyo")

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
        incident_error = str(self._incident_errors_by_record_id.get(record_id) or "").strip()
        if incident_error:
            tag = "Incidencias no disponibles"
        else:
            tag = self._record_attention_label(record)
        return {
            "title": f"#{record_id} {brand} v{version}",
            "meta": f"{client} - {self._format_datetime(record.get('timestamp'))}",
            "tag": tag,
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
        role = self._assignment_role_label(assignment.get("assignment_role"))
        return {
            "title": tech_name,
            "meta": str(assignment.get("technician_employee_code") or "").strip(),
            "tag": role,
        }

    def _selected_record_id(self):
        return (self._selected_record or {}).get("id")

    def _selected_incident_id(self):
        return (self._selected_incident or {}).get("id")

    def _selected_assignment_id(self):
        if self._current_assignment_index < 0 or self._current_assignment_index >= len(self._assignments):
            return None
        return self._assignments[self._current_assignment_index].get("id")

    def _apply_record_filters(self):
        days = self._period_days()
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

            filtered.append(record)
            active_count = int(float(record.get("incident_active_count") or 0))
            open_count += max(0, active_count)
            if active_count <= 0 and str(record.get("attention_state") or "").strip().lower() == "resolved":
                resolved_count += 1

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
        preferred_incident_id = self._selected_incident_id()
        severity = str(self._current_severity or "Todas").strip().lower()
        record_id = (self._selected_record or {}).get("id")
        incidents = list(self._incidents_by_record_id.get(record_id) or [])
        filtered = []
        for incident in incidents:
            if severity != "todas" and str(incident.get("severity") or "medium").strip().lower() != severity:
                continue
            filtered.append(incident)

        self._filtered_incidents = filtered
        self.incidentsModel.set_items([self._serialize_incident(item) for item in filtered])
        if filtered:
            selected_index = 0
            if preferred_incident_id is not None:
                for index, item in enumerate(filtered):
                    if item.get("id") == preferred_incident_id:
                        selected_index = index
                        break
            self._set_selected_incident(filtered[selected_index], selected_index)
        else:
            self._set_selected_incident(None, -1)

    def _reload_assignments(self, preferred_assignment_id=None):
        incident = self._selected_incident or {}
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

        self._assignments = list(assignments or [])
        self._active_assignments = len(self._assignments)
        self.assignmentsModel.set_items([self._serialize_assignment(item) for item in self._assignments])

        self._current_assignment_index = -1
        if self._assignments:
            if preferred_assignment_id is not None:
                for index, assignment in enumerate(self._assignments):
                    if assignment.get("id") == preferred_assignment_id:
                        self._current_assignment_index = index
                        break
            if self._current_assignment_index < 0:
                self._current_assignment_index = 0
        self.currentAssignmentIndexChanged.emit()
        self.metricsChanged.emit()
        self.selectedChanged.emit()

    def _set_selected_incident(self, incident, index):
        self._selected_incident = incident
        self._current_incident_index = index
        self.currentIncidentIndexChanged.emit()

        photos = (incident or {}).get("photos") or []
        self.photosModel.set_items([self._serialize_photo(item) for item in photos])
        self._reload_assignments()
        if photos:
            self._set_current_photo(0)
        else:
            self._current_photo_index = -1
            self._current_photo_data_url = ""
            self._current_photo_caption = "Sin fotos asociadas."
            self.photoChanged.emit()
        self.selectedChanged.emit()

    def _ensure_record_incidents_loaded(self, record, force=False):
        record_id = (record or {}).get("id")
        if record_id is None:
            return []
        if not force and record_id in self._incidents_by_record_id:
            return list(self._incidents_by_record_id.get(record_id) or [])

        try:
            incidents = self.window.history.get_incidents_for_installation(record_id) or []
            self._incidents_by_record_id[record_id] = list(incidents)
            self._incident_errors_by_record_id.pop(record_id, None)
            return list(incidents)
        except Exception as error:
            error_text = str(error or "").strip()
            self._incidents_by_record_id[record_id] = []
            self._incident_errors_by_record_id[record_id] = error_text or "No disponible"
            logger.warning(
                "No se pudieron cargar incidencias de un registro",
                details=f"record_id={record_id} error={error_text}",
            )
            if self._selected_record and self._selected_record.get("id") == record_id:
                self._set_status(
                    f"Registro #{record_id} sin incidencias cargadas por timeout o error de API."
                )
            return []

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
            preferred_record_id = self._selected_record_id()
            preferred_incident_id = self._selected_incident_id()
            installations = self.window.history.get_installations(limit=self._parse_limit()) or []
            records = []
            for installation in installations:
                record_id = installation.get("id")
                if record_id is None:
                    continue
                enriched = dict(installation)
                records.append(enriched)
            self._records = records
            self._apply_record_filters()
            if preferred_record_id is not None and self._filtered_records:
                for index, record in enumerate(self._filtered_records):
                    if record.get("id") == preferred_record_id:
                        self.selectRecord(index)
                        break
            if preferred_incident_id is not None and self._filtered_incidents:
                for index, incident in enumerate(self._filtered_incidents):
                    if incident.get("id") == preferred_incident_id:
                        self.selectIncident(index)
                        break
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
        if self._selected_record:
            self._ensure_record_incidents_loaded(self._selected_record)
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
        self._ensure_record_incidents_loaded(self._selected_record)
        self.recordsModel.set_items([self._serialize_record(item) for item in self._filtered_records])
        self._apply_incident_filters()

    @pyqtSlot(int)
    def selectIncident(self, row):
        if row < 0 or row >= len(self._filtered_incidents):
            self._set_selected_incident(None, -1)
            return
        self._set_selected_incident(self._filtered_incidents[row], row)

    @pyqtSlot(int)
    def selectAssignment(self, row):
        if row < 0 or row >= len(self._assignments):
            self._current_assignment_index = -1
            self.currentAssignmentIndexChanged.emit()
            self.selectedChanged.emit()
            return
        self._current_assignment_index = row
        self.currentAssignmentIndexChanged.emit()
        self.selectedChanged.emit()

    @pyqtSlot()
    def refreshAssignments(self):
        if not self._selected_incident:
            self._set_status("Selecciona una incidencia para actualizar asignaciones.")
            return
        preferred_assignment_id = self._selected_assignment_id()
        self._reload_assignments(preferred_assignment_id=preferred_assignment_id)
        self._set_status("Asignaciones actualizadas.")

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
            self._ensure_record_incidents_loaded(self._selected_record, force=True)
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
            if self._selected_record:
                self._ensure_record_incidents_loaded(self._selected_record, force=True)
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
            if self._selected_record:
                self._ensure_record_incidents_loaded(self._selected_record, force=True)
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

    @pyqtSlot()
    def assignTechnician(self):
        if not self.canManageAssignments:
            self._set_status("Tu sesion no tiene permisos para gestionar asignaciones.")
            return

        incident = self._selected_incident or {}
        incident_id = incident.get("id")
        if incident_id is None:
            return

        try:
            technicians = self.window.history.list_technicians(include_inactive=False)
        except Exception as error:
            QMessageBox.warning(self.window, "Error", f"No se pudo cargar el directorio de tecnicos:\n{error}")
            return

        if not technicians:
            QMessageBox.information(self.window, "Sin tecnicos", "No hay tecnicos activos para asignar.")
            return

        choices = []
        technician_map = {}
        for technician in technicians:
            technician_id = technician.get("id")
            display_name = str(technician.get("display_name") or f"Tecnico #{technician_id}")
            employee_code = str(technician.get("employee_code") or "").strip()
            label = f"#{technician_id} - {display_name}"
            if employee_code:
                label += f" ({employee_code})"
            choices.append(label)
            technician_map[label] = technician

        selected_label, ok = QInputDialog.getItem(
            self.window,
            f"Asignar tecnico a incidencia #{incident_id}",
            "Tecnico:",
            choices,
            0,
            False,
        )
        if not ok:
            return

        selected_role, ok = QInputDialog.getItem(
            self.window,
            "Rol de asignacion",
            "Selecciona rol:",
            ["owner", "assistant", "reviewer"],
            0,
            False,
        )
        if not ok:
            return

        selected_technician = technician_map.get(selected_label) or {}
        technician_id = selected_technician.get("id")
        if technician_id is None:
            QMessageBox.warning(self.window, "Error", "No se pudo resolver el tecnico seleccionado.")
            return

        try:
            self.window.history.create_technician_assignment(
                technician_id=technician_id,
                entity_type="incident",
                entity_id=incident_id,
                assignment_role=selected_role,
            )
            self.refreshAssignments()
            self._set_status(f"Tecnico asignado a incidencia #{incident_id}.")
        except Exception as error:
            QMessageBox.warning(self.window, "Error", f"No se pudo crear la asignacion:\n{error}")

    @pyqtSlot()
    def removeAssignment(self):
        if not self.canRemoveAssignment:
            self._set_status("Selecciona una asignacion activa para quitar.")
            return

        assignment = self._assignments[self._current_assignment_index]
        assignment_id = assignment.get("id")
        if assignment_id is None:
            return

        reply = QMessageBox.question(
            self.window,
            "Confirmar",
            f"¿Quitar asignacion #{assignment_id}?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        try:
            self.window.history.remove_technician_assignment(assignment_id)
            self.refreshAssignments()
            self._set_status(f"Asignacion #{assignment_id} quitada.")
        except Exception as error:
            QMessageBox.warning(self.window, "Error", f"No se pudo quitar la asignacion:\n{error}")
