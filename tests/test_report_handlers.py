import unittest

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


class DummyMain:
    def __init__(self):
        self.history_tab = DummyHistoryTab()
        self.history = DummyHistory()


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


if __name__ == "__main__":
    unittest.main()

