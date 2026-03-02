import io
from urllib.parse import quote

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import (
    QApplication,
    QComboBox,
    QDialog,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


QR_MAX_ASSET_CODE_LENGTH = 128
QR_MAX_BRAND_LENGTH = 120
QR_MAX_MODEL_LENGTH = 160
QR_MAX_SERIAL_LENGTH = 128
QR_MAX_CLIENT_NAME_LENGTH = 180
QR_MAX_NOTES_LENGTH = 2000


class QrGeneratorDialog(QDialog):
    """Dialogo para generar QR localmente y opcionalmente registrar equipo en API."""

    def __init__(self, parent=None, qr_type="asset", value="", history_manager=None):
        super().__init__(parent)
        self.setWindowTitle("Alta de equipo y QR")
        self.setMinimumSize(640, 680)

        self._history_manager = history_manager
        self._current_payload = ""
        self._current_png_bytes = b""
        self._current_details_text = ""
        self._current_type = "asset"

        self.type_combo = QComboBox()
        self.type_combo.addItem("Equipo", "asset")
        self.type_combo.addItem("Instalacion", "installation")

        self.value_input = QLineEdit()
        self.value_input.setPlaceholderText("Ej: 245")

        self.asset_code_input = QLineEdit()
        self.asset_code_input.setPlaceholderText("Ej: EQ-SL3-001 (opcional)")
        self.brand_input = QLineEdit()
        self.brand_input.setPlaceholderText("Ej: Entrust")
        self.model_input = QLineEdit()
        self.model_input.setPlaceholderText("Ej: Sigma SL3")
        self.serial_input = QLineEdit()
        self.serial_input.setPlaceholderText("Ej: SN-00112233")
        self.client_input = QLineEdit()
        self.client_input.setPlaceholderText("Ej: Cliente ACME")
        self.notes_input = QTextEdit()
        self.notes_input.setPlaceholderText("Notas opcionales del equipo")
        self.notes_input.setFixedHeight(90)

        self.helper_label = QLabel("")
        self.helper_label.setWordWrap(True)
        self.helper_label.setStyleSheet("color: #5f6b7a;")

        self.error_label = QLabel("")
        self.error_label.setWordWrap(True)
        self.error_label.setStyleSheet("color: #dc2626;")

        self.preview_label = QLabel("Vista previa QR")
        self.preview_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.preview_label.setMinimumHeight(300)
        self.preview_label.setStyleSheet("border: 1px solid #dce1e8; border-radius: 8px;")

        self.details_label = QLabel("")
        self.details_label.setWordWrap(True)
        self.details_label.setStyleSheet(
            "background: #f8fafc; border: 1px solid #dce1e8; border-radius: 8px; padding: 8px;"
        )

        self.payload_value = QLineEdit()
        self.payload_value.setReadOnly(True)

        self.generate_button = QPushButton("Generar QR")
        self.save_asset_button = QPushButton("Guardar equipo")
        self.copy_payload_button = QPushButton("Copiar payload")
        self.save_button = QPushButton("Guardar PNG")
        self.close_button = QPushButton("Cerrar")

        self.copy_payload_button.setEnabled(False)
        self.save_button.setEnabled(False)

        self._build_layout()
        self._setup_connections()
        self._set_initial_state(qr_type, value)

    def _build_layout(self):
        main_layout = QVBoxLayout(self)
        form_layout = QFormLayout()
        form_layout.addRow("Tipo:", self.type_combo)
        form_layout.addRow("ID instalacion:", self.value_input)
        main_layout.addLayout(form_layout)

        self.asset_fields_container = QWidget(self)
        self.asset_fields_layout = QFormLayout(self.asset_fields_container)
        self.asset_fields_layout.setContentsMargins(0, 0, 0, 0)
        self.asset_fields_layout.addRow("Codigo externo:", self.asset_code_input)
        self.asset_fields_layout.addRow("Marca:", self.brand_input)
        self.asset_fields_layout.addRow("Modelo:", self.model_input)
        self.asset_fields_layout.addRow("Numero de serie:", self.serial_input)
        self.asset_fields_layout.addRow("Cliente:", self.client_input)
        self.asset_fields_layout.addRow("Notas:", self.notes_input)
        main_layout.addWidget(self.asset_fields_container)

        main_layout.addWidget(self.helper_label)
        main_layout.addWidget(self.error_label)
        main_layout.addWidget(self.preview_label)
        main_layout.addWidget(QLabel("Payload:"))
        main_layout.addWidget(self.payload_value)
        main_layout.addWidget(self.details_label)

        buttons_layout = QHBoxLayout()
        buttons_layout.addWidget(self.generate_button)
        buttons_layout.addWidget(self.save_asset_button)
        buttons_layout.addWidget(self.copy_payload_button)
        buttons_layout.addWidget(self.save_button)
        buttons_layout.addStretch()
        buttons_layout.addWidget(self.close_button)
        main_layout.addLayout(buttons_layout)

    def _setup_connections(self):
        self.type_combo.currentIndexChanged.connect(self._apply_type_meta)
        self.generate_button.clicked.connect(self.generate_qr)
        self.save_asset_button.clicked.connect(self.save_asset)
        self.copy_payload_button.clicked.connect(self.copy_payload)
        self.save_button.clicked.connect(self.save_png)
        self.close_button.clicked.connect(self.reject)
        self.value_input.returnPressed.connect(self.generate_qr)
        self.asset_code_input.returnPressed.connect(self.generate_qr)
        self.serial_input.returnPressed.connect(self.generate_qr)

    def _set_initial_state(self, qr_type, value):
        normalized_type = "installation" if qr_type == "installation" else "asset"
        index = self.type_combo.findData(normalized_type)
        if index >= 0:
            self.type_combo.setCurrentIndex(index)

        text_value = str(value or "")
        self.value_input.setText(text_value)
        self.asset_code_input.setText(text_value if normalized_type == "asset" else "")
        self._apply_type_meta()

    def _apply_type_meta(self):
        selected_type = self._selected_type()
        self._current_type = selected_type
        is_asset = selected_type == "asset"
        self.asset_fields_container.setVisible(is_asset)
        self.save_asset_button.setVisible(is_asset)

        if selected_type == "installation":
            self.value_input.setPlaceholderText("Ej: 245")
            self.helper_label.setText(
                "Modo instalacion: genera dm://installation/{id}. "
                "El ID debe ser entero positivo."
            )
        else:
            self.helper_label.setText(
                "Modo equipo: requiere marca o modelo, y numero de serie. "
                "Puedes generar QR offline y guardar el equipo en API cuando haya sesion."
            )
        self._set_error("")
        self._reset_preview()

    def _selected_type(self):
        value = self.type_combo.currentData()
        return "installation" if value == "installation" else "asset"

    def _normalize_form_text(self, raw_value, max_length):
        return " ".join(str(raw_value or "").strip().split())[:max_length]

    def _normalize_asset_code(self, raw_value):
        return self._normalize_form_text(raw_value, QR_MAX_ASSET_CODE_LENGTH)

    def _collect_asset_form_data(self):
        brand = self._normalize_form_text(self.brand_input.text(), QR_MAX_BRAND_LENGTH)
        model = self._normalize_form_text(self.model_input.text(), QR_MAX_MODEL_LENGTH)
        serial_number = self._normalize_form_text(self.serial_input.text(), QR_MAX_SERIAL_LENGTH)
        client_name = self._normalize_form_text(self.client_input.text(), QR_MAX_CLIENT_NAME_LENGTH)
        notes = self._normalize_form_text(self.notes_input.toPlainText(), QR_MAX_NOTES_LENGTH)

        if not brand and not model:
            raise ValueError("Debes ingresar al menos marca o modelo.")
        if not serial_number:
            raise ValueError("El numero de serie es obligatorio.")

        explicit_code = self._normalize_asset_code(self.asset_code_input.text())
        external_code = explicit_code or self._normalize_asset_code(serial_number)
        if not external_code:
            raise ValueError("No se pudo construir un codigo externo de equipo.")

        return {
            "external_code": external_code,
            "brand": brand,
            "model": model,
            "serial_number": serial_number,
            "client_name": client_name,
            "notes": notes,
        }

    def _build_payload(self):
        qr_type = self._selected_type()
        if qr_type == "installation":
            parsed = int(str(self.value_input.text()).strip())
            if parsed <= 0:
                raise ValueError("El ID de instalacion debe ser un entero positivo.")
            return qr_type, f"dm://installation/{quote(str(parsed))}", {"installation_id": str(parsed)}

        asset_data = self._collect_asset_form_data()
        self.asset_code_input.setText(asset_data["external_code"])
        return (
            qr_type,
            f"dm://asset/{quote(asset_data['external_code'])}",
            asset_data,
        )

    def _format_details(self, qr_type, metadata):
        if qr_type == "installation":
            installation_id = str(metadata.get("installation_id", "")).strip()
            return f"Tipo: Instalacion\nID: {installation_id or '-'}"

        return "\n".join(
            [
                "Tipo: Equipo",
                f"Codigo externo: {metadata.get('external_code') or '-'}",
                f"Marca: {metadata.get('brand') or '-'}",
                f"Modelo: {metadata.get('model') or '-'}",
                f"Serie: {metadata.get('serial_number') or '-'}",
                f"Cliente: {metadata.get('client_name') or '-'}",
            ]
        )

    def _render_qr_png(self, payload):
        # Import lazy to keep desktop module importable even if qrcode isn't installed yet.
        try:
            import qrcode
        except Exception:
            try:
                from vendor import qrcode as qrcode  # type: ignore[no-redef]
            except Exception as exc:
                raise RuntimeError(
                    "Falta dependencia 'qrcode'. Reinstala la app o instala requirements actualizados."
                ) from exc

        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(payload)
        qr.make(fit=True)
        image = qr.make_image(fill_color="black", back_color="white").convert("RGB")
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()

    def _set_error(self, message):
        self.error_label.setText(message or "")

    def _reset_preview(self):
        self._current_payload = ""
        self._current_png_bytes = b""
        self._current_details_text = ""
        self.payload_value.clear()
        self.preview_label.setText("Vista previa QR")
        self.preview_label.setPixmap(QPixmap())
        self.details_label.setText("")
        self.copy_payload_button.setEnabled(False)
        self.save_button.setEnabled(False)

    def generate_qr(self):
        try:
            qr_type, payload, metadata = self._build_payload()
            png_bytes = self._render_qr_png(payload)
            pixmap = QPixmap()
            if not pixmap.loadFromData(png_bytes, "PNG"):
                raise RuntimeError("No se pudo renderizar la imagen QR.")

            details = self._format_details(qr_type, metadata)
            self._current_payload = payload
            self._current_png_bytes = png_bytes
            self._current_details_text = details
            self.payload_value.setText(payload)
            self.details_label.setText(details)
            self.preview_label.setPixmap(
                pixmap.scaled(
                    320,
                    320,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
            )
            self.copy_payload_button.setEnabled(True)
            self.save_button.setEnabled(True)
            self._set_error("")
        except ValueError as exc:
            self._reset_preview()
            self._set_error(str(exc))
        except Exception as exc:
            self._reset_preview()
            self._set_error(str(exc))

    def save_asset(self):
        if self._selected_type() != "asset":
            QMessageBox.warning(self, "No aplica", "Guardar equipo solo aplica en modo Equipo.")
            return
        if not self._history_manager:
            QMessageBox.warning(self, "No disponible", "No hay gestor de API para guardar el equipo.")
            return

        try:
            asset_data = self._collect_asset_form_data()
            asset = self._history_manager.resolve_asset(
                asset_data["external_code"],
                brand=asset_data["brand"],
                model=asset_data["model"],
                serial_number=asset_data["serial_number"],
                client_name=asset_data["client_name"],
                notes=asset_data["notes"],
                status="active",
                update_existing=True,
            )
            if not isinstance(asset, dict):
                raise RuntimeError("La API no devolvio el registro del equipo.")

            self.asset_code_input.setText(self._normalize_asset_code(asset.get("external_code", "")))
            self.brand_input.setText(self._normalize_form_text(asset.get("brand", ""), QR_MAX_BRAND_LENGTH))
            self.model_input.setText(self._normalize_form_text(asset.get("model", ""), QR_MAX_MODEL_LENGTH))
            self.serial_input.setText(
                self._normalize_form_text(asset.get("serial_number", ""), QR_MAX_SERIAL_LENGTH)
            )
            self.client_input.setText(
                self._normalize_form_text(asset.get("client_name", ""), QR_MAX_CLIENT_NAME_LENGTH)
            )
            self.notes_input.setPlainText(self._normalize_form_text(asset.get("notes", ""), QR_MAX_NOTES_LENGTH))

            self._set_error("")
            self.generate_qr()
            QMessageBox.information(
                self,
                "Equipo guardado",
                f"Equipo registrado correctamente.\nCodigo: {asset.get('external_code', '-')}",
            )
        except Exception as exc:
            QMessageBox.critical(self, "Error", f"No se pudo guardar el equipo.\n{exc}")

    def copy_payload(self):
        if not self._current_payload:
            return
        clipboard = QApplication.clipboard()
        clipboard.setText(self._current_payload)
        QMessageBox.information(self, "Copiado", "Payload QR copiado al portapapeles.")

    def _build_printable_png_bytes(self):
        if not self._current_png_bytes:
            return b""
        if self._selected_type() != "asset" or not self._current_details_text:
            return self._current_png_bytes

        try:
            from PIL import Image, ImageDraw, ImageFont
        except Exception:
            return self._current_png_bytes

        qr_image = Image.open(io.BytesIO(self._current_png_bytes)).convert("RGB")
        lines = self._current_details_text.split("\n")
        title = "Etiqueta QR - Driver Manager"
        font = ImageFont.load_default()

        line_height = 18
        side_padding = 24
        top_padding = 20
        details_height = line_height * (len(lines) + 2)
        canvas_width = max(qr_image.width + side_padding * 2, 560)
        canvas_height = top_padding + qr_image.height + 14 + details_height + 20

        canvas = Image.new("RGB", (canvas_width, canvas_height), "white")
        draw = ImageDraw.Draw(canvas)
        qr_x = (canvas_width - qr_image.width) // 2
        canvas.paste(qr_image, (qr_x, top_padding))
        draw.text((side_padding, top_padding + qr_image.height + 10), title, fill="black", font=font)

        y = top_padding + qr_image.height + 10 + line_height
        for line in lines:
            draw.text((side_padding, y), line, fill="black", font=font)
            y += line_height

        output = io.BytesIO()
        canvas.save(output, format="PNG")
        return output.getvalue()

    def save_png(self):
        if not self._current_png_bytes:
            return
        qr_type = self._selected_type()
        base_value = (
            self.asset_code_input.text().strip()
            if qr_type == "asset"
            else self.value_input.text().strip()
        ) or "codigo"
        safe_value = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in base_value)[:64]
        default_name = f"qr-{qr_type}-{safe_value or 'codigo'}.png"
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            "Guardar QR",
            default_name,
            "PNG (*.png)",
        )
        if not file_path:
            return
        try:
            output_bytes = self._build_printable_png_bytes()
            with open(file_path, "wb") as handle:
                handle.write(output_bytes)
            QMessageBox.information(self, "Guardado", f"Etiqueta QR guardada en:\n{file_path}")
        except Exception as exc:
            QMessageBox.critical(self, "Error", f"No se pudo guardar el archivo.\n{exc}")
