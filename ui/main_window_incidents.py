import html
from datetime import datetime, timedelta

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QIcon, QPixmap
from PyQt6.QtWidgets import (
    QFileDialog,
    QDialog,
    QInputDialog,
    QLabel,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
)
from managers.history_domain_rules import normalize_incident_status as normalize_domain_incident_status


def _can_operate_incidents(window):
    return bool(getattr(window, "can_operate_incidents", getattr(window, "is_admin", False)))


def _can_manage_assignments(window):
    return bool(
        getattr(window, "can_manage_operational_records", getattr(window, "is_admin", False))
    )


def normalize_incident_status(_window, raw_value):
    return normalize_domain_incident_status(raw_value)


def incident_status_label(window, raw_value):
    normalized = normalize_incident_status(window, raw_value)
    if normalized == "in_progress":
        return "En curso"
    if normalized == "paused":
        return "Pausada"
    if normalized == "resolved":
        return "Resuelta"
    return "Abierta"


def format_incident_datetime_label(window, raw_value):
    dt = window._parse_incident_datetime(raw_value)
    if dt is None:
        return str(raw_value or "-")
    return dt.strftime("%d/%m/%Y %H:%M")


def incident_severity_label(_window, raw_value):
    value = str(raw_value or "medium").strip().lower()
    labels = {
        "critical": "Crítica",
        "high": "Alta",
        "medium": "Media",
        "low": "Baja",
    }
    return labels.get(value, str(raw_value or "Media").strip().title() or "Media")


def _incident_detail_chip(text, background, text_color, border):
    return (
        f"<td style=\"padding:6px 10px;background:{background};color:{text_color};"
        f"border:1px solid {border};font-weight:600;white-space:nowrap;\">"
        f"{html.escape(str(text))}</td>"
    )


def _incident_detail_meta_row(label, value):
    safe_label = html.escape(str(label))
    safe_value = html.escape(str(value if value not in (None, "") else "-"))
    return (
        "<tr>"
        f"<td width=\"132\" valign=\"top\" style=\"padding:0 12px 8px 0;font-weight:600;\">{safe_label}</td>"
        f"<td valign=\"top\" style=\"padding:0 0 8px 0;\">{safe_value}</td>"
        "</tr>"
    )


