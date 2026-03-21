from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QSplitter,
    QTextEdit,
    QVBoxLayout,
    QWidget,
    QComboBox,
)

from ui.dialogs.qr_generator_dialog import QrGeneratorDialog
from ui.theme_manager import resolve_theme_manager


class AssetManagementDialog(QDialog):
    """Dialogo para gestionar equipos en desktop."""

    def __init__(self, history_manager, parent=None, can_edit=False, can_delete=False):
        super().__init__(parent)
        self.theme_manager = resolve_theme_manager(parent)
        self.colors = self.theme_manager.get_theme_colors()
        self._history = history_manager
        self._can_edit = bool(can_edit)
        self._can_delete = bool(can_delete)
        self._parent_main = parent
        self._assets = []
        self._selected_asset_id = None
        self._selected_asset_code = ""
        self._active_installation_id = None

        self.setWindowTitle("Gestion de equipos")
        self.setMinimumSize(1280, 820)
        self.setStyleSheet(self.theme_manager.generate_stylesheet())

        self._build_ui()
        self._bind_events()
        self._apply_permissions()
        self.refresh_assets()

    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(10)

        search_layout = QHBoxLayout()
        search_layout.addWidget(QLabel("Buscar:"))
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Codigo, marca, modelo, serie o cliente")
        search_layout.addWidget(self.search_input)
        self.search_btn = QPushButton("Buscar")
        search_layout.addWidget(self.search_btn)
        self.refresh_btn = QPushButton("Actualizar")
        search_layout.addWidget(self.refresh_btn)
        self.new_btn = QPushButton("Nuevo")
        search_layout.addWidget(self.new_btn)
        root.addLayout(search_layout)

        self.summary_label = QLabel("Cargando equipos...")
        root.addWidget(self.summary_label)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setChildrenCollapsible(False)
        root.addWidget(splitter, 1)

        left_panel = QWidget()
        left_panel.setMinimumWidth(340)
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.addWidget(QLabel("Equipos"))
        self.assets_list = QListWidget()
        left_layout.addWidget(self.assets_list, 1)
        splitter.addWidget(left_panel)

        right_panel = QWidget()
        right_panel.setMinimumWidth(840)
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(0, 0, 0, 0)

        form_group = QGroupBox("Detalle del equipo")
        form_layout = QFormLayout(form_group)
        form_layout.setLabelAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        form_layout.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)
        form_layout.setHorizontalSpacing(12)
        form_layout.setVerticalSpacing(10)
        self.asset_id_label = QLabel("-")
        self.external_code_input = QLineEdit()
        self.brand_input = QLineEdit()
        self.model_input = QLineEdit()
        self.serial_input = QLineEdit()
        self.client_input = QLineEdit()
        self.status_combo = QComboBox()
        self.status_combo.addItems(["active", "inactive", "retired"])
        self.notes_input = QTextEdit()
        self.notes_input.setFixedHeight(110)

        for widget in (
            self.external_code_input,
            self.brand_input,
            self.model_input,
            self.serial_input,
            self.client_input,
            self.status_combo,
        ):
            widget.setMinimumHeight(34)

        form_layout.addRow("ID:", self.asset_id_label)
        form_layout.addRow("Codigo externo:", self.external_code_input)
        form_layout.addRow("Marca:", self.brand_input)
        form_layout.addRow("Modelo:", self.model_input)
        form_layout.addRow("Serie:", self.serial_input)
        form_layout.addRow("Cliente:", self.client_input)
        form_layout.addRow("Estado:", self.status_combo)
        form_layout.addRow("Notas:", self.notes_input)
        for row in range(form_layout.rowCount()):
            label_item = form_layout.itemAt(row, QFormLayout.ItemRole.LabelRole)
            if label_item is not None and label_item.widget() is not None:
                label_item.widget().setMinimumWidth(140)
        right_layout.addWidget(form_group)

        actions_layout = QHBoxLayout()
        self.save_btn = QPushButton("Guardar equipo")
        self.delete_btn = QPushButton("Eliminar equipo")
        self.link_btn = QPushButton("Asociar a instalacion")
        self.incident_btn = QPushButton("Crear incidencia")
        self.qr_btn = QPushButton("QR del equipo")
        actions_layout.addWidget(self.save_btn)
        actions_layout.addWidget(self.delete_btn)
        actions_layout.addWidget(self.link_btn)
        actions_layout.addWidget(self.incident_btn)
        actions_layout.addWidget(self.qr_btn)
        actions_layout.addStretch()
        right_layout.addLayout(actions_layout)

        self.status_label = QLabel("")
        self.status_label.setWordWrap(True)
        right_layout.addWidget(self.status_label)

        links_group = QGroupBox("Vinculos de instalacion")
        links_layout = QVBoxLayout(links_group)
        self.links_text = QTextEdit()
        self.links_text.setReadOnly(True)
        self.links_text.setFixedHeight(120)
        links_layout.addWidget(self.links_text)
        right_layout.addWidget(links_group)

        incidents_group = QGroupBox("Incidencias del equipo")
        incidents_layout = QVBoxLayout(incidents_group)
        self.incidents_list = QListWidget()
        incidents_layout.addWidget(self.incidents_list)
        right_layout.addWidget(incidents_group, 1)

        splitter.addWidget(right_panel)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 3)
        splitter.setSizes([360, 920])

        bottom_layout = QHBoxLayout()
        bottom_layout.addStretch()
        self.close_btn = QPushButton("Cerrar")
        bottom_layout.addWidget(self.close_btn)
        root.addLayout(bottom_layout)

    def _bind_events(self):
        self.search_btn.clicked.connect(self.refresh_assets)
        self.refresh_btn.clicked.connect(self.refresh_assets)
        self.new_btn.clicked.connect(self.new_asset)
        self.search_input.returnPressed.connect(self.refresh_assets)
        self.assets_list.currentItemChanged.connect(self._on_asset_selected)
        self.save_btn.clicked.connect(self.save_asset)
        self.delete_btn.clicked.connect(self.delete_selected_asset)
        self.link_btn.clicked.connect(self.link_selected_asset)
        self.incident_btn.clicked.connect(self.create_incident_for_active_link)
        self.qr_btn.clicked.connect(self.open_qr_for_selected_asset)
        self.close_btn.clicked.connect(self.accept)

    def _apply_permissions(self):
        editable = self._can_edit
        self.external_code_input.setReadOnly(not editable)
        self.brand_input.setReadOnly(not editable)
        self.model_input.setReadOnly(not editable)
        self.serial_input.setReadOnly(not editable)
        self.client_input.setReadOnly(not editable)
        self.status_combo.setEnabled(editable)
        self.notes_input.setReadOnly(not editable)
        self.save_btn.setEnabled(editable)
        self.delete_btn.setEnabled(False)
        self.delete_btn.setVisible(self._can_delete)

    def _set_status(self, text, error=False):
        css_class = "error" if error else "info"
        self.status_label.setProperty("class", css_class)
        self.status_label.style().unpolish(self.status_label)
        self.status_label.style().polish(self.status_label)
        self.status_label.setText(str(text or ""))

    def _format_asset_list_item(self, asset):
        asset_id = asset.get("id")
        code = str(asset.get("external_code") or "-")
        brand = str(asset.get("brand") or "-")
        model = str(asset.get("model") or "-")
        serial = str(asset.get("serial_number") or "-")
        client = str(asset.get("client_name") or "-")
        return f"#{asset_id} | {code} | {brand} {model} | SN: {serial} | Cliente: {client}"

    def _clear_detail(self):
        self._selected_asset_id = None
        self._selected_asset_code = ""
        self._active_installation_id = None
        self.asset_id_label.setText("-")
        self.external_code_input.clear()
        self.brand_input.clear()
        self.model_input.clear()
        self.serial_input.clear()
        self.client_input.clear()
        self.status_combo.setCurrentText("active")
        self.notes_input.clear()
        self.links_text.clear()
        self.incidents_list.clear()
        self.link_btn.setEnabled(False)
        self.qr_btn.setEnabled(False)
        self.incident_btn.setEnabled(False)
        self.delete_btn.setEnabled(False)

    def _set_form_from_asset(self, asset):
        self._selected_asset_id = asset.get("id")
        self._selected_asset_code = str(asset.get("external_code") or "").strip()
        self.asset_id_label.setText(str(self._selected_asset_id or "-"))
        self.external_code_input.setText(self._selected_asset_code)
        self.brand_input.setText(str(asset.get("brand") or ""))
        self.model_input.setText(str(asset.get("model") or ""))
        self.serial_input.setText(str(asset.get("serial_number") or ""))
        self.client_input.setText(str(asset.get("client_name") or ""))
        status = str(asset.get("status") or "active")
        idx = self.status_combo.findText(status)
        self.status_combo.setCurrentIndex(idx if idx >= 0 else 0)
        self.notes_input.setPlainText(str(asset.get("notes") or ""))
        self.link_btn.setEnabled(self._selected_asset_id is not None)
        self.qr_btn.setEnabled(bool(self._selected_asset_code))
        self.delete_btn.setEnabled(self._can_delete and self._selected_asset_id is not None)

    def _render_links(self, active_link, links):
        lines = []
        if active_link:
            self._active_installation_id = active_link.get("installation_id")
            lines.append(
                f"Instalacion activa: #{self._active_installation_id} "
                f"(desde {active_link.get('linked_at') or '-'})"
            )
        else:
            self._active_installation_id = None
            lines.append("Sin instalacion activa vinculada.")

        if links:
            lines.append("")
            lines.append("Historial:")
            for link in links[:12]:
                linked_at = link.get("linked_at") or "-"
                unlinked_at = link.get("unlinked_at")
                state = "activa" if not unlinked_at else f"cerrada {unlinked_at}"
                lines.append(
                    f"- #{link.get('installation_id')} | {linked_at} | {state}"
                )

        self.links_text.setText("\n".join(lines))
        self.incident_btn.setEnabled(self._active_installation_id is not None)

    def _render_incidents(self, incidents):
        self.incidents_list.clear()
        if not incidents:
            self.incidents_list.addItem(QListWidgetItem("Sin incidencias registradas."))
            return

        for incident in incidents:
            incident_id = incident.get("id")
            severity = str(incident.get("severity") or "n/a").upper()
            incident_status = str(incident.get("incident_status") or "open").strip().lower()
            if incident_status == "in_progress":
                status_label = "EN CURSO"
            elif incident_status == "paused":
                status_label = "PAUSADA"
            elif incident_status == "resolved":
                status_label = "RESUELTA"
            else:
                status_label = "ABIERTA"
            created_at = str(incident.get("created_at") or "-")
            note = str(incident.get("note") or "").replace("\n", " ").strip()
            if len(note) > 100:
                note = f"{note[:97]}..."
            item = QListWidgetItem(
                f"#{incident_id} [{severity}/{status_label}] {created_at} - {note or 'Sin detalle'}"
            )
            item.setData(Qt.ItemDataRole.UserRole, incident)
            self.incidents_list.addItem(item)

    def refresh_assets(self):
        self._set_status("")
        self.assets_list.clear()
        self._clear_detail()

        search = self.search_input.text().strip() or None
        try:
            self._assets = self._history.get_assets(limit=300, search=search)
        except Exception as exc:
            self.summary_label.setText("Error cargando equipos")
            self._set_status(f"No se pudieron cargar equipos: {exc}", error=True)
            return

        for asset in self._assets:
            item = QListWidgetItem(self._format_asset_list_item(asset))
            item.setData(Qt.ItemDataRole.UserRole, asset)
            self.assets_list.addItem(item)

        total = len(self._assets)
        self.summary_label.setText(f"Mostrando {total} equipo(s)")
        if total > 0:
            self.assets_list.setCurrentRow(0)
        else:
            self._set_status("No hay equipos para el filtro seleccionado.")

    def _on_asset_selected(self, current, _previous=None):
        if current is None:
            self._clear_detail()
            return

        selected_asset = current.data(Qt.ItemDataRole.UserRole)
        if not isinstance(selected_asset, dict):
            self._clear_detail()
            return

        asset_id = selected_asset.get("id")
        if not asset_id:
            self._clear_detail()
            return

        try:
            payload = self._history.get_asset_incidents(asset_id, limit=120)
        except Exception as exc:
            self._set_form_from_asset(selected_asset)
            self._set_status(f"No se pudo cargar el detalle del equipo: {exc}", error=True)
            return

        asset = payload.get("asset") if isinstance(payload, dict) else None
        self._set_form_from_asset(asset if isinstance(asset, dict) else selected_asset)
        self._render_links(payload.get("active_link"), payload.get("links") or [])
        self._render_incidents(payload.get("incidents") or [])
        self._set_status("")

    def new_asset(self):
        self.assets_list.clearSelection()
        self._clear_detail()
        self._set_status("Nuevo equipo listo para guardar.")

    def _collect_form_payload(self):
        external_code = str(self.external_code_input.text() or "").strip()
        brand = str(self.brand_input.text() or "").strip()
        model = str(self.model_input.text() or "").strip()
        serial = str(self.serial_input.text() or "").strip()
        client = str(self.client_input.text() or "").strip()
        status = str(self.status_combo.currentText() or "active").strip()
        notes = str(self.notes_input.toPlainText() or "").strip()

        if not external_code:
            raise ValueError("El codigo externo es obligatorio.")
        if not (brand or model):
            raise ValueError("Debes ingresar marca o modelo.")
        if not serial:
            raise ValueError("El numero de serie es obligatorio.")

        return {
            "external_code": external_code,
            "brand": brand,
            "model": model,
            "serial_number": serial,
            "client_name": client,
            "status": status,
            "notes": notes,
        }

    def save_asset(self):
        if not self._can_edit:
            QMessageBox.warning(
                self,
                "Permiso insuficiente",
                "Solo administradores pueden guardar equipos.",
            )
            return

        if self._selected_asset_id:
            reply = QMessageBox.question(
                self,
                "Confirmar cambios",
                "Vas a modificar un equipo existente.\n\n¿Deseas continuar?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        try:
            payload = self._collect_form_payload()
            asset = self._history.save_asset(
                payload["external_code"],
                brand=payload["brand"],
                model=payload["model"],
                serial_number=payload["serial_number"],
                client_name=payload["client_name"],
                status=payload["status"],
                notes=payload["notes"],
            )
            if not isinstance(asset, dict):
                raise RuntimeError("La API no devolvio un equipo valido.")
        except Exception as exc:
            self._set_status(f"No se pudo guardar el equipo: {exc}", error=True)
            return

        saved_code = str(asset.get("external_code") or payload["external_code"]).strip()
        self._set_status(f"Equipo guardado correctamente: {saved_code}")
        self.refresh_assets()

        for row in range(self.assets_list.count()):
            item = self.assets_list.item(row)
            asset_row = item.data(Qt.ItemDataRole.UserRole) or {}
            if str(asset_row.get("external_code") or "").strip().lower() == saved_code.lower():
                self.assets_list.setCurrentRow(row)
                break

    def delete_selected_asset(self):
        if not self._can_delete:
            QMessageBox.warning(
                self,
                "Permiso insuficiente",
                "Solo super_admin puede eliminar equipos.",
            )
            return

        if not self._selected_asset_id:
            QMessageBox.warning(self, "Atencion", "Selecciona un equipo primero.")
            return

        external_code = str(self.external_code_input.text() or "").strip()
        typed_code, ok = QInputDialog.getText(
            self,
            "Confirmar eliminacion",
            f"Escribe el codigo externo para confirmar:\n{external_code}",
        )
        if not ok:
            return
        if str(typed_code or "").strip() != external_code:
            QMessageBox.warning(self, "Confirmacion invalida", "El codigo no coincide.")
            return

        reply = QMessageBox.question(
            self,
            "Eliminar equipo",
            (
                f"¿Eliminar definitivamente el equipo?\n\n"
                f"ID: #{self._selected_asset_id}\n"
                f"Codigo: {external_code}\n\n"
                "Esta accion no se puede deshacer."
            ),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        try:
            self._history.delete_asset(self._selected_asset_id)
            self._set_status(f"Equipo eliminado correctamente: {external_code}")
            self.refresh_assets()
        except Exception as exc:
            self._set_status(f"No se pudo eliminar el equipo: {exc}", error=True)

    def link_selected_asset(self):
        if not self._selected_asset_id:
            QMessageBox.warning(self, "Atencion", "Selecciona un equipo primero.")
            return

        installation_text, ok = QInputDialog.getText(
            self,
            "Asociar instalacion",
            "ID de instalacion destino:",
            text=str(self._active_installation_id or ""),
        )
        if not ok:
            return

        try:
            installation_id = int(str(installation_text or "").strip())
            if installation_id <= 0:
                raise ValueError
        except Exception:
            QMessageBox.warning(self, "Dato invalido", "El ID debe ser un entero positivo.")
            return

        notes, ok = QInputDialog.getMultiLineText(
            self,
            "Asociar instalacion",
            "Nota opcional:",
            "",
        )
        if not ok:
            return

        try:
            self._history.link_asset_to_installation(
                self._selected_asset_id,
                installation_id,
                notes=notes,
            )
            self._set_status(f"Equipo asociado a instalacion #{installation_id}.")
            self._reload_selected_asset_details()
        except Exception as exc:
            self._set_status(f"No se pudo asociar el equipo: {exc}", error=True)

    def _reload_selected_asset_details(self):
        if not self._selected_asset_id:
            return
        try:
            payload = self._history.get_asset_incidents(self._selected_asset_id, limit=120)
        except Exception as exc:
            self._set_status(f"No se pudo refrescar detalle: {exc}", error=True)
            return
        asset = payload.get("asset") if isinstance(payload, dict) else None
        if isinstance(asset, dict):
            self._set_form_from_asset(asset)
        self._render_links(payload.get("active_link"), payload.get("links") or [])
        self._render_incidents(payload.get("incidents") or [])

    def create_incident_for_active_link(self):
        if not self._active_installation_id:
            QMessageBox.warning(
                self,
                "Sin instalacion activa",
                "Este equipo no tiene una instalacion activa vinculada.",
            )
            return

        if not self._parent_main or not hasattr(self._parent_main, "create_incident_for_record"):
            QMessageBox.warning(self, "No disponible", "No se encontro el modulo de incidencias.")
            return

        self._parent_main.create_incident_for_record(self._active_installation_id)
        self._reload_selected_asset_details()

    def open_qr_for_selected_asset(self):
        code = str(self.external_code_input.text() or "").strip()
        if not code:
            QMessageBox.warning(self, "Atencion", "No hay codigo de equipo para generar QR.")
            return

        dialog = QrGeneratorDialog(
            parent=self,
            qr_type="asset",
            value=code,
            history_manager=self._history,
            prefill_data={
                "external_code": code,
                "brand": str(self.brand_input.text() or "").strip(),
                "model": str(self.model_input.text() or "").strip(),
                "serial_number": str(self.serial_input.text() or "").strip(),
                "client_name": str(self.client_input.text() or "").strip(),
                "notes": str(self.notes_input.toPlainText() or "").strip(),
            },
            auto_generate=True,
        )
        dialog.exec()
