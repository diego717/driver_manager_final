# main.py
import sys
from PyQt6.QtWidgets import QApplication
from core.logger import get_logger
from ui.main_window import MainWindow
from ui.main_window_v2 import MainWindowV2

# Configurar logger global
logger = get_logger()

def main():
    logger.operation_start("application_start")
    try:
        app = QApplication(sys.argv)
        app.setStyle('Fusion')

        use_v2 = "--ui-v2" in sys.argv
        if use_v2:
            window = MainWindowV2()
        else:
            window = MainWindow()
        if getattr(window, "_startup_cancelled", False):
            logger.info("Inicio cancelado antes de mostrar la ventana principal.")
            sys.exit(0)
        window.show()
        
        logger.operation_end("application_start", success=True)
        sys.exit(app.exec())
    except Exception as e:
        logger.critical(f"Error fatal en la aplicación: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
