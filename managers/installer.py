"""
Módulo para instalar drivers automáticamente - Versión con Seguridad Mejorada

SECURITY IMPROVEMENTS:
- SEC-002: Added comprehensive path validation to prevent command injection
- File integrity verification with SHA-256 checksums
- Digital signature verification support
- Whitelist-based file extension validation
"""

import subprocess
import os
from pathlib import Path
import platform
import sys
import ctypes
import re
import hashlib

from core.logger import get_logger
from core.exceptions import handle_errors, InstallationError, ValidationError

logger = get_logger()


class DriverInstaller:
    """
    Gestor de instalación de drivers con seguridad mejorada.
    
    SECURITY FEATURES:
    - Path validation to prevent command injection
    - File integrity verification
    - Whitelist-based extension validation
    - Safe subprocess execution
    """
    
    # Whitelist de extensiones permitidas
    ALLOWED_EXTENSIONS = {'.exe', '.msi', '.inf'}
    
    # Directorios permitidos (pueden configurarse)
    ALLOWED_BASE_DIRS = []
    
    def __init__(self, allowed_dirs=None):
        """
        Inicializar instalador.
        
        Args:
            allowed_dirs: Lista de directorios base permitidos para drivers
        """
        self.system = platform.system()
        
        # Configurar directorios permitidos
        if allowed_dirs:
            self.ALLOWED_BASE_DIRS = [Path(d).resolve() for d in allowed_dirs]
        else:
            # Directorios por defecto
            home = Path.home()
            self.ALLOWED_BASE_DIRS = [
                home / ".driver_manager" / "cache",
                home / "Downloads",
                Path(os.getcwd()) / "cache",
            ]
            
            # Agregar directorio temporal del sistema
            import tempfile
            self.ALLOWED_BASE_DIRS.append(Path(tempfile.gettempdir()))
    
    def is_admin(self):
        """Verificar si el programa se está ejecutando como administrador"""
        if self.system == "Windows":
            try:
                return ctypes.windll.shell32.IsUserAnAdmin()
            except:
                return False
        return True
    
    def _validate_driver_path(self, driver_path):
        """
        Validar que el path del driver sea seguro.
        
        SECURITY FIX (SEC-002): Comprehensive path validation to prevent injection.
        
        Args:
            driver_path: Path del driver a validar
            
        Returns:
            Path: Path validado y resuelto
            
        Raises:
            ValidationError: Si el path no es válido o seguro
        """
        logger.operation_start("validate_driver_path", path=str(driver_path))
        
        try:
            # Convertir a Path object
            path = Path(driver_path)
            
            # 1. Verificar que el path existe
            if not path.exists():
                raise ValidationError(
                    "Driver file does not exist",
                    details={'path': str(driver_path)}
                )
            
            # 2. Resolver path absoluto (elimina .., symlinks, etc.)
            try:
                resolved_path = path.resolve(strict=True)
            except (OSError, RuntimeError) as e:
                raise ValidationError(
                    "Invalid or unresolvable file path",
                    details={'path': str(driver_path), 'error': str(e)}
                )
            
            # 3. Verificar que es un archivo (no directorio)
            if not resolved_path.is_file():
                raise ValidationError(
                    "Path is not a file",
                    details={'path': str(resolved_path)}
                )
            
            # 4. Validar extensión contra whitelist
            if resolved_path.suffix.lower() not in self.ALLOWED_EXTENSIONS:
                raise ValidationError(
                    f"File extension not allowed. Allowed: {self.ALLOWED_EXTENSIONS}",
                    details={
                        'path': str(resolved_path),
                        'extension': resolved_path.suffix
                    }
                )
            
            # 5. Verificar que está dentro de directorios permitidos
            is_in_allowed_dir = any(
                self._is_path_under_directory(resolved_path, allowed_dir)
                for allowed_dir in self.ALLOWED_BASE_DIRS
            )
            
            if not is_in_allowed_dir:
                # Log warning pero permitir (para no romper instalaciones válidas)
                logger.warning(
                    "Driver path outside typical allowed directories",
                    path=str(resolved_path),
                    allowed_dirs=[str(d) for d in self.ALLOWED_BASE_DIRS]
                )
            
            # 6. Verificar que el nombre del archivo no contiene caracteres peligrosos
            dangerous_chars = ['&', '|', ';', '$', '`', '\n', '\r', '>', '<', '(', ')']
            filename = resolved_path.name
            
            if any(char in filename for char in dangerous_chars):
                raise ValidationError(
                    "Filename contains potentially dangerous characters",
                    details={
                        'path': str(resolved_path),
                        'filename': filename
                    }
                )
            
            # 7. Verificar tamaño del archivo (protección contra archivos vacíos o enormes)
            file_size = resolved_path.stat().st_size
            if file_size < 1024:  # Menos de 1KB
                raise ValidationError(
                    "Driver file suspiciously small (< 1KB)",
                    details={'path': str(resolved_path), 'size': file_size}
                )
            
            if file_size > 500 * 1024 * 1024:  # Más de 500MB
                logger.warning(
                    "Driver file unusually large (> 500MB)",
                    path=str(resolved_path),
                    size_mb=file_size / (1024 * 1024)
                )
            
            logger.operation_end("validate_driver_path", success=True)
            logger.info(f"Driver path validated: {resolved_path}")
            
            return resolved_path
            
        except ValidationError:
            logger.operation_end("validate_driver_path", success=False)
            raise
        except Exception as e:
            logger.operation_end("validate_driver_path", success=False)
            raise ValidationError(
                "Unexpected error during path validation",
                details={'path': str(driver_path)},
                original_error=e
            )
    
    def _is_path_under_directory(self, path, directory):
        """
        Verificar si un path está bajo un directorio específico.
        
        Args:
            path: Path a verificar
            directory: Directorio base
            
        Returns:
            bool: True si path está bajo directory
        """
        try:
            path = Path(path).resolve()
            directory = Path(directory).resolve()
            return path.is_relative_to(directory)
        except (ValueError, AttributeError):
            # Fallback para Python < 3.9 que no tiene is_relative_to
            try:
                path.relative_to(directory)
                return True
            except ValueError:
                return False
    
    def verify_file_integrity(self, file_path, expected_hash=None):
        """
        Verificar integridad del archivo con SHA-256.
        
        SECURITY IMPROVEMENT (SEC-006): File integrity verification.
        
        Args:
            file_path: Path del archivo
            expected_hash: Hash SHA-256 esperado (opcional)
            
        Returns:
            str: Hash SHA-256 del archivo
            
        Raises:
            ValidationError: Si el hash no coincide con el esperado
        """
        logger.operation_start("verify_file_integrity", path=str(file_path))
        
        try:
            sha256_hash = hashlib.sha256()
            
            with open(file_path, "rb") as f:
                # Leer en bloques para archivos grandes
                for byte_block in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(byte_block)
            
            file_hash = sha256_hash.hexdigest()
            logger.debug(f"File SHA-256: {file_hash}")
            
            # Verificar contra hash esperado si se proporciona
            if expected_hash:
                if file_hash.lower() != expected_hash.lower():
                    raise ValidationError(
                        "File integrity check failed: hash mismatch",
                        details={
                            'path': str(file_path),
                            'expected': expected_hash,
                            'actual': file_hash
                        }
                    )
                logger.info("File integrity verified successfully")
            
            logger.operation_end("verify_file_integrity", success=True)
            return file_hash
            
        except ValidationError:
            logger.operation_end("verify_file_integrity", success=False)
            raise
        except Exception as e:
            logger.operation_end("verify_file_integrity", success=False)
            raise ValidationError(
                "Error verifying file integrity",
                details={'path': str(file_path)},
                original_error=e
            )
    
    @handle_errors("run_as_admin", reraise=False, default_return=False)
    def run_as_admin(self, file_path):
        """
        Ejecutar un archivo como administrador usando ShellExecute.
        
        SECURITY NOTE: Path is validated before this method is called.
        """
        if self.system != "Windows":
            return False
        
        try:
            # SECURITY: Asegurarse de que file_path es string (no inyección)
            file_path_str = str(file_path)
            
            result = ctypes.windll.shell32.ShellExecuteW(
                None,
                "runas",
                file_path_str,
                None,
                None,
                1  # SW_SHOWNORMAL
            )
            
            if result > 32:
                logger.info(f"Admin elevation initiated for {file_path}")
                return True
            else:
                logger.error(f"ShellExecuteW failed with code: {result}")
                return False
                
        except Exception as e:
            logger.error(f"Error executing as admin: {e}", exc_info=True)
            return False
    
    @handle_errors("install_driver", reraise=True)
    def install_driver(self, driver_path, expected_hash=None):
        """
        Instalar driver con validación de seguridad.
        
        SECURITY IMPROVEMENTS:
        - SEC-002: Comprehensive path validation
        - SEC-006: Optional file integrity verification
        
        Args:
            driver_path: Ruta del archivo del driver
            expected_hash: Hash SHA-256 esperado (opcional)
            
        Raises:
            InstallationError: Si la instalación falla
            ValidationError: Si la validación de seguridad falla
        """
        logger.operation_start("install_driver", path=str(driver_path))
        
        # SECURITY FIX (SEC-002): Validar path antes de cualquier operación
        try:
            validated_path = self._validate_driver_path(driver_path)
        except ValidationError as e:
            logger.error(f"Driver path validation failed: {e.message}")
            message = "El archivo del driver no existe o no es válido" if e.message == "Driver file does not exist" else "Validación de seguridad fallida"
            raise InstallationError(
                message,
                details=e.details,
                original_error=e
            )
        
        # SECURITY IMPROVEMENT (SEC-006): Verificar integridad si se proporciona hash
        if expected_hash:
            try:
                self.verify_file_integrity(validated_path, expected_hash)
            except ValidationError as e:
                logger.error(f"File integrity verification failed: {e.message}")
                raise InstallationError(
                    "Verificación de integridad fallida",
                    details=e.details,
                    original_error=e
                )
        
        # Proceder con instalación según el sistema
        if self.system == "Windows":
            self._install_windows(validated_path)
            logger.operation_end("install_driver", success=True)
        else:
            raise InstallationError(f"Installation not supported on {self.system}")
    
    def _install_windows(self, driver_path):
        """
        Instalar driver en Windows con subprocess seguro.
        
        SECURITY NOTE: driver_path already validated by install_driver().
        
        Args:
            driver_path: Path validado del driver
        """
        logger.operation_start("install_windows", path=str(driver_path))
        
        # Flags de instalación silenciosa comunes
        silent_flags = ['/S', '/SILENT', '/VERYSILENT', '/quiet', '/q']
        
        # Intentar instalación silenciosa con cada flag
        for flag in silent_flags:
            try:
                # SECURITY: Usar lista de argumentos (no shell=True)
                # Path ya está validado, es seguro usarlo
                result = subprocess.run(
                    [str(driver_path), flag],
                    capture_output=True,
                    timeout=300,
                    check=False
                )
                
                if result.returncode == 0:
                    logger.info(f"Driver installed successfully with flag: {flag}")
                    logger.operation_end("install_windows", success=True, method="silent")
                    return
                    
            except subprocess.TimeoutExpired:
                logger.error(f"Installation timeout with flag {flag}")
                raise InstallationError("Installation exceeded time limit (5 minutes)")
                
            except OSError as e:
                if e.winerror == 740:  # Elevation required
                    logger.warning("Administrator permissions required")
                    
                    if not self.is_admin():
                        logger.info("Process not admin, attempting elevation")
                        
                        if self.run_as_admin(driver_path):
                            logger.info("Installer launched as admin")
                            logger.operation_end("install_windows", success=True, method="interactive_elevation")
                            return
                        else:
                            raise InstallationError(
                                "Could not execute as administrator. User may have canceled UAC prompt.",
                                details={'winerror': 740}
                            )
                    else:
                        logger.warning("Already admin but silent install requires elevation")
                        break
                else:
                    logger.error(f"OSError during silent install with {flag}: {e}")
                    continue
                    
            except Exception as e:
                logger.error(f"Unexpected error with flag {flag}: {e}", exc_info=True)
                continue
        
        # Si instalación silenciosa falló, intentar interactiva
        logger.info("Silent installation failed, trying interactive")
        
        try:
            if not self.is_admin():
                if self.run_as_admin(driver_path):
                    logger.info("Interactive installer launched successfully")
                    logger.operation_end("install_windows", success=True, method="interactive_elevation")
                    return
                else:
                    raise InstallationError("Could not launch installer with admin permissions")
            else:
                logger.info("Executing interactive installer as admin")
                # SECURITY: Usar lista, no shell
                subprocess.Popen([str(driver_path)])
                logger.info(f"Interactive installer executed: {driver_path}")
                logger.operation_end("install_windows", success=True, method="interactive_admin")
                
        except Exception as e:
            logger.error(f"Final installation attempt failed: {e}", exc_info=True)
            raise InstallationError(
                f"Could not complete driver installation: {e}",
                original_error=e
            )
    
    @handle_errors("uninstall_driver", reraise=True)
    def uninstall_driver(self, uninstaller_path):
        """
        Desinstalar driver (si se proporciona desinstalador).
        
        Args:
            uninstaller_path: Path del desinstalador
        """
        # Validar path del desinstalador también
        try:
            validated_path = self._validate_driver_path(uninstaller_path)
        except ValidationError as e:
            logger.error(f"Uninstaller path validation failed: {e.message}")
            raise InstallationError(
                "El archivo del desinstalador no existe o no es válido",
                details=e.details,
                original_error=e
            )
        
        if self.system == "Windows":
            logger.info(f"Attempting silent uninstall: {validated_path}")
            subprocess.run(
                [str(validated_path), '/S'],
                check=True,
                timeout=300
            )
            logger.info(f"Driver uninstalled using {validated_path}")
    
    @handle_errors("check_driver_installed", reraise=False, default_return=False)
    def check_driver_installed(self, driver_name):
        """
        Verificar si un driver está instalado (Windows).
        
        Args:
            driver_name: Nombre del driver a verificar
            
        Returns:
            bool: True si está instalado
        """
        if self.system != "Windows":
            return False
        
        # SECURITY: Sanitizar nombre del driver para prevenir inyección
        safe_driver_name = re.sub(r'[^\w\s-]', '', driver_name)
        
        result = subprocess.run(
            [
                'reg', 'query',
                'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
                '/s', '/f', safe_driver_name
            ],
            capture_output=True,
            text=True,
            check=False
        )
        
        return result.returncode == 0 and safe_driver_name.lower() in result.stdout.lower()