def render_incident_detail_html(window, incident):
    colors = window.theme_manager.get_theme_colors() if window.theme_manager else {
        "surface_raised": "#ffffff",
        "surface": "#f7f9fc",
        "surface_alt": "#e6ebf2",
        "border": "#c7d0db",
        "text_primary": "#16202c",
        "text_secondary": "#4d5d70",
        "accent_soft": "rgba(31, 91, 147, 0.14)",
        "accent": "#1f5b93",
        "panel_info": "rgba(43, 106, 166, 0.12)",
        "panel_success": "rgba(47, 125, 82, 0.13)",
        "panel_warning": "rgba(139, 90, 28, 0.15)",
        "panel_error": "rgba(167, 66, 52, 0.14)",
        "success": "#2f7d52",
        "warning": "#8b5a1c",
        "error": "#a74234",
    }

    photos = incident.get("photos") or []
    incident_id = incident.get("id")
    record_id = incident.get("installation_id")
    incident_status = normalize_incident_status(window, incident.get("incident_status"))
    severity = str(incident.get("severity") or "medium").strip().lower()
    status_label = incident_status_label(window, incident_status)
    severity_label = incident_severity_label(window, severity)
    raw_adjustment = window._coerce_seconds(incident.get("time_adjustment_seconds"), allow_negative=True)
    note = str(incident.get("note") or "").strip()
    resolution_note = str(incident.get("resolution_note") or "").strip()
    evidence_note = str(incident.get("evidence_note") or "").strip()

    status_tones = {
        "open": (colors["panel_info"], colors["text_primary"], colors["accent"]),
        "in_progress": (colors["panel_warning"], colors["text_primary"], colors["warning"]),
        "paused": (colors["surface_alt"], colors["text_primary"], colors["border"]),
        "resolved": (colors["panel_success"], colors["text_primary"], colors["success"]),
    }
    severity_tones = {
        "critical": (colors["panel_error"], colors["text_primary"], colors["error"]),
        "high": (colors["panel_warning"], colors["text_primary"], colors["warning"]),
        "medium": (colors["accent_soft"], colors["text_primary"], colors["accent"]),
        "low": (colors["surface_alt"], colors["text_secondary"], colors["border"]),
    }
    status_bg, status_fg, status_border = status_tones.get(incident_status, status_tones["open"])
    severity_bg, severity_fg, severity_border = severity_tones.get(severity, severity_tones["medium"])

    chips = [
        _incident_detail_chip(f"Inc #{incident_id}", colors["surface_alt"], colors["text_primary"], colors["border"]),
        _incident_detail_chip(f"Estado: {status_label}", status_bg, status_fg, status_border),
        _incident_detail_chip(f"Severidad: {severity_label}", severity_bg, severity_fg, severity_border),
        _incident_detail_chip(f"Registro #{record_id}", colors["surface_alt"], colors["text_secondary"], colors["border"]),
        _incident_detail_chip(f"Fotos: {len(photos)}", colors["surface_alt"], colors["text_secondary"], colors["border"]),
    ]
    if raw_adjustment:
        chips.append(
            _incident_detail_chip(
                f"Tiempo: {window._format_duration(raw_adjustment)}",
                colors["accent_soft"],
                colors["text_primary"],
                colors["accent"],
            )
        )

    chip_rows = []
    for index in range(0, len(chips), 3):
        chip_rows.append(f"<tr>{''.join(chips[index:index + 3])}</tr>")

    context_rows = [
        _incident_detail_meta_row("Reportado por", incident.get("reporter_username") or "-"),
        _incident_detail_meta_row("Origen", incident.get("source") or "-"),
        _incident_detail_meta_row("Creada", format_incident_datetime_label(window, incident.get("created_at"))),
    ]
    if incident.get("status_updated_at"):
        context_rows.append(
            _incident_detail_meta_row(
                "Cambio de estado",
                f"{format_incident_datetime_label(window, incident.get('status_updated_at'))} · {incident.get('status_updated_by') or '-'}",
            )
        )
    if incident.get("resolved_at"):
        context_rows.append(
            _incident_detail_meta_row(
                "Resuelta",
                f"{format_incident_datetime_label(window, incident.get('resolved_at'))} · {incident.get('resolved_by') or '-'}",
            )
        )

    timing_rows = [
        _incident_detail_meta_row("Estado actual", status_label),
        _incident_detail_meta_row("Severidad", severity_label),
        _incident_detail_meta_row("Ajuste de tiempo", f"{window._format_duration(raw_adjustment)} ({raw_adjustment}s)"),
    ]
    actual_duration = incident.get("actual_duration_seconds")
    if actual_duration not in (None, ""):
        timing_rows.append(_incident_detail_meta_row("Tiempo real", window._format_duration(actual_duration)))
    estimated_duration = incident.get("estimated_duration_seconds")
    if estimated_duration not in (None, ""):
        timing_rows.append(_incident_detail_meta_row("Tiempo estimado", window._format_duration(estimated_duration)))

    optional_sections = []
    if evidence_note:
        optional_sections.append(
            "<table width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"margin-top:12px;\">"
            "<tr><td>"
            f"<div style=\"font-size:11px;font-weight:700;color:{colors['text_secondary']};margin-bottom:6px;\">"
            "NOTA OPERATIVA</div>"
            f"<table width=\"100%\" cellspacing=\"0\" cellpadding=\"12\" "
            f"style=\"background:{colors['surface']};border:1px solid {colors['border']};\">"
            f"<tr><td style=\"line-height:1.5;\">{html.escape(evidence_note)}</td></tr></table>"
            "</td></tr></table>"
        )
    if resolution_note:
        optional_sections.append(
            "<table width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"margin-top:12px;\">"
            "<tr><td>"
            f"<div style=\"font-size:11px;font-weight:700;color:{colors['text_secondary']};margin-bottom:6px;\">"
            "RESOLUCION</div>"
            f"<table width=\"100%\" cellspacing=\"0\" cellpadding=\"12\" "
            f"style=\"background:{colors['panel_success']};border:1px solid {colors['success']};\">"
            f"<tr><td style=\"line-height:1.5;\">{html.escape(resolution_note)}</td></tr></table>"
            "</td></tr></table>"
        )

    safe_note = html.escape(note or "Sin nota registrada.").replace("\n", "<br>")
    return f"""
    <div style="font-family:'Source Sans 3','Segoe UI Variable Text','Segoe UI',sans-serif;color:{colors['text_primary']};">
        <table cellspacing="6" cellpadding="0" style="margin-bottom:10px;">
            {''.join(chip_rows)}
        </table>
        <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:12px;">
            <tr>
                <td>
                    <table width="100%" cellspacing="0" cellpadding="14"
                           style="background:{colors['surface_raised']};border:1px solid {colors['border']};">
                        <tr>
                            <td>
                                <div style="font-size:11px;font-weight:700;color:{colors['text_secondary']};margin-bottom:8px;">
                                    RESUMEN
                                </div>
                                <div style="font-size:14px;line-height:1.55;">{safe_note}</div>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
        <table width="100%" cellspacing="10" cellpadding="0">
            <tr>
                <td width="50%" valign="top">
                    <table width="100%" cellspacing="0" cellpadding="14"
                           style="background:{colors['surface_raised']};border:1px solid {colors['border']};">
                        <tr><td><div style="font-size:11px;font-weight:700;color:{colors['text_secondary']};margin-bottom:8px;">CONTEXTO</div><table width="100%" cellspacing="0" cellpadding="0">{''.join(context_rows)}</table></td></tr>
                    </table>
                </td>
                <td width="50%" valign="top">
                    <table width="100%" cellspacing="0" cellpadding="14"
                           style="background:{colors['surface_raised']};border:1px solid {colors['border']};">
                        <tr><td><div style="font-size:11px;font-weight:700;color:{colors['text_secondary']};margin-bottom:8px;">ESTADO Y TIEMPOS</div><table width="100%" cellspacing="0" cellpadding="0">{''.join(timing_rows)}</table></td></tr>
                    </table>
                </td>
            </tr>
        </table>
        {''.join(optional_sections)}
    </div>
    """


def normalize_record_attention_state(_window, raw_value):
    state = str(raw_value or "").strip().lower()
    if state in {"clear", "open", "in_progress", "paused", "resolved", "critical"}:
        return state
    return "clear"


def record_attention_label(window, raw_value):
    normalized = normalize_record_attention_state(window, raw_value)
    if normalized == "critical":
        return "Crítica"
    if normalized == "in_progress":
        return "En curso"
    if normalized == "paused":
        return "Pausada"
    if normalized == "open":
        return "Abierta"
    if normalized == "resolved":
        return "Resuelta"
    return "Sin incidencias"


def record_attention_icon(window, raw_value):
    normalized = normalize_record_attention_state(window, raw_value)
    if normalized == "critical":
        return "!"
    if normalized == "in_progress":
        return "~"
    if normalized == "paused":
        return "="
    if normalized == "open":
        return "*"
    if normalized == "resolved":
        return "+"
    return "-"


def apply_incidents_filters(window):
    if not hasattr(window.history_tab, "incidents_installations_list"):
        return
    current_installation = window.history_tab.incidents_installations_list.currentItem()
    handle_incidents_installation_changed(window, current_installation)


def build_photo_thumbnail_icon(window, photo_id):
    return window._photo_thumbnail_cache.get(photo_id)


def _icon_from_photo_bytes(photo_bytes):
    pixmap = QPixmap()
    if not pixmap.loadFromData(photo_bytes):
        return None
    thumb = pixmap.scaled(
        96,
        72,
        Qt.AspectRatioMode.KeepAspectRatio,
        Qt.TransformationMode.SmoothTransformation,
    )
    return QIcon(thumb)


