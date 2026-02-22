import unittest
from unittest.mock import MagicMock, patch

from handlers.report_handlers import ReportHandlers


class DummyPreview:
    def __init__(self):
        self.text = ""

    def setPlainText(self, value):
        self.text = value


class DummyCombo:
    def __init__(self, index=0, text="Enero"):
        self._index = index
        self._text = text

    def currentIndex(self):
        return self._index

    def currentText(self):
        return self._text


class DummyHistoryTab:
    def __init__(self):
        self.report_preview = DummyPreview()
        self.report_month_combo = DummyCombo(index=1, text="Febrero")
        self.report_year_combo = DummyCombo(index=0, text="2026")


class DummyHistory:
    def get_installations(self, **kwargs):
        return [
            {"status": "success"},
            {"status": "failed"},
        ]

    def get_statistics(self, **kwargs):
        return {
            "total_installations": 2,
            "successful_installations": 1,
            "failed_installations": 1,
        }


class DummyStatusBar:
    def __init__(self):
        self.messages = []

    def showMessage(self, message):
        self.messages.append(message)


class DummyMessageBox:
    class Icon:
        Information = 1

    class StandardButton:
        Yes = 1
        No = 2

    critical_calls = []
    information_calls = []

    def __init__(self, _parent=None):
        self._exec_result = DummyMessageBox.StandardButton.No

    def setIcon(self, _icon):
        pass

    def setWindowTitle(self, _title):
        pass

    def setText(self, _text):
        pass

    def setInformativeText(self, _text):
        pass

    def setStandardButtons(self, _buttons):
        pass

    def exec(self):
        return self._exec_result

    @classmethod
    def critical(cls, _parent, title, text):
        cls.critical_calls.append((title, text))

    @classmethod
    def information(cls, _parent, title, text):
        cls.information_calls.append((title, text))

    @classmethod
    def reset(cls):
        cls.critical_calls = []
        cls.information_calls = []


class DummyMain:
    def __init__(self, history=None, report_gen=None):
        self.history_tab = DummyHistoryTab()
        self.history = history or DummyHistory()
        self.report_gen = report_gen or MagicMock()
        self._status_bar = DummyStatusBar()

    def statusBar(self):
        return self._status_bar


class TestReportHandlers(unittest.TestCase):
    def test_refresh_reports_preview_populates_summary(self):
        main = DummyMain()
        handlers = ReportHandlers(main)

        handlers.refresh_reports_preview(
            last_report_path="C:/tmp/reporte.xlsx",
            report_kind="Reporte diario",
        )

        text = main.history_tab.report_preview.text
        self.assertIn("Resumen rapido para reportes", text)
        self.assertIn("Hoy", text)
        self.assertIn("Febrero 2026", text)
        self.assertIn("Ano 2026", text)
        self.assertIn("C:/tmp/reporte.xlsx", text)

    def test_generate_daily_report_simple_handles_history_connection_error(self):
        history = MagicMock()
        history.get_installations.side_effect = ConnectionError("offline")
        report_gen = MagicMock()
        main = DummyMain(history=history, report_gen=report_gen)
        handlers = ReportHandlers(main)
        DummyMessageBox.reset()

        with patch("handlers.report_handlers._qt_widgets", return_value=(MagicMock(), DummyMessageBox)):
            result = handlers.generate_daily_report_simple()

        self.assertFalse(result)
        report_gen.generate_daily_report.assert_not_called()
        self.assertTrue(DummyMessageBox.critical_calls)
        self.assertEqual(main._status_bar.messages[-1], "Error generando reporte")

    def test_generate_daily_report_simple_does_not_generate_when_history_is_none(self):
        history = MagicMock()
        history.get_installations.return_value = None
        history.get_statistics.return_value = {"total_installations": 0}
        report_gen = MagicMock()
        main = DummyMain(history=history, report_gen=report_gen)
        handlers = ReportHandlers(main)
        DummyMessageBox.reset()

        with patch("handlers.report_handlers._qt_widgets", return_value=(MagicMock(), DummyMessageBox)):
            result = handlers.generate_daily_report_simple()

        self.assertFalse(result)
        report_gen.generate_daily_report.assert_not_called()
        self.assertTrue(DummyMessageBox.information_calls)
        self.assertEqual(main._status_bar.messages[-1], "Sin datos para reporte diario")


if __name__ == "__main__":
    unittest.main()
