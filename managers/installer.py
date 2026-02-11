"""
Módulo para instalar drivers automáticamente
"""

import subprocess
import os
from pathlib import Path
import platform
import sys
import ctypes

from core.logger import get_logger
from core.exceptions import handle_errors, InstallationError

logger = get_logger()


class DriverInstaller:
    """Gestor de instalación de drivers"""
    
    def __init__(self):
        """Inicializar instalador"""
        self.system = platform.system()
    
    def is_admin(self):
        """Verificar si el programa se está ejecutando como administrador"""
        if self.system == "Windows":
            try:
                return ctypes.windll.shell32.IsUserAnAdmin()
            except:
                return False
        return True
    
    @handle_errors("run_as_admin", reraise=False, default_return=False)
    def run_as_admin(self, file_path):
        """Ejecutar un archivo como administrador usando ShellExecute"""
        if self.system != "Windows":
            return False
        
        try:
            # Usar ShellExecute con "runas" para solicitar elevación
            result = ctypes.windll.shell32.ShellExecuteW(
                None,
                "runas",  # Verbo para ejecutar como administrador
                file_path,
                None,
                None,
                1  # SW_SHOWNORMAL
            )
            # Un valor > 32 indica éxito.
            if result > 32:
                logger.info(f"Ejecución como administrador iniciada para {file_path}.")
                return True
            else:
                logger.error(f"Fallo al solicitar elevación. Código de retorno de ShellExecuteW: {result}")
                return False
        except Exception as e:
            logger.error(f"Error al ejecutar como admin: {e}", exc_info=True)
            return False
    
    @handle_errors("install_driver", reraise=True)
    def install_driver(self, driver_path):
        """
        Instalar driver
        
        Args:
            driver_path: Ruta del archivo del driver
        """
        logger.operation_start("install_driver", path=driver_path)
        if not os.path.exists(driver_path):
            raise InstallationError(f"Archivo de instalación no encontrado: {driver_path}", details={'path': driver_path})
        
        if self.system == "Windows":
            self._install_windows(driver_path)
            logger.operation_end("install_driver", success=True)
        else:
            raise InstallationError(f"Instalación no soportada en {self.system}")
    
    def _install_windows(self, driver_path):
        """
        Instalar driver en Windows
        
        Args:
            driver_path: Ruta del ejecutable del driver
        """
        logger.operation_start("install_windows", path=driver_path)
        # Primero intentar instalación silenciosa normal
        silent_flags = ['/S', '/SILENT', '/VERYSILENT', '/quiet', '/q']
        
        for flag in silent_flags:
            try:
                # Intentar con cada flag
                result = subprocess.run(
                    [driver_path, flag],
                    capture_output=True,
                    timeout=300,
                    check=False
                )
                
                if result.returncode == 0:
                    logger.info(f"Driver instalado exitosamente con flag: {flag}")
                    logger.operation_end("install_windows", success=True, method="silent")
                    return
                    
            except subprocess.TimeoutExpired:
                logger.error("La instalación silenciosa excedió el tiempo límite.", flag=flag)
                raise InstallationError("La instalación excedió el tiempo límite (5 minutos).")
            except OSError as e:
                if e.winerror == 740:  # Error de elevación requerida
                    # Necesita permisos de administrador
                    logger.warning("Se requieren permisos de administrador para la instalación.")
                    
                    # Verificar si ya somos admin
                    if not self.is_admin():
                        logger.info("El proceso no es admin. Intentando re-lanzar con elevación.")
                        
                        # Intentar ejecutar como admin
                        if self.run_as_admin(driver_path):
                            logger.info("Instalador lanzado como administrador. La instalación continuará en segundo plano.")
                            logger.operation_end("install_windows", success=True, method="interactive_elevation")
                            return
                        else:
                            raise InstallationError(
                                "No se pudo ejecutar como administrador. El usuario pudo haber cancelado la solicitud.",
                                details={'winerror': 740}
                            )
                    else:
                        # Ya somos admin pero falló igual
                        logger.warning("Proceso ya es admin pero la instalación silenciosa requiere elevación. Se intentará modo interactivo.")
                        break
                else:
                    # Otro error OSError
                    logger.error(f"OSError durante la instalación silenciosa con flag {flag}: {e}", exc_info=False)
                    continue
            except Exception as e:
                # Otros errores, intentar siguiente flag
                logger.error(f"Error inesperado durante la instalación silenciosa con flag {flag}: {e}", exc_info=True)
                continue
        
        # Si ningún flag funcionó, intentar ejecución normal con permisos admin
        logger.info("Instalación silenciosa falló. Intentando instalación interactiva.")
        
        try:
            if not self.is_admin():
                # No somos admin, solicitar permisos
                if self.run_as_admin(driver_path):
                    logger.info("Instalador interactivo lanzado con éxito.")
                    logger.operation_end("install_windows", success=True, method="interactive_elevation")
                    return
                else:
                    raise InstallationError(
                        "No se pudo lanzar el instalador con permisos de administrador."
                    )
            else:
                # Somos admin, ejecutar normalmente (con interfaz gráfica)
                logger.info("Ejecutando instalador interactivo como admin.")
                subprocess.Popen([driver_path])
                logger.info(f"Instalador interactivo ejecutado: {driver_path}")
                logger.operation_end("install_windows", success=True, method="interactive_admin")
                
        except Exception as e:
            logger.error(f"Fallo final al intentar la instalación interactiva: {e}", exc_info=True)
            raise InstallationError(
                f"No se pudo completar la instalación del driver: {e}",
                original_error=e
            )
    
    @handle_errors("uninstall_driver", reraise=True)
    def uninstall_driver(self, uninstaller_path):
        """
        Desinstalar driver (si se proporciona desinstalador)
        
        Args:
            uninstaller_path: Ruta del desinstalador
        """
        if not os.path.exists(uninstaller_path):
            raise InstallationError(f"Archivo desinstalador no encontrado: {uninstaller_path}")
        
        if self.system == "Windows":
            logger.info(f"Intentando desinstalación silenciosa de {uninstaller_path}")
            subprocess.run(
                [uninstaller_path, '/S'],
                check=True,
                timeout=300
            )
            logger.info(f"Driver desinstalado usando {uninstaller_path}")
    
    @handle_errors("check_driver_installed", reraise=False, default_return=False)
    def check_driver_installed(self, driver_name):
        """
        Verificar si un driver está instalado (Windows)
        
        Args:
            driver_name: Nombre del driver a verificar
            
        Returns:
            True si está instalado, False si no
        """
        if self.system != "Windows":
            return False
        
        # Buscar en registro de Windows
        result = subprocess.run(
            ['reg', 'query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', driver_name],
            capture_output=True,
            text=True,
            check=False
        )
        
        return result.returncode == 0 and driver_name.lower() in result.stdout.lower()