def queue_thumbnail_load(window, photo_id, *, worker_cls):
    if photo_id in window._photo_thumbnail_cache:
        return
    if photo_id in window._thumbnail_inflight:
        return

    window._thumbnail_inflight.add(photo_id)
    worker = worker_cls(window.history, photo_id)
    worker.signals.loaded.connect(window._on_thumbnail_loaded)
    worker.signals.failed.connect(window._on_thumbnail_failed)
    window._thumbnail_pool.start(worker)


def handle_thumbnail_loaded(window, photo_id, photo_bytes):
    window._thumbnail_inflight.discard(photo_id)
    icon = _icon_from_photo_bytes(photo_bytes)
    if icon is None:
        return

    window._photo_thumbnail_cache[photo_id] = icon
    item = window._thumbnail_item_map.get(photo_id)
    if item is None:
        return

    try:
        if window.history_tab.incident_photos_list.row(item) >= 0:
            item.setIcon(icon)
    except Exception:
        pass


def handle_thumbnail_failed(window, photo_id, _error):
    window._thumbnail_inflight.discard(photo_id)


def _reset_incident_lists(window):
    window.history_tab.incidents_list.clear()
    window.history_tab.incident_photos_list.clear()
    if hasattr(window.history_tab, "incident_assignments_list"):
        window.history_tab.incident_assignments_list.clear()
    if hasattr(window.history_tab, "installation_assignments_list"):
        window.history_tab.installation_assignments_list.clear()
    window._thumbnail_item_map.clear()
    window.history_tab.incident_detail.clear()
    window.history_tab.upload_incident_photo_btn.setEnabled(False)
    window.history_tab.view_incident_photo_btn.setEnabled(False)
    if hasattr(window.history_tab, "refresh_assignments_btn"):
        window.history_tab.refresh_assignments_btn.setEnabled(False)
    if hasattr(window.history_tab, "add_incident_assignment_btn"):
        window.history_tab.add_incident_assignment_btn.setEnabled(False)
    if hasattr(window.history_tab, "remove_incident_assignment_btn"):
        window.history_tab.remove_incident_assignment_btn.setEnabled(False)
    if hasattr(window.history_tab, "refresh_installation_assignments_btn"):
        window.history_tab.refresh_installation_assignments_btn.setEnabled(False)
    if hasattr(window.history_tab, "add_installation_assignment_btn"):
        window.history_tab.add_installation_assignment_btn.setEnabled(False)
    if hasattr(window.history_tab, "remove_installation_assignment_btn"):
        window.history_tab.remove_installation_assignment_btn.setEnabled(False)
    if hasattr(window.history_tab, "incident_mark_open_btn"):
        window.history_tab.incident_mark_open_btn.setEnabled(False)
        window.history_tab.incident_mark_progress_btn.setEnabled(False)
        window.history_tab.incident_mark_resolved_btn.setEnabled(False)


def refresh_incidents_view(window, preferred_record_id=None):
    if not hasattr(window.history_tab, "incidents_installations_list"):
        return

    current_item = window.history_tab.incidents_installations_list.currentItem()
    if preferred_record_id is None and current_item is not None:
        current_data = current_item.data(Qt.ItemDataRole.UserRole)
        if isinstance(current_data, dict):
            preferred_record_id = current_data.get("id")

    limit_text = window.history_tab.incidents_installations_limit.currentText()
    limit = window._parse_limit_from_text(limit_text, default=25)

    window.history_tab.incidents_installations_list.clear()
    _reset_incident_lists(window)
    if hasattr(window.history_tab, "create_incident_btn"):
        window.history_tab.create_incident_btn.setEnabled(False)

    try:
        installations = window.history.get_installations(limit=limit)
    except Exception as error:
        window.history_tab.incident_detail.setText(f"Error cargando registros: {error}")
        return

    selected_item = None
    for inst in installations:
        timestamp_raw = inst.get("timestamp")
        date_str = str(timestamp_raw or "")
        try:
            date_str = datetime.fromisoformat(str(timestamp_raw)).strftime("%d/%m/%Y %H:%M")
        except Exception:
            pass

        record_id = inst.get("id")
        brand = inst.get("driver_brand") or "N/A"
        version = inst.get("driver_version") or "N/A"
        client = inst.get("client_name") or "Sin cliente"
        text = f"#{record_id} {date_str} - {brand} v{version} ({client})"
        attention_label = record_attention_label(window, inst.get("attention_state"))
        attention_icon = record_attention_icon(window, inst.get("attention_state"))
        active_incidents = window._coerce_seconds(inst.get("incident_active_count"), allow_negative=False)
        if active_incidents > 0:
            text += f" | {attention_icon} {attention_label} ({active_incidents})"
        else:
            text += f" | {attention_icon} {attention_label}"

        item = QListWidgetItem(text)
        item.setData(Qt.ItemDataRole.UserRole, inst)
        window.history_tab.incidents_installations_list.addItem(item)

        if preferred_record_id is not None and record_id == preferred_record_id:
            selected_item = item

    if selected_item is not None:
        window.history_tab.incidents_installations_list.setCurrentItem(selected_item)
    elif window.history_tab.incidents_installations_list.count() > 0:
        window.history_tab.incidents_installations_list.setCurrentRow(0)
    else:
        window.history_tab.incident_detail.setText("No hay registros para mostrar en este rango.")


