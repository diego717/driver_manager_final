from PyQt6.QtWidgets import QPushButton


def setup_main_window_connections(window):
    """Configurar señales y slots principales del MainWindow."""
    window.drivers_tab.brand_filter.currentTextChanged.connect(window.filter_drivers)
    window.drivers_tab.drivers_list.itemDoubleClicked.connect(window.event_handlers.on_driver_double_click)
    window.drivers_tab.drivers_list.itemSelectionChanged.connect(window.event_handlers.on_driver_selected)
    window.drivers_tab.download_btn.clicked.connect(window.event_handlers.download_driver)
    window.drivers_tab.install_btn.clicked.connect(window.event_handlers.download_and_install)
    if hasattr(window.drivers_tab, "refresh_btn"):
        window.drivers_tab.refresh_btn.clicked.connect(window.refresh_drivers_list)
    if hasattr(window.drivers_tab, "generate_qr_btn"):
        window.drivers_tab.generate_qr_btn.clicked.connect(window.show_qr_generator_dialog)
    if hasattr(window.drivers_tab, "associate_asset_btn"):
        window.drivers_tab.associate_asset_btn.clicked.connect(window.show_asset_link_dialog)
    if hasattr(window.drivers_tab, "manage_assets_btn"):
        window.drivers_tab.manage_assets_btn.clicked.connect(window.show_asset_management_dialog)

    window.history_tab.history_view_combo.currentTextChanged.connect(window.on_history_view_changed)
    window.history_tab.history_list.currentItemChanged.connect(window._on_history_item_changed)
    window.history_tab.create_manual_button.clicked.connect(window.create_manual_history_record)
    window.history_tab.edit_button.clicked.connect(window.show_edit_installation_dialog)
    if hasattr(window.history_tab, "view_incidents_button"):
        window.history_tab.view_incidents_button.clicked.connect(window.show_incidents_for_selected_record)
    if hasattr(window.history_tab, "incidents_installations_list"):
        window.history_tab.incidents_installations_list.currentItemChanged.connect(
            window._on_incidents_installation_changed
        )
    if hasattr(window.history_tab, "incidents_list"):
        window.history_tab.incidents_list.currentItemChanged.connect(window._on_incident_item_changed)
    if hasattr(window.history_tab, "incident_photos_list"):
        window.history_tab.incident_photos_list.itemDoubleClicked.connect(
            lambda _item: window.view_selected_incident_photo()
        )
        window.history_tab.incident_photos_list.currentItemChanged.connect(
            lambda current, _previous=None: window.history_tab.view_incident_photo_btn.setEnabled(current is not None)
        )
    if hasattr(window.history_tab, "refresh_incidents_view_btn"):
        window.history_tab.refresh_incidents_view_btn.clicked.connect(window.refresh_incidents_view)
    if hasattr(window.history_tab, "apply_incidents_filters_btn"):
        window.history_tab.apply_incidents_filters_btn.clicked.connect(window.apply_incidents_filters)
    if hasattr(window.history_tab, "incidents_severity_filter"):
        window.history_tab.incidents_severity_filter.currentTextChanged.connect(
            lambda _value: window.apply_incidents_filters()
        )
    if hasattr(window.history_tab, "incidents_period_filter"):
        window.history_tab.incidents_period_filter.currentTextChanged.connect(
            lambda _value: window.apply_incidents_filters()
        )
    if hasattr(window.history_tab, "create_incident_btn"):
        window.history_tab.create_incident_btn.clicked.connect(window.create_incident_from_incidents_view)
    if hasattr(window.history_tab, "upload_incident_photo_btn"):
        window.history_tab.upload_incident_photo_btn.clicked.connect(window.upload_photo_for_selected_incident)
    if hasattr(window.history_tab, "view_incident_photo_btn"):
        window.history_tab.view_incident_photo_btn.clicked.connect(window.view_selected_incident_photo)
    if hasattr(window.history_tab, "incident_mark_open_btn"):
        window.history_tab.incident_mark_open_btn.clicked.connect(
            lambda: window.update_selected_incident_status("open")
        )
    if hasattr(window.history_tab, "incident_mark_progress_btn"):
        window.history_tab.incident_mark_progress_btn.clicked.connect(
            lambda: window.update_selected_incident_status("in_progress")
        )
    if hasattr(window.history_tab, "incident_mark_resolved_btn"):
        window.history_tab.incident_mark_resolved_btn.clicked.connect(
            lambda: window.update_selected_incident_status("resolved")
        )

    window.history_tab.management_history_list.currentItemChanged.connect(
        lambda item: window.history_tab.delete_selected_btn.setEnabled(
            item is not None and window.user_manager and window.user_manager.is_super_admin()
        )
    )
    window.history_tab.delete_selected_btn.clicked.connect(window.delete_selected_history_record)

    for widget in window.history_tab.findChildren(QPushButton):
        if "Actualizar" in widget.text() and "Generar" not in widget.text():
            widget.clicked.connect(window.refresh_current_history_view)

    window.admin_tab.login_btn.clicked.connect(window.show_login_dialog)
    window.admin_tab.logout_btn.clicked.connect(window.on_admin_logout)
    window.tabs.currentChanged.connect(window._on_tab_changed)

    window.admin_tab.show_account_btn.clicked.connect(
        lambda: window.event_handlers.toggle_visibility(
            window.admin_tab.admin_account_id_input,
            window.admin_tab.show_account_btn,
        )
    )
    window.admin_tab.show_access_btn.clicked.connect(
        lambda: window.event_handlers.toggle_visibility(
            window.admin_tab.admin_access_key_input,
            window.admin_tab.show_access_btn,
        )
    )
    window.admin_tab.show_secret_btn.clicked.connect(
        lambda: window.event_handlers.toggle_visibility(
            window.admin_tab.admin_secret_key_input,
            window.admin_tab.show_secret_btn,
        )
    )
    if hasattr(window.admin_tab, "show_api_token_btn"):
        window.admin_tab.show_api_token_btn.clicked.connect(
            lambda: window.event_handlers.toggle_visibility(
                window.admin_tab.admin_api_token_input,
                window.admin_tab.show_api_token_btn,
            )
        )
    if hasattr(window.admin_tab, "show_api_secret_btn"):
        window.admin_tab.show_api_secret_btn.clicked.connect(
            lambda: window.event_handlers.toggle_visibility(
                window.admin_tab.admin_api_secret_input,
                window.admin_tab.show_api_secret_btn,
            )
        )

    for widget in window.admin_tab.findChildren(QPushButton):
        if "Guardar Configuración R2" in widget.text():
            widget.clicked.connect(window.event_handlers.save_r2_config)
        elif "Probar Conexión" in widget.text():
            widget.clicked.connect(window.test_r2_connection)
        elif "❌ Eliminar Seleccionado" in widget.text():
            widget.clicked.connect(window.delete_driver)
        elif "Gestionar Usuarios" in widget.text():
            widget.clicked.connect(window.show_user_management)
        elif "Cambiar Contraseña" in widget.text():
            widget.clicked.connect(window.event_handlers.change_admin_password)
        elif "Limpiar Caché" in widget.text():
            widget.clicked.connect(window.event_handlers.clear_cache)

    for widget in window.drivers_tab.findChildren(QPushButton):
        if "📁 Seleccionar Archivo" in widget.text():
            widget.clicked.connect(window.select_driver_file)
        elif "☁️ Subir a la Nube" in widget.text():
            widget.clicked.connect(window.upload_driver)

    if hasattr(window.admin_tab, "theme_combo"):
        window.admin_tab.theme_combo.currentTextChanged.connect(window.change_theme)
        current_theme = "Oscuro" if window.theme_manager.get_current_theme() == "dark" else "Claro"
        window.admin_tab.theme_combo.setCurrentText(current_theme)

    if hasattr(window.history_tab, "daily_report_btn"):
        window.history_tab.daily_report_btn.clicked.connect(
            window.report_handlers.generate_daily_report_simple
        )
    if hasattr(window.history_tab, "monthly_report_btn"):
        window.history_tab.monthly_report_btn.clicked.connect(
            window.report_handlers.generate_monthly_report_simple
        )
    if hasattr(window.history_tab, "yearly_report_btn"):
        window.history_tab.yearly_report_btn.clicked.connect(
            window.report_handlers.generate_yearly_report_simple
        )
    if hasattr(window.history_tab, "report_month_combo"):
        window.history_tab.report_month_combo.currentIndexChanged.connect(
            lambda _idx: window.report_handlers.refresh_reports_preview()
        )
    if hasattr(window.history_tab, "report_year_combo"):
        window.history_tab.report_year_combo.currentIndexChanged.connect(
            lambda _idx: window.report_handlers.refresh_reports_preview()
        )

    window._apply_navigation_access_control()
