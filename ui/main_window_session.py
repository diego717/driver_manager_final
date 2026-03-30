from PyQt6.QtWidgets import QDialog, QGroupBox, QLineEdit, QMessageBox, QPushButton

from managers.history_manager import InstallationHistory
from managers.user_manager_v2 import UserManagerV2
from ui.dialogs.user_management_ui import LoginDialog

TENANT_ADMIN_ROLES = {"admin", "super_admin"}
OPERATIONS_MANAGER_ROLES = {"admin", "super_admin", "supervisor"}
INCIDENT_OPERATOR_ROLES = {"admin", "super_admin", "supervisor", "tecnico"}
READ_ONLY_ROLES = {"solo_lectura", "viewer"}


def is_user_authenticated(window):
    """Retornar si hay una sesión autenticada activa."""
    if not getattr(window, "is_authenticated", False):
        return False
    if not getattr(window, "user_manager", None):
        return False
    return bool(window.user_manager.current_user)


def current_user_role(window):
    """Obtener rol actual de usuario autenticado."""
    if not getattr(window, "user_manager", None) or not window.user_manager.current_user:
        return ""
    return str(window.user_manager.current_user.get("role") or "").strip().lower()


def current_user_tenant_id(window):
    """Obtener tenant_id activo desde la sesion actual."""
    if not getattr(window, "user_manager", None) or not window.user_manager.current_user:
        return ""
    return str(window.user_manager.current_user.get("tenant_id") or "").strip()


def can_manage_tenant_catalog(window):
    """Indicar si el usuario puede administrar catalogos/config tenant."""
    return current_user_role(window) in TENANT_ADMIN_ROLES


def can_manage_platform(window):
    """Indicar si el usuario puede administrar configuracion de plataforma."""
    return current_user_role(window) == "super_admin"


def can_manage_operational_records(window):
    """Indicar si el usuario puede crear/coordinar trabajo operativo."""
    return current_user_role(window) in OPERATIONS_MANAGER_ROLES


def can_operate_incidents(window):
    """Indicar si el usuario puede crear o actualizar incidencias."""
    return current_user_role(window) in INCIDENT_OPERATOR_ROLES


def is_read_only_user(window):
    """Indicar si el usuario esta en un rol solo lectura."""
    return current_user_role(window) in READ_ONLY_ROLES


def apply_navigation_access_control(window):
    """Aplicar acceso a tabs y acciones según estado de sesión/rol."""
    can_access_protected_tabs = is_user_authenticated(window)

    window.tabs.setTabEnabled(window.drivers_tab_index, can_access_protected_tabs)
    window.tabs.setTabEnabled(window.history_tab_index, can_access_protected_tabs)
    window.tabs.setTabEnabled(window.incidents_tab_index, can_access_protected_tabs)
    window.tabs.setTabEnabled(window.admin_tab_index, True)

    can_edit_history = can_manage_operational_records(window) if can_access_protected_tabs else False

    if hasattr(window.history_tab, "create_manual_button"):
        window.history_tab.create_manual_button.setEnabled(can_edit_history)
    if hasattr(window.history_tab, "create_incident_btn"):
        window.history_tab.create_incident_btn.setEnabled(False)
    if hasattr(window.history_tab, "upload_incident_photo_btn"):
        window.history_tab.upload_incident_photo_btn.setEnabled(False)
    if hasattr(window.history_tab, "incident_mark_open_btn"):
        window.history_tab.incident_mark_open_btn.setEnabled(False)
    if hasattr(window.history_tab, "incident_mark_progress_btn"):
        window.history_tab.incident_mark_progress_btn.setEnabled(False)
    if hasattr(window.history_tab, "incident_mark_resolved_btn"):
        window.history_tab.incident_mark_resolved_btn.setEnabled(False)

    if not can_access_protected_tabs and window.tabs.currentIndex() != window.admin_tab_index:
        window.tabs.setCurrentIndex(window.admin_tab_index)
        window.statusBar().showMessage("Inicia sesión para acceder a Drivers y Registros.", 5000)


def handle_tab_changed(window, tab_index):
    """Evitar navegación a tabs deshabilitados."""
    if tab_index < 0:
        return
    if window.tabs.isTabEnabled(tab_index):
        if tab_index == getattr(window, "incidents_tab_index", -1):
            window.refresh_incidents_view()
        return
    window.tabs.setCurrentIndex(window.admin_tab_index)
    window.statusBar().showMessage("Debes iniciar sesión para acceder a este menú.", 4000)