def handle_incidents_installation_changed(window, current, _previous=None):
    _reset_incident_lists(window)

    has_installation = current is not None
    if hasattr(window.history_tab, "create_incident_btn"):
        window.history_tab.create_incident_btn.setEnabled(
            has_installation and _can_operate_incidents(window)
        )
    if not has_installation:
        return

    if hasattr(window.history_tab, "refresh_installation_assignments_btn"):
        window.history_tab.refresh_installation_assignments_btn.setEnabled(True)
    if hasattr(window.history_tab, "add_installation_assignment_btn"):
        window.history_tab.add_installation_assignment_btn.setEnabled(_can_manage_assignments(window))

    installation = current.data(Qt.ItemDataRole.UserRole)
    if not isinstance(installation, dict):
        return

    record_id = installation.get("id")
    if record_id is None:
        return

    refresh_installation_assignments(window)

    try:
        incidents = window.history.get_incidents_for_installation(record_id)
    except Exception as error:
        window.history_tab.incident_detail.setText(f"Error cargando incidencias: {error}")
        return

    severity_filter = "todas"
    if hasattr(window.history_tab, "incidents_severity_filter"):
        severity_filter = str(
            window.history_tab.incidents_severity_filter.currentText() or "Todas"
        ).strip().lower()

    period_days = None
    if hasattr(window.history_tab, "incidents_period_filter"):
        period_days = window._period_days_from_text(window.history_tab.incidents_period_filter.currentText())

    cutoff = None
    if period_days is not None:
        cutoff = datetime.now() - timedelta(days=period_days)

    filtered_incidents = []
    for incident in incidents:
        incident_severity = str(incident.get("severity") or "").strip().lower()
        if severity_filter != "todas" and incident_severity != severity_filter:
            continue

        if cutoff is not None:
            incident_dt = window._parse_incident_datetime(incident.get("created_at"))
            if incident_dt is None or incident_dt < cutoff:
                continue

        filtered_incidents.append(incident)
        incident_id = incident.get("id")
        severity = str(incident.get("severity") or "N/A").upper()
        status_label = incident_status_label(window, incident.get("incident_status"))
        created_at = str(incident.get("created_at") or "")
        note_preview = (incident.get("note") or "").strip().replace("\n", " ")
        if len(note_preview) > 80:
            note_preview = note_preview[:77] + "..."
        text = f"#{incident_id} [{severity}/{status_label}] {created_at} - {note_preview or 'Sin nota'}"
        item = QListWidgetItem(text)
        item.setData(Qt.ItemDataRole.UserRole, incident)
        window.history_tab.incidents_list.addItem(item)

    if window.history_tab.incidents_list.count() > 0:
        window.history_tab.incidents_list.setCurrentRow(0)
    elif incidents and not filtered_incidents:
        window.history_tab.incident_detail.setText("No hay incidencias que coincidan con los filtros actuales.")
    else:
        window.history_tab.incident_detail.setText(f"No hay incidencias para el registro #{record_id}.")


def handle_incident_item_changed(window, current, _previous=None, *, worker_cls):
    window.history_tab.incident_photos_list.clear()
    window._thumbnail_item_map.clear()
    window.history_tab.view_incident_photo_btn.setEnabled(False)
    window.history_tab.upload_incident_photo_btn.setEnabled(
        current is not None and _can_operate_incidents(window)
    )
    if hasattr(window.history_tab, "incident_mark_open_btn"):
        window.history_tab.incident_mark_open_btn.setEnabled(False)
    if hasattr(window.history_tab, "incident_mark_progress_btn"):
        window.history_tab.incident_mark_progress_btn.setEnabled(False)
    if hasattr(window.history_tab, "incident_mark_resolved_btn"):
        window.history_tab.incident_mark_resolved_btn.setEnabled(False)
    if hasattr(window.history_tab, "remove_incident_assignment_btn"):
        window.history_tab.remove_incident_assignment_btn.setEnabled(False)

    if current is None:
        window.history_tab.incident_detail.clear()
        return

    incident = current.data(Qt.ItemDataRole.UserRole)
    if not isinstance(incident, dict):
        window.history_tab.incident_detail.clear()
        return

    incident_status = normalize_incident_status(window, incident.get("incident_status"))
    photos = incident.get("photos") or []
    window.history_tab.incident_detail.setHtml(render_incident_detail_html(window, incident))
    if hasattr(window.history_tab.incident_detail, "verticalScrollBar"):
        detail_scroll = window.history_tab.incident_detail.verticalScrollBar()
        if detail_scroll is not None:
            detail_scroll.setValue(0)
    if hasattr(window.history_tab, "refresh_assignments_btn"):
        window.history_tab.refresh_assignments_btn.setEnabled(True)
    if hasattr(window.history_tab, "add_incident_assignment_btn"):
        window.history_tab.add_incident_assignment_btn.setEnabled(_can_manage_assignments(window))
    if _can_operate_incidents(window) and hasattr(window.history_tab, "incident_mark_open_btn"):
        window.history_tab.incident_mark_open_btn.setEnabled(incident_status != "open")
        window.history_tab.incident_mark_progress_btn.setEnabled(incident_status != "in_progress")
        window.history_tab.incident_mark_resolved_btn.setEnabled(incident_status != "resolved")

    refresh_incident_assignments(window)

    for photo in photos:
        photo_id = photo.get("id")
        file_name = photo.get("file_name") or f"photo_{photo_id}"
        content_type = photo.get("content_type") or "image/*"
        label = f"#{photo_id} - {file_name} ({content_type})"
        item = QListWidgetItem(label)
        item.setData(Qt.ItemDataRole.UserRole, photo)
        if photo_id is not None:
            icon = build_photo_thumbnail_icon(window, photo_id)
            if icon is not None:
                item.setIcon(icon)
            else:
                queue_thumbnail_load(window, photo_id, worker_cls=worker_cls)
            window._thumbnail_item_map[photo_id] = item
        created_at = photo.get("created_at")
        if created_at:
            item.setToolTip(f"Fecha: {created_at}")
        window.history_tab.incident_photos_list.addItem(item)

    if window.history_tab.incident_photos_list.count() > 0:
        window.history_tab.incident_photos_list.setCurrentRow(0)
        window.history_tab.view_incident_photo_btn.setEnabled(True)


def _assignment_role_label(role):
    normalized = str(role or "owner").strip().lower()
    if normalized == "assistant":
        return "Apoyo"
    if normalized == "reviewer":
        return "Revision"
    return "Titular"


