"""
Sistema Unificado de Excepciones y Manejo de Errores para Driver Manager
Proporciona excepciones específicas y decoradores para manejo consistente
"""

from functools import wraps
from typing import Any, Callable, Optional, Tuple, TypeVar, Dict
from core.logger import get_logger


# ============================================================================
# EXCEPCIONES BASE
# ============================================================================

class DriverManagerException(Exception):
    """
    Excepción base para Driver Manager
    
    Todas las excepciones personalizadas deben heredar de esta clase.
    Proporciona estructura consistente para mensajes y detalles.
    """
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None, original_error: Optional[Exception] = None):
        """
        Args:
            message: Mensaje descriptivo del error
            details: Diccionario con información adicional
            original_error: Excepción original si existe
        """
        self.message = message
        self.details = details or {}
        self.original_error = original_error
        
        # Mensaje completo
        full_message = message
        if details:
            details_str = ", ".join(f"{k}={v}" for k, v in details.items())
            full_message += f" [{details_str}]"
        
        super().__init__(full_message)
    
    def to_dict(self) -> dict:
        """Convertir excepción a diccionario para serialización"""
        return {
            'type': self.__class__.__name__,
            'message': self.message,
            'details': self.details,
            'original_error': str(self.original_error) if self.original_error else None
        }


# ============================================================================
# EXCEPCIONES ESPECÍFICAS
# ============================================================================

class ConfigurationError(DriverManagerException):
    """Error relacionado con configuración"""
    pass


class AuthenticationError(DriverManagerException):
    """Error de autenticación o autorización"""
    pass


class CloudStorageError(DriverManagerException):
    """Error relacionado con almacenamiento en la nube"""
    pass


class SecurityError(DriverManagerException):
    """Error de seguridad (cifrado, HMAC, etc.)"""
    pass


class InstallationError(DriverManagerException):
    """Error durante instalación de driver"""
    pass


class DownloadError(DriverManagerException):
    """Error durante descarga de driver"""
    pass


class ValidationError(DriverManagerException):
    """Error de validación de datos"""
    pass


class MigrationError(DriverManagerException):
    """Error durante migración de datos"""
    pass


class PermissionError(DriverManagerException):
    """Error de permisos de archivo o sistema"""
    pass


# ============================================================================
# DECORADORES PARA MANEJO DE ERRORES
# ============================================================================

T = TypeVar('T')


def handle_errors(
    operation_name: Optional[str] = None,
    log_errors: bool = True,
    reraise: bool = True,
    default_return: Any = None
) -> Callable:
    """
    Decorador para manejo consistente de errores
    
    Args:
        operation_name: Nombre de la operación (usa nombre de función si None)
        log_errors: Si loggear errores automáticamente
        reraise: Si re-lanzar excepciones después de loggear
        default_return: Valor a retornar en caso de error (si reraise=False)
    
    Ejemplo:
        @handle_errors("load_config")
        def load_config_data(self):
            # ... código que puede fallar
            return config
        
        @handle_errors(reraise=False, default_return={})
        def get_optional_data(self):
            # ... código que puede fallar
            return data
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            logger = get_logger()
            op_name = operation_name or func.__name__
            
            try:
                # Log inicio (solo en debug)
                logger.debug(f"Starting {op_name}")
                
                # Ejecutar función
                result = func(*args, **kwargs)
                
                # Log éxito (solo en debug)
                logger.debug(f"Completed {op_name} successfully")
                
                return result
                
            except DriverManagerException as e:
                # Excepción conocida del negocio
                if log_errors:
                    logger.error(
                        f"Business error in {op_name}: {e.message}",
                        exc_info=False,  # No necesitamos stack trace para errores conocidos
                        operation=op_name,
                        details=e.details
                    )
                
                if reraise:
                    raise
                else:
                    return default_return
                    
            except Exception as e:
                # Excepción inesperada
                if log_errors:
                    logger.error(
                        f"Unexpected error in {op_name}: {str(e)}",
                        exc_info=True,  # Stack trace completo para errores inesperados
                        operation=op_name
                    )
                
                if reraise:
                    # Envolver en DriverManagerException
                    raise DriverManagerException(
                        f"Unexpected error in {op_name}",
                        details={'function': func.__name__},
                        original_error=e
                    ) from e
                else:
                    return default_return
        
        return wrapper
    return decorator


def returns_result_tuple(operation_name: Optional[str] = None) -> Callable:
    """
    Decorador para funciones que retornan tupla (success: bool, message: str)
    
    Convierte excepciones en tuplas (False, error_message)
    
    Args:
        operation_name: Nombre de la operación
    
    Ejemplo:
        @returns_result_tuple("save_config")
        def save_config(self, config):
            # ... código que puede fallar con excepciones
            return True, "Config saved"
        
        # Si falla, retorna: (False, "Error message")
    """
    def decorator(func: Callable[..., Tuple[bool, str]]) -> Callable[..., Tuple[bool, str]]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Tuple[bool, str]:
            logger = get_logger()
            op_name = operation_name or func.__name__
            
            try:
                result = func(*args, **kwargs)
                
                # Verificar que retorna tupla válida
                if not isinstance(result, tuple) or len(result) != 2:
                    logger.warning(
                        f"{op_name} didn't return proper (bool, str) tuple",
                        operation=op_name
                    )
                    return False, f"Invalid return format from {op_name}"
                
                return result
                
            except DriverManagerException as e:
                logger.error(
                    f"Error in {op_name}: {e.message}",
                    exc_info=False,
                    operation=op_name,
                    details=e.details
                )
                return False, e.message
                
            except Exception as e:
                logger.error(
                    f"Unexpected error in {op_name}: {str(e)}",
                    exc_info=True,
                    operation=op_name
                )
                return False, f"Error en {op_name}: {str(e)}"
        
        return wrapper
    return decorator


def validate_params(**validators) -> Callable:
    """
    Decorador para validación de parámetros
    
    Args:
        **validators: Dict con nombre_param: función_validadora
    
    Ejemplo:
        def is_valid_username(username):
            if len(username) < 3:
                raise ValidationError("Username too short")
            return True
        
        @validate_params(username=is_valid_username)
        def create_user(self, username, password):
            # ... username ya está validado
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            import inspect
            
            # Obtener nombres de parámetros
            sig = inspect.signature(func)
            bound = sig.bind(*args, **kwargs)
            bound.apply_defaults()
            
            # Validar cada parámetro
            for param_name, validator in validators.items():
                if param_name in bound.arguments:
                    value = bound.arguments[param_name]
                    try:
                        validator(value)
                    except ValidationError:
                        raise  # Re-lanzar ValidationError tal cual
                    except Exception as e:
                        raise ValidationError(
                            f"Validation failed for {param_name}",
                            details={'param': param_name, 'value': str(value)},
                            original_error=e
                        )
            
            return func(*args, **kwargs)
        
        return wrapper
    return decorator


