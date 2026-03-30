import os
import sys
from pathlib import Path

from PyQt6.QtCore import QUrl
from PyQt6.QtQuickWidgets import QQuickWidget
from PyQt6.QtWidgets import QDialog, QInputDialog, QLineEdit, QMainWindow, QMessageBox

from core.config_manager import ConfigManager
from managers.cloud_manager import CloudflareR2Manager
from managers.user_manager_v2 import UserManagerV2
from ui.dialogs.asset_management_dialog import AssetManagementDialog
from ui.dialogs.qr_generator_dialog import QrGeneratorDialog
from ui.dialogs.user_management_ui import LoginDialog
from ui.main_window_bootstrap import initialize_manager_state
from ui.v2_drivers_bridge import DriversBridge
from ui.v2_incidents_bridge import IncidentsBridge


class MainWindowV2(QMainWindow):
    """Experimental Windows UI v2 shell built on Qt Quick."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("SiteOps Console v2")
        self.setMinimumSize(1320, 860)
        self.resize(1440, 920)
        self._startup_cancelled = False

        self.config_manager = ConfigManager(self)
        initialize_manager_state(self, portable_mode=False, portable_config=None)

        self._build_ui()
        self._init_runtime()

    def _build_ui(self):
        quick = QQuickWidget()
        quick.setResizeMode(QQuickWidget.ResizeMode.SizeRootObjectToView)

        self.drivers_bridge = DriversBridge(self, quick)
        self.incidents_bridge = IncidentsBridge(self, quick)
        quick.rootContext().setContextProperty("driversBridge", self.drivers_bridge)
        quick.rootContext().setContextProperty("incidentsBridge", self.incidents_bridge)

        qml_path = Path(__file__).resolve().parent / "qml" / "App.qml"
        quick.setSource(QUrl.fromLocalFile(str(qml_path)))

        if quick.status() == QQuickWidget.Status.Error:
            messages = "\n".join(error.toString() for error in quick.errors())
            raise RuntimeError(f"No se pudo cargar Windows UI v2:\n{messages}")

        self.setCentralWidget(quick)
        self.quick_widget = quick

    def _init_runtime(self):
        self.init_cloud_connection()
        if not self._ensure_authenticated_session():
            self._startup_cancelled = True
            return
        self.drivers_bridge.refreshDrivers()
        self.incidents_bridge.refreshData()

    def load_config_data(self):
        return self.config_manager.load_config_data()

    def _resolve_desktop_auth_mode(self):
        allowed_modes = {"legacy", "web", "auto"}
        env_mode = str(os.getenv("DRIVER_MANAGER_DESKTOP_AUTH_MODE", "")).strip().lower()
        if env_mode in allowed_modes:
            return env_mode

        try:
            config = self.load_config_data() or {}
        except Exception:
            config = {}

        config_mode = str(config.get("desktop_auth_mode", "")).strip().lower()
        if config_mode in allowed_modes:
            return config_mode
        return "legacy"

    def _show_setup_wizard(self, user_manager, exit_on_cancel=False):
        from ui.dialogs.user_setup_wizard import show_user_setup_wizard

        user_data = show_user_setup_wizard(None)
        if user_data:
            success, _message = user_manager.initialize_system(
                user_data["username"],
                user_data["password"],
            )
            return success

        if exit_on_cancel:
            sys.exit(0)
        return False

    def _ensure_authenticated_session(self):
        if not self.history_manager:
            self.history_manager = self.history
            self._sync_history_web_token_provider()

        desired_local_mode = self.cloud_manager is None
        desired_auth_mode = self._resolve_desktop_auth_mode()

        self.user_manager = UserManagerV2(
            self.cloud_manager,
            self.security_manager,
            local_mode=desired_local_mode,
            audit_api_client=self.history_manager,
            auth_mode=desired_auth_mode,
        )

        try:
            if self.user_manager.needs_initialization():
                initialized = self._show_setup_wizard(self.user_manager, exit_on_cancel=False)
                if not initialized and self.user_manager.needs_initialization():
                    self.statusBar().showMessage("Configuracion inicial pendiente", 6000)
                    return False
        except Exception as error:
            self.statusBar().showMessage(f"No se pudo inicializar usuarios: {error}", 7000)
            return False

        login_dialog = LoginDialog(self.user_manager, self)
        if login_dialog.exec() != QDialog.DialogCode.Accepted:
            self.statusBar().showMessage("Inicio de sesion cancelado", 4000)
            return False

        self.is_authenticated = True
        current_user = self.user_manager.current_user or {}
        current_role = str(current_user.get("role") or "").strip().lower()
        self.is_admin = current_role in {"admin", "super_admin"}
        self.is_super_admin = current_role == "super_admin"
        self.is_read_only = current_role in {"solo_lectura", "viewer"}
        self.tenant_id = str(current_user.get("tenant_id") or "").strip()
        self.statusBar().showMessage(f"Sesion iniciada como {current_user.get('username', '')}", 5000)
        return True

    def _resolve_current_web_token(self):
        if not getattr(self, "user_manager", None):
            return ""
        return str(getattr(self.user_manager, "current_web_token", "") or "")

    def _resolve_current_web_session_context(self):
        current_user = {}
        if getattr(self, "user_manager", None) and self.user_manager.current_user:
            current_user = self.user_manager.current_user
        return {
            "tenant_id": str(current_user.get("tenant_id") or "").strip(),
            "role": str(current_user.get("role") or "").strip(),
            "username": str(current_user.get("username") or "").strip(),
        }

    def _sync_history_web_token_provider(self):
        token_provider = self._resolve_current_web_token
        session_context_provider = self._resolve_current_web_session_context
        if getattr(self, "history", None) and hasattr(self.history, "set_web_token_provider"):
            self.history.set_web_token_provider(token_provider)
        if getattr(self, "history", None) and hasattr(self.history, "set_web_session_context_provider"):
            self.history.set_web_session_context_provider(session_context_provider)
        if getattr(self, "history_manager", None) and hasattr(self.history_manager, "set_web_token_provider"):
            self.history_manager.set_web_token_provider(token_provider)
        if getattr(self, "history_manager", None) and hasattr(self.history_manager, "set_web_session_context_provider"):
            self.history_manager.set_web_session_context_provider(session_context_provider)

    def resolve_driver_backend(self):
        return self.cloud_manager

    def init_cloud_connection(self):
        config = self.load_config_data()
        if not config:
            self.cloud_manager = None
            self.statusBar().showMessage("Configuracion de nube faltante", 5000)
            return False

        try:
            self.cloud_manager = CloudflareR2Manager(
                account_id=config.get("account_id"),
                access_key_id=config.get("access_key_id"),
                secret_access_key=config.get("secret_access_key"),
                bucket_name=config.get("bucket_name"),
            )
            self.statusBar().showMessage("Conectado a Cloudflare R2", 5000)
            return True
        except Exception as error:
            self.cloud_manager = None
            self.statusBar().showMessage(f"Error conectando a la nube: {error}", 6000)
            return False

    def _selected_driver_defaults(self):
        selected_driver = getattr(self.drivers_bridge, "_selected_driver", None) or {}
        brand = str(selected_driver.get("brand") or "").strip()
        version = str(selected_driver.get("version") or "").strip()
        if not (brand or version):
            return ""
        return f"{brand}-{version}".strip("-")

    def show_qr_generator_dialog(self):
        default_value = self._selected_driver_defaults()
        default_asset_code = default_value
        prefill_data = {"asset_code": default_asset_code} if default_asset_code else None
        dialog = QrGeneratorDialog(
            self,
            qr_type="asset",
            value=default_value,
            history_manager=self.history,
            prefill_data=prefill_data,
        )
        dialog.exec()

    def show_asset_link_dialog(self):
        if not self.history:
            QMessageBox.warning(self, "Error", "Modulo de historial no disponible.")
            return

        default_asset_code = self._selected_driver_defaults()
        asset_code, ok = QInputDialog.getText(
            self,
            "Asociar equipo",
            "Codigo externo del equipo (QR/serie):",
            QLineEdit.EchoMode.Normal,
            default_asset_code,
        )
        if not ok:
            return

        asset_code = str(asset_code or "").strip()
        if not asset_code:
            QMessageBox.warning(self, "Dato invalido", "Debes ingresar el codigo del equipo.")
            return

        installation_id_text, ok = QInputDialog.getText(
            self,
            "Asociar equipo",
            "ID de registro destino:",
            QLineEdit.EchoMode.Normal,
            "",
        )
        if not ok:
            return

        try:
            installation_id = int(str(installation_id_text or "").strip())
            if installation_id <= 0:
                raise ValueError
        except Exception:
            QMessageBox.warning(self, "Dato invalido", "El ID de registro debe ser un entero positivo.")
            return

        notes, ok = QInputDialog.getMultiLineText(
            self,
            "Asociar equipo",
            "Nota opcional de asociacion:",
            "",
        )
        if not ok:
            return

        try:
            asset, link = self.history.associate_asset_with_installation(
                external_code=asset_code,
                installation_id=installation_id,
                notes=notes,
            )
            resolved_code = str((asset or {}).get("external_code") or asset_code)
            linked_installation = (link or {}).get("installation_id") or installation_id
            QMessageBox.information(
                self,
                "Asociacion completada",
                f"Equipo: {resolved_code}\nRegistro: #{linked_installation}",
            )
            self.statusBar().showMessage("Equipo asociado a registro", 5000)
        except Exception as error:
            QMessageBox.critical(self, "Error", f"No se pudo asociar el equipo:\n{error}")

    def show_asset_management_dialog(self):
        if not self.history:
            QMessageBox.warning(self, "Error", "Modulo de historial no disponible.")
            return

        can_delete = False
        if self.user_manager and hasattr(self.user_manager, "is_super_admin"):
            try:
                can_delete = bool(self.user_manager.is_super_admin())
            except Exception:
                can_delete = False

        dialog = AssetManagementDialog(
            history_manager=self.history,
            parent=self,
            can_edit=self.is_admin,
            can_delete=can_delete,
        )
        dialog.exec()