def _log_assignment_action(window, action, success, details):
    user_manager = getattr(window, "user_manager", None)
    current_user = getattr(user_manager, "current_user", None) if user_manager else None
    if not user_manager or not isinstance(current_user, dict):
        return
    if not hasattr(user_manager, "_log_access"):
        return
    username = str(current_user.get("username") or "desktop")
    try:
        user_manager._log_access(action, username, bool(success), details or {})
    except Exception:
        pass


def refresh_incident_assignments(window, *, message_box=None):
    if not hasattr(window.history_tab, "incident_assignments_list"):
        return
    if not getattr(window, "history", None):
        return
    if not hasattr(window.history, "list_entity_technician_assignments"):
        return

    current_incident = window.history_tab.incidents_list.currentItem()
    window.history_tab.incident_assignments_list.clear()
    if hasattr(window.history_tab, "remove_incident_assignment_btn"):
        window.history_tab.remove_incident_assignment_btn.setEnabled(False)

    if current_incident is None:
        return

    incident = current_incident.data(Qt.ItemDataRole.UserRole)
    incident_id = incident.get("id") if isinstance(incident, dict) else None
    if incident_id is None:
        return

    try:
        assignments = window.history.list_entity_technician_assignments(
            "incident",
            incident_id,
            include_inactive=False,
        )
    except Exception as error:
        if message_box is not None:
            message_box.warning(window, "Error", f"No se pudieron cargar asignaciones:\n{error}")
        else:
            window.history_tab.incident_assignments_list.addItem(
                f"Error cargando asignaciones: {error}"
            )
        return

    if not assignments:
        window.history_tab.incident_assignments_list.addItem("Sin asignaciones activas.")
        return

    for assignment in assignments:
        assignment_id = assignment.get("id")
        role_label = _assignment_role_label(assignment.get("assignment_role"))
        technician_name = assignment.get("technician_display_name") or f"Tecnico #{assignment.get('technician_id')}"
        code = str(assignment.get("technician_employee_code") or "").strip()
        code_suffix = f" ({code})" if code else ""
        text = f"[{role_label}] {technician_name}{code_suffix}"
        item = QListWidgetItem(text)
        item.setData(Qt.ItemDataRole.UserRole, assignment)
        window.history_tab.incident_assignments_list.addItem(item)

    if window.history_tab.incident_assignments_list.count() > 0:
        window.history_tab.incident_assignments_list.setCurrentRow(0)
        if hasattr(window.history_tab, "remove_incident_assignment_btn"):
            window.history_tab.remove_incident_assignment_btn.setEnabled(_can_manage_assignments(window))