def retry_on_failure(
    max_attempts: int = 3,
    delay_seconds: float = 1.0,
    exceptions: Tuple[type, ...] = (Exception,)
) -> Callable:
    """
    Decorador para reintentar operación en caso de fallo
    
    Args:
        max_attempts: Número máximo de intentos
        delay_seconds: Segundos de espera entre intentos
        exceptions: Tupla de excepciones a reintentar
    
    Ejemplo:
        @retry_on_failure(max_attempts=3, delay_seconds=2.0)
        def download_file(self, url):
            # ... código que puede fallar temporalmente
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            import time
            
            logger = get_logger()
            last_exception = None
            
            for attempt in range(1, max_attempts + 1):
                try:
                    if attempt > 1:
                        logger.debug(
                            f"Retry attempt {attempt}/{max_attempts} for {func.__name__}"
                        )
                    
                    return func(*args, **kwargs)
                    
                except exceptions as e:
                    last_exception = e
                    
                    if attempt < max_attempts:
                        logger.warning(
                            f"Attempt {attempt} failed for {func.__name__}: {str(e)}. "
                            f"Retrying in {delay_seconds}s..."
                        )
                        time.sleep(delay_seconds)
                    else:
                        logger.error(
                            f"All {max_attempts} attempts failed for {func.__name__}",
                            exc_info=True
                        )
            
            # Si llegamos aquí, todos los intentos fallaron
            raise last_exception
        
        return wrapper
    return decorator


# ============================================================================
# CONTEXT MANAGERS PARA MANEJO DE RECURSOS
# ============================================================================

class ErrorContext:
    """
    Context manager para manejo de errores con contexto adicional
    
    Ejemplo:
        with ErrorContext("loading configuration", reraise=True):
            config = load_config()
            # Si falla, se loggea "Error loading configuration: ..."
    """
    
    def __init__(self, operation: str, reraise: bool = True):
        self.operation = operation
        self.reraise = reraise
        self.logger = get_logger()
    
    def __enter__(self):
        self.logger.debug(f"Starting: {self.operation}")
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self.logger.debug(f"Completed: {self.operation}")
            return True
        
        # Hubo error
        self.logger.error(
            f"Error during {self.operation}: {exc_val}",
            exc_info=(exc_type, exc_val, exc_tb)
        )
        
        return not self.reraise  # True = suprimir excepción, False = re-lanzar


# ============================================================================
# VALIDADORES COMUNES
# ============================================================================

def validate_not_empty(value: Any, field_name: str = "value"):
    """Validar que un valor no esté vacío"""
    if not value:
        raise ValidationError(
            f"{field_name} cannot be empty",
            details={'field': field_name}
        )


def validate_min_length(value: str, min_length: int, field_name: str = "value"):
    """Validar longitud mínima de string"""
    if len(value) < min_length:
        raise ValidationError(
            f"{field_name} must be at least {min_length} characters",
            details={'field': field_name, 'min_length': min_length, 'actual': len(value)}
        )


def validate_file_exists(path, field_name: str = "file"):
    """Validar que un archivo existe"""
    from pathlib import Path
    
    file_path = Path(path)
    if not file_path.exists():
        raise ValidationError(
            f"{field_name} does not exist",
            details={'field': field_name, 'path': str(path)}
        )


# ============================================================================
# EJEMPLO DE USO
# ============================================================================

if __name__ == "__main__":
    # Ejemplo 1: Decorador básico
    @handle_errors("test_operation")
    def risky_operation():
        raise ValueError("Something went wrong")
    
    try:
        risky_operation()
    except DriverManagerException as e:
        print(f"Caught: {e}")
    
    # Ejemplo 2: Returns result tuple
    @returns_result_tuple("save_data")
    def save_data(data):
        if not data:
            raise ValidationError("Data is empty")
        return True, "Data saved"
    
    success, msg = save_data({})
    print(f"Result: {success}, {msg}")
    
    # Ejemplo 3: Validación de parámetros
    @validate_params(
        username=lambda u: validate_min_length(u, 3, "username")
    )
    def create_user(username, password):
        return f"User {username} created"
    
    try:
        create_user("ab", "pass123")
    except ValidationError as e:
        print(f"Validation failed: {e}")
    
    # Ejemplo 4: Context manager
    try:
        with ErrorContext("database operation"):
            # Simular operación
            raise ConnectionError("DB unreachable")
    except Exception as e:
        print(f"Context caught: {e}")