def prepare_login_session_runtime(
    window,
    *,
    logger,
    message_box=QMessageBox,
    history_cls=InstallationHistory,
    user_manager_cls=UserManagerV2,
):
    """Preparar runtime de login sin mostrar todavía el diálogo."""
    cloud_manager = getattr(window, "cloud_manager", None)
    user_manager = getattr(window, "user_manager", None)
    history_manager = getattr(window, "history_manager", None)

    if not cloud_manager:
        try:
            window.init_cloud_connection()
        except Exception as error:
            logger.warning(f"No se pudo inicializar cloud_manager desde configuración: {error}")

    cloud_manager = getattr(window, "cloud_manager", None)
    desired_local_mode = cloud_manager is None
    desired_auth_mode = window._resolve_desktop_auth_mode()

    if (
        not user_manager
        or bool(getattr(user_manager, "local_mode", False)) != desired_local_mode
        or str(getattr(user_manager, "auth_mode", "legacy")).lower() != desired_auth_mode
    ):
        try:
            if not history_manager:
                window.history_manager = history_cls(window.config_manager)
                window._sync_history_web_token_provider()
                history_manager = window.history_manager
            window.user_manager = user_manager_cls(
                cloud_manager,
                window.security_manager,
                local_mode=desired_local_mode,
                audit_api_client=history_manager,
                auth_mode=desired_auth_mode,
            )
            user_manager = window.user_manager
        except Exception as error:
            logger.error(f"Error inicializando user_manager: {error}", exc_info=True)
            logger.operation_end("show_login_dialog", success=False, reason=str(error))
            message_box.warning(window, "Error", f"Error inicializando sistema de usuarios: {str(error)}")
            return False
    elif (
        not user_manager.local_mode
        and not getattr(user_manager, "audit_api_client", None)
    ):
        if not history_manager:
            window.history_manager = history_cls(window.config_manager)
            window._sync_history_web_token_provider()
            history_manager = window.history_manager
        user_manager.set_audit_api_client(history_manager)

    if cloud_manager is None:
        auth_mode = getattr(user_manager, "auth_mode", "legacy")
        if auth_mode in ("web", "auto"):
            window.statusBar().showMessage(
                "ℹ️ Sin conexión directa a R2: login en modo web habilitado.",
                6000,
            )
        else:
            message_box.information(
                window,
                "Modo Seguro sin Nube",
                "No hay conexión Cloudflare R2 activa.\n\n"
                "Debes autenticarte como super_admin para configurar credenciales R2.",
            )

    try:
        if user_manager.needs_initialization():
            logger.warning("No hay base de usuarios disponible. Iniciando configuración inicial.")
            message_box.information(
                window,
                "Configuración inicial requerida",
                "No se encontró una base de usuarios válida.\n\n"
                "Se abrirá el asistente para crear el primer super administrador.",
            )
            window._show_setup_wizard(user_manager, exit_on_cancel=False)

            if user_manager.needs_initialization():
                logger.warning("Login cancelado: el sistema sigue sin base de usuarios.")
                return False
    except Exception as error:
        logger.error(f"No se pudo evaluar inicialización de usuarios: {error}", exc_info=True)
        message_box.warning(
            window,
            "Error de inicialización",
            f"No se pudo validar la base de usuarios: {error}",
        )
        return False

    return True


def configure_admin_panel_for_role(window, username, user_role, *, logger):
    """Aplicar visibilidad del panel admin según el rol autenticado."""
    if hasattr(window.history_tab, "warning"):
        window.history_tab.warning.setVisible(not window.is_admin)

    if user_role == "super_admin":
        logger.info(f"Configurando panel para super_admin: {username}")
        web_auth_context = window._is_web_auth_context()

        for widget in window.admin_tab.findChildren(QGroupBox):
            if web_auth_context and "Cloudflare R2" in widget.title():
                widget.setVisible(False)
                logger.debug("Sección R2 oculta para contexto web")
            else:
                widget.setVisible(True)
                logger.debug(f"GroupBox visible: {widget.title()}")

        if hasattr(window.admin_tab, "user_mgmt_btn"):
            window.admin_tab.user_mgmt_btn.setVisible(True)
            logger.debug("Botón gestión usuarios visible")

        for widget in window.admin_tab.findChildren(QPushButton):
            if any(text in widget.text() for text in ["Seleccionar Archivo", "Subir a la Nube", "Eliminar Seleccionado"]):
                widget.setVisible(True)
                logger.debug(f"Botón visible para super_admin: {widget.text()}")
            if any(text in widget.text() for text in ["Guardar Configuración R2", "Probar Conexión"]):
                widget.setVisible(not web_auth_context)
                if web_auth_context:
                    logger.debug(f"Botón R2 oculto para contexto web: {widget.text()}")
                else:
                    logger.debug(f"Botón R2 visible para super_admin: {widget.text()}")

        for widget in window.admin_tab.findChildren(QLineEdit):
            placeholder = (widget.placeholderText() or "").lower()
            if not placeholder:
                continue
            is_driver_field = "driver" in placeholder
            is_r2_field = any(text in placeholder for text in ["account", "key", "bucket"])

            if is_driver_field:
                widget.setVisible(True)
                logger.debug(f"Campo visible: {widget.placeholderText()}")
            elif is_r2_field:
                widget.setVisible(not web_auth_context)
                if web_auth_context:
                    logger.debug(f"Campo R2 oculto para contexto web: {widget.placeholderText()}")
                else:
                    logger.debug(f"Campo visible: {widget.placeholderText()}")

        if not web_auth_context:
            logger.info("Cargando credenciales R2 para super_admin")
            window.event_handlers.load_r2_config_to_admin_panel()
            logger.security_event(
                event_type="r2_credentials_accessed",
                username=username,
                success=True,
                details={"action": "view_credentials"},
                severity="WARNING",
            )
        else:
            window.statusBar().showMessage(
                "ℹ️ Sesión web activa: configuración R2 no requerida para iniciar sesión.",
                5000,
            )
        return

    if user_role == "admin":
        logger.info(f"Configurando panel para admin: {username}")

        if hasattr(window.admin_tab, "user_mgmt_btn"):
            window.admin_tab.user_mgmt_btn.setVisible(True)
            logger.debug("Boton gestion usuarios/tecnicos visible para admin")

        for widget in window.admin_tab.findChildren(QGroupBox):
            if "Cloudflare R2" in widget.title():
                widget.setVisible(False)
                logger.debug("Sección R2 OCULTA para admin")
            else:
                widget.setVisible(True)

        for widget in window.admin_tab.findChildren(QPushButton):
            if "Eliminar Seleccionado" in widget.text():
                widget.setVisible(True)
            if any(text in widget.text() for text in ["Guardar Configuración R2", "Probar Conexión"]):
                widget.setVisible(False)

        for widget in window.admin_tab.findChildren(QLineEdit):
            placeholder = (widget.placeholderText() or "").lower()
            if "driver" in placeholder:
                widget.setVisible(True)
            if any(text in placeholder for text in ["account", "key", "bucket"]):
                widget.setVisible(False)

        logger.info("Admin NO tiene acceso a credenciales R2")
        return

    logger.info(f"Configurando panel en modo lectura: {username} ({user_role})")
    if hasattr(window.admin_tab, "user_mgmt_btn"):
        window.admin_tab.user_mgmt_btn.setVisible(False)
    for widget in window.admin_tab.findChildren(QGroupBox):
        widget.setVisible(False)

    for widget in window.admin_tab.findChildren(QPushButton):
        if any(text in widget.text() for text in ["Eliminar Seleccionado", "Guardar Configuración", "Probar Conexión"]):
            widget.setVisible(False)

    for widget in window.admin_tab.findChildren(QLineEdit):
        placeholder = (widget.placeholderText() or "").lower()
        if any(text in placeholder for text in ["driver", "account", "key", "bucket"]):
            widget.setVisible(False)

    logger.info("Rol sin privilegios administrativos: solo lectura y configuracion minima")


