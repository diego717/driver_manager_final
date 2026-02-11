"""
Sistema Unificado de Logging para Driver Manager
Proporciona logging centralizado con rotación de archivos y niveles configurables
"""

import logging
import sys
from pathlib import Path
from datetime import datetime
from logging.handlers import RotatingFileHandler
from typing import Optional, Dict, Any


class DriverManagerLogger:
    """
    Sistema centralizado de logging para Driver Manager
    
    Características:
    - Logging a archivo con rotación automática
    - Logging a consola con colores (opcional)
    - Niveles configurables por componente
    - Logs específicos para eventos de seguridad
    - Formateo consistente
    """
    
    def __init__(
        self, 
        name: str = 'driver_manager',
        log_dir: Optional[Path] = None,
        file_level: int = logging.DEBUG,
        console_level: int = logging.INFO,
        max_bytes: int = 5*1024*1024,  # 5MB
        backup_count: int = 3
    ):
        """
        Inicializar logger
        
        Args:
            name: Nombre del logger
            log_dir: Directorio para archivos de log
            file_level: Nivel de logging para archivo
            console_level: Nivel de logging para consola
            max_bytes: Tamaño máximo del archivo antes de rotar
            backup_count: Número de archivos de backup a mantener
        """
        if log_dir is None:
            log_dir = Path.home() / ".driver_manager" / "logs"
        
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        
        # Configurar logger principal
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.DEBUG)  # Capturar todo, filtrar en handlers
        
        # Limpiar handlers existentes
        if self.logger.handlers:
            self.logger.handlers.clear()
        
        # Handler para archivo (rotativo)
        log_file = self.log_dir / f"{name}_{datetime.now().strftime('%Y%m%d')}.log"
        file_handler = RotatingFileHandler(
            log_file,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding='utf-8'
        )
        file_handler.setLevel(file_level)
        
        # Handler para consola
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(console_level)
        
        # Formato detallado para archivo
        file_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        file_handler.setFormatter(file_formatter)
        
        # Formato simple para consola
        console_formatter = logging.Formatter(
            '%(levelname)s - %(message)s'
        )
        console_handler.setFormatter(console_formatter)
        
        # Agregar handlers
        self.logger.addHandler(file_handler)
        self.logger.addHandler(console_handler)
        
        # Logger separado para eventos de seguridad
        self.security_logger = self._setup_security_logger(name)
    
    def _setup_security_logger(self, base_name: str) -> logging.Logger:
        """Configurar logger específico para eventos de seguridad"""
        security_logger = logging.getLogger(f"{base_name}.security")
        security_logger.setLevel(logging.INFO)
        
        # Handler para archivo de seguridad
        security_file = self.log_dir / f"security_{datetime.now().strftime('%Y%m%d')}.log"
        security_handler = RotatingFileHandler(
            security_file,
            maxBytes=5*1024*1024,
            backupCount=5,
            encoding='utf-8'
        )
        
        # Formato específico para eventos de seguridad
        security_formatter = logging.Formatter(
            '%(asctime)s - SECURITY - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        security_handler.setFormatter(security_formatter)
        
        security_logger.addHandler(security_handler)
        
        return security_logger
    
    def debug(self, msg: str, **kwargs):
        """Log mensaje de debug"""
        self.logger.debug(msg, extra=kwargs)
    
    def info(self, msg: str, **kwargs):
        """Log mensaje informativo"""
        self.logger.info(msg, extra=kwargs)
    
    def warning(self, msg: str, **kwargs):
        """Log advertencia"""
        self.logger.warning(msg, extra=kwargs)
    
    def error(self, msg: str, exc_info: bool = True, **kwargs):
        """
        Log error con stack trace opcional
        
        Args:
            msg: Mensaje de error
            exc_info: Si incluir información de excepción
            **kwargs: Información adicional
        """
        self.logger.error(msg, exc_info=exc_info, extra=kwargs)
    
    def critical(self, msg: str, exc_info: bool = True, **kwargs):
        """Log error crítico"""
        self.logger.critical(msg, exc_info=exc_info, extra=kwargs)
    
    def security_event(
        self, 
        event_type: str, 
        username: str, 
        success: bool, 
        details: Optional[Dict[str, Any]] = None,
        severity: str = 'INFO'
    ):
        """
        Log evento de seguridad específico
        
        Args:
            event_type: Tipo de evento (login, logout, password_change, etc.)
            username: Usuario involucrado
            success: Si la operación fue exitosa
            details: Información adicional del evento
            severity: Nivel de severidad (INFO, WARNING, ERROR)
        """
        status = "SUCCESS" if success else "FAILED"
        details_str = ""
        
        if details:
            details_str = " | " + " | ".join(f"{k}={v}" for k, v in details.items())
        
        message = f"{event_type.upper()} | User: {username} | Status: {status}{details_str}"
        
        # Log según severidad
        if severity == 'ERROR':
            self.security_logger.error(message)
        elif severity == 'WARNING':
            self.security_logger.warning(message)
        else:
            self.security_logger.info(message)
    
    def operation_start(self, operation: str, **kwargs):
        """Log inicio de operación"""
        self.debug(f"Starting operation: {operation}", operation=operation, **kwargs)
    
    def operation_end(self, operation: str, success: bool = True, **kwargs):
        """Log fin de operación"""
        status = "SUCCESS" if success else "FAILED"
        self.debug(
            f"Completed operation: {operation} - {status}", 
            operation=operation, 
            success=success, 
            **kwargs
        )
    
    def performance_metric(self, operation: str, duration_ms: float, **kwargs):
        """Log métrica de rendimiento"""
        self.info(
            f"Performance: {operation} took {duration_ms:.2f}ms",
            operation=operation,
            duration_ms=duration_ms,
            **kwargs
        )
    
    def get_log_files(self) -> list:
        """Obtener lista de archivos de log"""
        return list(self.log_dir.glob("*.log"))
    
    def clear_old_logs(self, days: int = 30):
        """
        Eliminar logs más antiguos que X días
        
        Args:
            days: Días de antigüedad
        """
        from datetime import timedelta
        
        cutoff_date = datetime.now() - timedelta(days=days)
        
        deleted = 0
        for log_file in self.get_log_files():
            if log_file.stat().st_mtime < cutoff_date.timestamp():
                log_file.unlink()
                deleted += 1
        
        self.info(f"Cleared {deleted} old log file(s)", deleted_count=deleted)


# Singleton global para fácil acceso
_logger_instance: Optional[DriverManagerLogger] = None


def get_logger(name: str = 'driver_manager') -> DriverManagerLogger:
    """
    Obtener instancia singleton del logger
    
    Args:
        name: Nombre del logger (solo usado en primera inicialización)
        
    Returns:
        Instancia de DriverManagerLogger
    """
    global _logger_instance
    
    if _logger_instance is None:
        _logger_instance = DriverManagerLogger(name)
    
    return _logger_instance


def configure_logger(
    log_dir: Optional[Path] = None,
    file_level: int = logging.DEBUG,
    console_level: int = logging.INFO
) -> DriverManagerLogger:
    """
    Configurar logger global con parámetros personalizados
    
    Args:
        log_dir: Directorio de logs
        file_level: Nivel para archivos
        console_level: Nivel para consola
        
    Returns:
        Logger configurado
    """
    global _logger_instance
    
    _logger_instance = DriverManagerLogger(
        log_dir=log_dir,
        file_level=file_level,
        console_level=console_level
    )
    
    return _logger_instance


# Ejemplo de uso
if __name__ == "__main__":
    # Obtener logger
    logger = get_logger()
    
    # Diferentes niveles
    logger.debug("Mensaje de debug con detalles técnicos")
    logger.info("Operación iniciada correctamente")
    logger.warning("Advertencia: configuración subóptima")
    
    # Error con stack trace
    try:
        raise ValueError("Error de ejemplo")
    except ValueError as e:
        logger.error(f"Error capturado: {e}")
    
    # Evento de seguridad
    logger.security_event(
        event_type="login",
        username="admin",
        success=True,
        details={'ip': '192.168.1.1', 'method': 'password'}
    )
    
    # Métricas
    logger.performance_metric(
        operation="download_driver",
        duration_ms=1234.56,
        driver_name="Magicard v1.2.3"
    )
    
    print(f"\nLog files created in: {logger.log_dir}")
    for log_file in logger.get_log_files():
        print(f"  - {log_file.name}")
