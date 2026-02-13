import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

try:
    from handlers.report_handlers import ReportHandlers

    PYQT_AVAILABLE = True
except Exception:
    ReportHandlers = None
    PYQT_AVAILABLE = False


@unittest.skipUnless(PYQT_AVAILABLE, "PyQt6 is required for ReportHandlers tests")
class TestReportHandlers(unittest.TestCase):
    def _build_main(self):
        main = MagicMock()
        main.statusBar.return_value = MagicMock()
        main.report_gen = MagicMock()
        main.history = MagicMock()
        main.history_tab = MagicMock()
        return main

    @patch("handlers.report_handlers.QMessageBox")
    def test_generate_daily_report_opens_file_when_user_accepts(self, mock_msgbox):
        main = self._build_main()
        main.report_gen.generate_daily_report.return_value = "C:/tmp/daily.xlsx"
        handler = ReportHandlers(main)

        mock_msgbox.StandardButton.Yes = 1
        mock_msgbox.StandardButton.No = 2
        mock_msgbox.Icon.Information = 1
        mock_msgbox.return_value.exec.return_value = 1

        with patch.object(handler, "_open_file") as mock_open:
            handler.generate_daily_report_simple()

        main.report_gen.generate_daily_report.assert_called_once()
        mock_open.assert_called_once_with("C:/tmp/daily.xlsx")

    @patch("handlers.report_handlers.QMessageBox")
    def test_generate_daily_report_handles_error(self, mock_msgbox):
        main = self._build_main()
        main.report_gen.generate_daily_report.side_effect = Exception("boom")
        handler = ReportHandlers(main)

        handler.generate_daily_report_simple()

        self.assertTrue(main.statusBar.return_value.showMessage.called)
        mock_msgbox.critical.assert_called_once()

    @patch("handlers.report_handlers.QMessageBox")
    def test_generate_monthly_report_uses_selected_month_and_year(self, mock_msgbox):
        main = self._build_main()
        main.history_tab.report_month_combo.currentIndex.return_value = 1  # February
        main.history_tab.report_month_combo.currentText.return_value = "Febrero"
        main.history_tab.report_year_combo.currentText.return_value = "2026"
        main.report_gen.generate_monthly_report.return_value = "C:/tmp/monthly.xlsx"
        handler = ReportHandlers(main)

        mock_msgbox.StandardButton.Yes = 1
        mock_msgbox.StandardButton.No = 2
        mock_msgbox.Icon.Information = 1
        mock_msgbox.return_value.exec.return_value = 2

        with patch.object(handler, "_open_file") as mock_open:
            handler.generate_monthly_report_simple()

        main.report_gen.generate_monthly_report.assert_called_once_with(2026, 2)
        mock_open.assert_not_called()

    @patch("handlers.report_handlers.QMessageBox.information")
    @patch("handlers.report_handlers.QFileDialog.getSaveFileName")
    def test_export_history_json_exports_when_path_is_selected(self, mock_get_save, mock_info):
        main = self._build_main()
        handler = ReportHandlers(main)

        mock_get_save.return_value = ("C:/tmp/history.json", "JSON Files (*.json)")
        handler.export_history_json()

        main.history.export_to_json.assert_called_once_with("C:/tmp/history.json")
        mock_info.assert_called_once()

    @patch("handlers.report_handlers.QMessageBox.information")
    @patch("handlers.report_handlers.QFileDialog.getSaveFileName")
    def test_export_audit_log_shows_empty_message(self, mock_get_save, mock_info):
        main = self._build_main()
        main.history.get_audit_log.return_value = []
        handler = ReportHandlers(main)

        handler.export_audit_log()

        mock_info.assert_called_once()
        mock_get_save.assert_not_called()

    @patch("handlers.report_handlers.QMessageBox.information")
    @patch("handlers.report_handlers.QFileDialog.getSaveFileName")
    def test_export_audit_log_writes_file(self, mock_get_save, mock_info):
        main = self._build_main()
        main.history.get_audit_log.return_value = [
            {
                "timestamp": "2026-02-13T10:00:00",
                "user": "admin",
                "action": "delete_driver",
                "details": "Removed Zebra 1.2.3",
                "items_deleted": 1,
                "computer_name": "PC-01",
            }
        ]
        handler = ReportHandlers(main)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as tmp:
            output_path = tmp.name

        try:
            mock_get_save.return_value = (output_path, "Text Files (*.txt)")
            handler.export_audit_log()

            self.assertTrue(Path(output_path).exists())
            content = Path(output_path).read_text(encoding="utf-8")
            self.assertIn("LOG DE AUDITOR", content)
            self.assertIn("delete_driver", content)
            self.assertIn("admin", content)
            mock_info.assert_called_once()
        finally:
            try:
                Path(output_path).unlink(missing_ok=True)
            except PermissionError:
                pass

    @patch("handlers.report_handlers.platform.system", return_value="Windows")
    @patch("handlers.report_handlers.os.startfile", create=True)
    def test_open_file_uses_startfile_on_windows(self, mock_startfile, _mock_system):
        main = self._build_main()
        handler = ReportHandlers(main)

        handler._open_file("C:/tmp/report.xlsx")

        mock_startfile.assert_called_once_with("C:/tmp/report.xlsx")

    @patch("handlers.report_handlers.QMessageBox.warning")
    @patch("handlers.report_handlers.subprocess.run", side_effect=Exception("cannot open"))
    @patch("handlers.report_handlers.platform.system", return_value="Linux")
    def test_open_file_shows_warning_on_error(self, _mock_system, _mock_run, mock_warning):
        main = self._build_main()
        handler = ReportHandlers(main)

        handler._open_file("/tmp/report.xlsx")

        mock_warning.assert_called_once()


if __name__ == "__main__":
    unittest.main()