def apply_authenticated_login_state(window, *, logger):
    """Aplicar cambios de UI/estado después de autenticación exitosa."""
    user = window.user_manager.current_user
    user_role = user.get("role")
    username = user.get("username")

    logger.security_event(
        event_type="admin_panel_access",
        username=username,
        success=True,
        details={"role": user_role},
        severity="INFO",
    )

    window.is_authenticated = True
    window.is_admin = user_role in TENANT_ADMIN_ROLES
    window.is_super_admin = user_role == "super_admin"
    window.is_read_only = user_role in READ_ONLY_ROLES
    window.tenant_id = current_user_tenant_id(window)
    window.can_manage_tenant_catalog = can_manage_tenant_catalog(window)
    window.can_manage_platform = can_manage_platform(window)
    window.can_manage_operational_records = can_manage_operational_records(window)
    window.can_operate_incidents = can_operate_incidents(window)
    window._apply_navigation_access_control()
    window.tabs.setCurrentIndex(window.drivers_tab_index)
    window.drivers_tab.toggle_upload_section(window.is_admin)

    window.admin_tab.auth_status.setText(f"🔓 {username} ({user_role})")
    window.admin_tab.login_btn.setVisible(False)
    window.admin_tab.logout_btn.setVisible(True)
    window.admin_tab.admin_content.setVisible(True)

    configure_admin_panel_for_role(window, username, user_role, logger=logger)

    window._sync_history_web_token_provider()
    window.refresh_drivers_list()

    if hasattr(window, "all_drivers") and user_role in ["admin", "super_admin"]:
        window.event_handlers.update_admin_drivers_list(window.all_drivers)
        logger.debug(f"Lista de drivers cargada para {user_role}")

    window.refresh_audit_logs()
    logger.operation_end("show_login_dialog", success=True, role=user_role)


def run_login_dialog(
    window,
    *,
    logger,
    login_dialog_cls=LoginDialog,
    message_box=QMessageBox,
):
    """Ejecutar flujo completo de login para MainWindow."""
    logger.operation_start("show_login_dialog")

    if not prepare_login_session_runtime(window, logger=logger, message_box=message_box):
        return

    dialog = login_dialog_cls(window.user_manager, window)
    if dialog.exec() == QDialog.DialogCode.Accepted:
        apply_authenticated_login_state(window, logger=logger)
        return

    logger.info("Login cancelado por usuario")
    logger.operation_end("show_login_dialog", success=False, reason="cancelled")


def run_admin_logout(window):
    """Manejar cierre de sesión y actualizar UI asociada."""
    window.event_handlers.admin_logout()
    window._sync_history_web_token_provider()
    window.drivers_tab.toggle_upload_section(False)
    window._apply_navigation_access_control()
    window.refresh_drivers_list()
