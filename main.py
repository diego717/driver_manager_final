# main.py
import sys
from PyQt6.QtWidgets import QApplication
from core.logger import get_logger
from ui.main_window import MainWindow

# Configurar logger global
logger = get_logger()

def main():
    logger.operation_start("application_start")
    try:
        app = QApplication(sys.argv)
        app.setStyle('Fusion')
        
        # Iniciar Ventana Principal
        window = MainWindow()
        window.show()
        
        logger.operation_end("application_start", success=True)
        sys.exit(app.exec())
    except Exception as e:
        logger.critical(f"Error fatal en la aplicación: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()