def assign_technician_to_selected_incident(
    window,
    *,
    message_box=QMessageBox,
    input_dialog=QInputDialog,
):
    if not _can_manage_assignments(window):
        message_box.warning(
            window,
            "Acceso denegado",
            "Tu sesion no tiene permisos para gestionar asignaciones.",
        )
        return

    current_incident = window.history_tab.incidents_list.currentItem()
    if current_incident is None:
        message_box.warning(window, "Atencion", "Selecciona una incidencia primero.")
        return

    incident = current_incident.data(Qt.ItemDataRole.UserRole)
    incident_id = incident.get("id") if isinstance(incident, dict) else None
    if incident_id is None:
        message_box.warning(window, "Error", "No se pudo obtener el ID de la incidencia.")
        return

    try:
        technicians = window.history.list_technicians(include_inactive=False)
    except Exception as error:
        message_box.warning(window, "Error", f"No se pudo cargar el directorio de tecnicos:\n{error}")
        return

    if not technicians:
        message_box.information(window, "Sin tecnicos", "No hay tecnicos activos para asignar.")
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

    selected_label, ok = input_dialog.getItem(
        window,
        f"Asignar tecnico a incidencia #{incident_id}",
        "Tecnico:",
        choices,
        0,
        False,
    )
    if not ok:
        return

    selected_role, ok = input_dialog.getItem(
        window,
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
        message_box.warning(window, "Error", "No se pudo resolver el tecnico seleccionado.")
        return

    try:
        window.history.create_technician_assignment(
            technician_id=technician_id,
            entity_type="incident",
            entity_id=incident_id,
            assignment_role=selected_role,
        )
        _log_assignment_action(
            window,
            "incident_assignment_created",
            True,
            {
                "entity_type": "incident",
                "entity_id": incident_id,
                "technician_id": technician_id,
                "technician_display_name": selected_technician.get("display_name"),
                "assignment_role": selected_role,
            },
        )
        message_box.information(window, "Exito", "Asignacion creada correctamente.")
        refresh_incident_assignments(window, message_box=message_box)
    except Exception as error:
        _log_assignment_action(
            window,
            "incident_assignment_create_failed",
            False,
            {
                "entity_type": "incident",
                "entity_id": incident_id,
                "technician_id": technician_id,
                "assignment_role": selected_role,
                "error": str(error),
            },
        )
        message_box.warning(window, "Error", f"No se pudo crear la asignacion:\n{error}")


def remove_selected_incident_assignment(window, *, message_box=QMessageBox):
    if not _can_manage_assignments(window):
        message_box.warning(
            window,
            "Acceso denegado",
            "Tu sesion no tiene permisos para gestionar asignaciones.",
        )
        return

    if not hasattr(window.history_tab, "incident_assignments_list"):
        return

    current_assignment_item = window.history_tab.incident_assignments_list.currentItem()
    if current_assignment_item is None:
        message_box.warning(window, "Atencion", "Selecciona una asignacion primero.")
        return

    assignment = current_assignment_item.data(Qt.ItemDataRole.UserRole)
    assignment_id = assignment.get("id") if isinstance(assignment, dict) else None
    if assignment_id is None:
        message_box.warning(window, "Atencion", "La fila seleccionada no corresponde a una asignacion activa.")
        return

    reply = message_box.question(
        window,
        "Confirmar",
        f"¿Quitar asignacion #{assignment_id}?",
        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
    )
    if reply != QMessageBox.StandardButton.Yes:
        return

    try:
        window.history.remove_technician_assignment(assignment_id)
        _log_assignment_action(
            window,
            "incident_assignment_removed",
            True,
            {
                "entity_type": "incident",
                "assignment_id": assignment_id,
            },
        )
        message_box.information(window, "Exito", "Asignacion quitada correctamente.")
        refresh_incident_assignments(window, message_box=message_box)
    except Exception as error:
        _log_assignment_action(
            window,
            "incident_assignment_remove_failed",
            False,
            {
                "entity_type": "incident",
                "assignment_id": assignment_id,
                "error": str(error),
            },
        )
        message_box.warning(window, "Error", f"No se pudo quitar la asignacion:\n{error}")


def refresh_installation_assignments(window, *, message_box=None):
    if not hasattr(window.history_tab, "installation_assignments_list"):
        return
    if not getattr(window, "history", None):
        return
    if not hasattr(window.history, "list_entity_technician_assignments"):
        return

    current_installation = window.history_tab.incidents_installations_list.currentItem()
    window.history_tab.installation_assignments_list.clear()
    if hasattr(window.history_tab, "remove_installation_assignment_btn"):
        window.history_tab.remove_installation_assignment_btn.setEnabled(False)

    if current_installation is None:
        return

    installation = current_installation.data(Qt.ItemDataRole.UserRole)
    record_id = installation.get("id") if isinstance(installation, dict) else None
    if record_id is None:
        return

    try:
        assignments = window.history.list_entity_technician_assignments(
            "installation",
            record_id,
            include_inactive=False,
        )
    except Exception as error:
        if message_box is not None:
            message_box.warning(window, "Error", f"No se pudieron cargar asignaciones del registro:\n{error}")
        else:
            window.history_tab.installation_assignments_list.addItem(
                f"Error cargando asignaciones: {error}"
            )
        return

    if not assignments:
        window.history_tab.installation_assignments_list.addItem("Sin asignaciones activas.")
        return

    for assignment in assignments:
        assignment_id = assignment.get("id")
        role_label = _assignment_role_label(assignment.get("assignment_role"))
        technician_name = assignment.get("technician_display_name") or f"Tecnico #{assignment.get('technician_id')}"
        code = str(assignment.get("technician_employee_code") or "").strip()
        code_suffix = f" ({code})" if code else ""
        text = f"[{role_label}] {technician_name}{code_suffix}"
        item = QListWidgetItem(text)
        item.setData(Qt.ItemDataRole.UserRole, assignment)
        window.history_tab.installation_assignments_list.addItem(item)

    if window.history_tab.installation_assignments_list.count() > 0:
        window.history_tab.installation_assignments_list.setCurrentRow(0)
        if hasattr(window.history_tab, "remove_installation_assignment_btn"):
            window.history_tab.remove_installation_assignment_btn.setEnabled(_can_manage_assignments(window))


def assign_technician_to_selected_installation(
    window,
    *,
    message_box=QMessageBox,
    input_dialog=QInputDialog,
):
    if not _can_manage_assignments(window):
        message_box.warning(
            window,
            "Acceso denegado",
            "Tu sesion no tiene permisos para gestionar asignaciones.",
        )
        return

    current_installation = window.history_tab.incidents_installations_list.currentItem()
    if current_installation is None:
        message_box.warning(window, "Atencion", "Selecciona un registro primero.")
        return

    installation = current_installation.data(Qt.ItemDataRole.UserRole)
    record_id = installation.get("id") if isinstance(installation, dict) else None
    if record_id is None:
        message_box.warning(window, "Error", "No se pudo obtener el ID del registro.")
        return

    try:
        technicians = window.history.list_technicians(include_inactive=False)
    except Exception as error:
        message_box.warning(window, "Error", f"No se pudo cargar el directorio de tecnicos:\n{error}")
        return

    if not technicians:
        message_box.information(window, "Sin tecnicos", "No hay tecnicos activos para asignar.")
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

    selected_label, ok = input_dialog.getItem(
        window,
        f"Asignar tecnico a registro #{record_id}",
        "Tecnico:",
        choices,
        0,
        False,
    )
    if not ok:
        return

    selected_role, ok = input_dialog.getItem(
        window,
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
        message_box.warning(window, "Error", "No se pudo resolver el tecnico seleccionado.")
        return

    try:
        window.history.create_technician_assignment(
            technician_id=technician_id,
            entity_type="installation",
            entity_id=record_id,
            assignment_role=selected_role,
        )
        _log_assignment_action(
            window,
            "installation_assignment_created",
            True,
            {
                "entity_type": "installation",
                "entity_id": record_id,
                "technician_id": technician_id,
                "technician_display_name": selected_technician.get("display_name"),
                "assignment_role": selected_role,
            },
        )
        message_box.information(window, "Exito", "Asignacion creada correctamente.")
        refresh_installation_assignments(window, message_box=message_box)
    except Exception as error:
        _log_assignment_action(
            window,
            "installation_assignment_create_failed",
            False,
            {
                "entity_type": "installation",
                "entity_id": record_id,
                "technician_id": technician_id,
                "assignment_role": selected_role,
                "error": str(error),
            },
        )
        message_box.warning(window, "Error", f"No se pudo crear la asignacion:\n{error}")


def remove_selected_installation_assignment(window, *, message_box=QMessageBox):
    if not _can_manage_assignments(window):
        message_box.warning(
            window,
            "Acceso denegado",
            "Tu sesion no tiene permisos para gestionar asignaciones.",
        )
        return

    if not hasattr(window.history_tab, "installation_assignments_list"):
        return

    current_assignment_item = window.history_tab.installation_assignments_list.currentItem()
    if current_assignment_item is None:
        message_box.warning(window, "Atencion", "Selecciona una asignacion primero.")
        return

    assignment = current_assignment_item.data(Qt.ItemDataRole.UserRole)
    assignment_id = assignment.get("id") if isinstance(assignment, dict) else None
    if assignment_id is None:
        message_box.warning(window, "Atencion", "La fila seleccionada no corresponde a una asignacion activa.")
        return

    reply = message_box.question(
        window,
        "Confirmar",
        f"¿Quitar asignacion #{assignment_id}?",
        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
    )
    if reply != QMessageBox.StandardButton.Yes:
        return

    try:
        window.history.remove_technician_assignment(assignment_id)
        _log_assignment_action(
            window,
            "installation_assignment_removed",
            True,
            {
                "entity_type": "installation",
                "assignment_id": assignment_id,
            },
        )
        message_box.information(window, "Exito", "Asignacion quitada correctamente.")
        refresh_installation_assignments(window, message_box=message_box)
    except Exception as error:
        _log_assignment_action(
            window,
            "installation_assignment_remove_failed",
            False,
            {
                "entity_type": "installation",
                "assignment_id": assignment_id,
                "error": str(error),
            },
        )
        message_box.warning(window, "Error", f"No se pudo quitar la asignacion:\n{error}")


def create_incident_from_incidents_view(window, *, message_box=QMessageBox):
    if not _can_operate_incidents(window):
        message_box.warning(window, "Acceso denegado", "Tu sesión no tiene permisos operativos para incidencias.")
        return

    current_installation = window.history_tab.incidents_installations_list.currentItem()
    if current_installation is None:
        message_box.warning(window, "Atención", "Selecciona un registro primero.")
        return

    installation = current_installation.data(Qt.ItemDataRole.UserRole)
    record_id = installation.get("id") if isinstance(installation, dict) else None
    if record_id is None:
        message_box.warning(window, "Error", "No se pudo obtener el ID de registro.")
        return

    window.create_incident_for_record(record_id)


def upload_photo_for_selected_incident(window, *, message_box=QMessageBox):
    if not _can_operate_incidents(window):
        message_box.warning(window, "Acceso denegado", "Tu sesión no tiene permisos operativos para incidencias.")
        return

    current_incident = window.history_tab.incidents_list.currentItem()
    if current_incident is None:
        message_box.warning(window, "Atención", "Selecciona una incidencia primero.")
        return

    incident = current_incident.data(Qt.ItemDataRole.UserRole)
    incident_id = incident.get("id") if isinstance(incident, dict) else None
    if incident_id is None:
        message_box.warning(window, "Error", "No se pudo obtener el ID de incidencia.")
        return

    window._upload_photo_for_incident(incident_id)
    current_installation = window.history_tab.incidents_installations_list.currentItem()
    window._on_incidents_installation_changed(current_installation)


def update_selected_incident_status(
    window,
    new_status,
    *,
    message_box=QMessageBox,
    input_dialog=QInputDialog,
):
    if not _can_operate_incidents(window):
        message_box.warning(window, "Acceso denegado", "Tu sesión no tiene permisos operativos para incidencias.")
        return

    current_incident = window.history_tab.incidents_list.currentItem()
    if current_incident is None:
        message_box.warning(window, "Atención", "Selecciona una incidencia primero.")
        return

    incident = current_incident.data(Qt.ItemDataRole.UserRole)
    incident_id = incident.get("id") if isinstance(incident, dict) else None
    if incident_id is None:
        message_box.warning(window, "Error", "No se pudo obtener el ID de incidencia.")
        return

    resolution_note = ""
    if new_status == "resolved":
        resolution_note, ok = input_dialog.getMultiLineText(
            window,
            "Resolver incidencia",
            "Nota de resolución (opcional):",
            str((incident or {}).get("resolution_note") or ""),
        )
        if not ok:
            return

    reporter = "desktop"
    if window.user_manager and window.user_manager.current_user:
        reporter = window.user_manager.current_user.get("username", "desktop")

    try:
        window.history.update_incident_status(
            incident_id=incident_id,
            incident_status=new_status,
            resolution_note=resolution_note,
            reporter_username=reporter,
        )
        message_box.information(
            window,
            "Estado actualizado",
            f"Incidencia #{incident_id} actualizada a {incident_status_label(window, new_status)}.",
        )
        current_installation = window.history_tab.incidents_installations_list.currentItem()
        window._on_incidents_installation_changed(current_installation)
    except Exception as error:
        message_box.critical(window, "Error", f"No se pudo actualizar el estado:\n{error}")


def view_selected_incident_photo(window, *, message_box=QMessageBox):
    current_photo = window.history_tab.incident_photos_list.currentItem()
    if current_photo is None:
        message_box.information(window, "Sin foto", "Selecciona una foto de la lista.")
        return

    photo = current_photo.data(Qt.ItemDataRole.UserRole)
    photo_id = photo.get("id") if isinstance(photo, dict) else None
    if photo_id is None:
        message_box.warning(window, "Error", "No se pudo obtener el ID de la foto.")
        return

    window._open_photo_viewer(photo_id, current_photo.text())


def show_incidents_for_selected_record(window, *, message_box=QMessageBox):
    selected_items = window.history_tab.history_list.selectedItems()
    if not selected_items:
        message_box.warning(window, "Atención", "Selecciona un registro del historial primero.")
        return

    record_id = selected_items[0].data(Qt.ItemDataRole.UserRole)
    if record_id is None:
        message_box.warning(window, "Error", "No se pudo obtener el ID del registro.")
        return

    if hasattr(window, "incidents_tab_index"):
        window.tabs.setCurrentIndex(window.incidents_tab_index)
    window.refresh_incidents_view(preferred_record_id=record_id)


def create_incident_for_record(
    window,
    record_id,
    *,
    message_box=QMessageBox,
    input_dialog=QInputDialog,
):
    if not _can_operate_incidents(window):
        message_box.warning(window, "Acceso denegado", "Tu sesión no tiene permisos operativos para incidencias.")
        return

    window._show_status_hint(f"Creando incidencia para el registro #{record_id}.", "info", 4200)

    note, ok = input_dialog.getMultiLineText(
        window,
        f"Nueva incidencia para registro #{record_id}",
        "Detalle de la incidencia:",
        "",
    )
    if not ok:
        return
    note = (note or "").strip()
    if not note:
        message_box.warning(window, "Atención", "La incidencia requiere un detalle.")
        return

    severity, ok = input_dialog.getItem(
        window,
        "Severidad",
        "Selecciona severidad:",
        ["low", "medium", "high", "critical"],
        1,
        False,
    )
    if not ok:
        return

    adjust_text, ok = input_dialog.getText(
        window,
        "Ajuste de tiempo",
        "Duración a ajustar (ej: -90, 5m, 1h30m):",
        text="0",
    )
    if not ok:
        return

    try:
        time_adjustment = window._parse_duration_input_seconds(adjust_text)
    except ValueError:
        message_box.warning(
            window,
            "Error",
            "Formato inválido. Usa segundos enteros o formato 5m / 1h30m / -2m.",
        )
        return

    apply_item, ok = input_dialog.getItem(
        window,
        "Aplicar a registro",
        "¿Aplicar nota/tiempo al registro?",
        ["No", "Sí"],
        0,
        False,
    )
    if not ok:
        return

    reporter = "desktop"
    if window.user_manager and window.user_manager.current_user:
        reporter = window.user_manager.current_user.get("username", "desktop")

    try:
        incident = window.history.create_incident(
            installation_id=record_id,
            note=note,
            severity=severity,
            reporter_username=reporter,
            time_adjustment_seconds=time_adjustment,
            apply_to_installation=(apply_item == "Sí"),
            source="desktop",
        )
        incident_id = incident.get("id") if isinstance(incident, dict) else None
        message = "Incidencia creada correctamente."
        if incident_id:
            message += f"\nID: {incident_id}"
        message_box.information(window, "Éxito", message)
        window._show_status_hint("Incidencia registrada y listas actualizadas.", "success", 5000)
        window.refresh_history_view()
        if hasattr(window.history_tab, "incidents_installations_list"):
            window.refresh_incidents_view(preferred_record_id=record_id)
    except Exception as error:
        message_box.critical(window, "Error", f"No se pudo crear la incidencia:\n{error}")
        window._show_status_hint(
            "No se pudo crear la incidencia. Revisa los datos e intenta nuevamente.",
            "error",
            5000,
        )


def show_incident_details(
    window,
    incident,
    *,
    dialog_cls=QDialog,
    layout_cls=QVBoxLayout,
    text_edit_cls=QTextEdit,
    button_cls=QPushButton,
):
    details_dialog = dialog_cls(window)
    details_dialog.setWindowTitle(f"Incidencia #{incident.get('id')}")
    details_dialog.resize(760, 560)
    details_dialog.setStyleSheet(window.theme_manager.generate_stylesheet())

    layout = layout_cls(details_dialog)
    details_view = text_edit_cls()
    details_view.setReadOnly(True)
    details_view.setHtml(render_incident_detail_html(window, incident))
    layout.addWidget(details_view)

    close_btn = button_cls("Cerrar")
    close_btn.clicked.connect(details_dialog.accept)
    layout.addWidget(close_btn, alignment=Qt.AlignmentFlag.AlignRight)
    details_dialog.exec()


def select_incident_photo(window, incident, *, message_box=QMessageBox, input_dialog=QInputDialog):
    photos = incident.get("photos") or []
    if not photos:
        message_box.information(window, "Sin fotos", "Esta incidencia no tiene fotos asociadas.")
        return

    choices = []
    photo_map = {}
    for photo in photos:
        photo_id = photo.get("id")
        file_name = photo.get("file_name") or f"photo_{photo_id}"
        content_type = photo.get("content_type") or "image/*"
        choice = f"#{photo_id} - {file_name} ({content_type})"
        choices.append(choice)
        photo_map[choice] = photo

    selected_photo, ok = input_dialog.getItem(
        window,
        f"Fotos de incidencia #{incident.get('id')}",
        "Selecciona foto:",
        choices,
        0,
        False,
    )
    if not ok:
        return

    photo = photo_map.get(selected_photo)
    photo_id = photo.get("id") if photo else None
    if photo_id is None:
        message_box.warning(window, "Error", "No se pudo obtener el ID de la foto.")
        return
    window._open_photo_viewer(photo_id, selected_photo)


def open_photo_viewer(
    window,
    photo_id,
    title,
    *,
    message_box=QMessageBox,
    dialog_cls=QDialog,
    layout_cls=QVBoxLayout,
    label_cls=QLabel,
    button_cls=QPushButton,
    pixmap_cls=QPixmap,
):
    try:
        photo_bytes, _content_type = window.history.get_photo_content(photo_id)
    except Exception as error:
        message_box.critical(window, "Error", f"No se pudo descargar la foto #{photo_id}:\n{error}")
        return

    pixmap = pixmap_cls()
    if not pixmap.loadFromData(photo_bytes):
        message_box.warning(
            window,
            "Formato no soportado",
            "No se pudo renderizar la imagen en el visor de Qt.",
        )
        return

    viewer = dialog_cls(window)
    viewer.setWindowTitle(f"Foto {title}")
    viewer.resize(920, 700)

    layout = layout_cls(viewer)
    image_label = label_cls()
    image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
    image_label.setPixmap(
        pixmap.scaled(
            880,
            620,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
    )
    layout.addWidget(image_label)

    close_btn = button_cls("Cerrar")
    close_btn.clicked.connect(viewer.accept)
    layout.addWidget(close_btn)
    viewer.exec()


def upload_photo_for_incident(
    window,
    incident_id,
    *,
    message_box=QMessageBox,
    file_dialog=QFileDialog,
):
    if incident_id is None:
        message_box.warning(window, "Error", "Incidencia inválida.")
        return

    file_path, _ = file_dialog.getOpenFileName(
        window,
        f"Subir foto a incidencia #{incident_id}",
        "",
        "Imágenes (*.jpg *.jpeg *.png *.webp)",
    )
    if not file_path:
        return

    try:
        photo = window.history.upload_incident_photo(incident_id, file_path)
        photo_id = photo.get("id") if isinstance(photo, dict) else None
        message = "Foto subida correctamente."
        if photo_id:
            message += f"\nID: {photo_id}"
        message_box.information(window, "Éxito", message)
    except Exception as error:
        message_box.critical(window, "Error", f"No se pudo subir la foto:\n{error}")
