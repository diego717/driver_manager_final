import PyInstaller.__main__
import os
import shutil
from pathlib import Path

# --- ConfiguraciÃ³n ---
APP_NAME = "SiteOps"
ENTRY_POINT = "main.py"
# Icono opcional para el ejecutable.
ICON_FILE = "assets/app_icon.ico"

# --- Limpieza de compilaciones anteriores ---
print("ðŸ§¹ Limpiando compilaciones anteriores...")
if Path('build').exists():
    shutil.rmtree('build')
if Path('dist').exists():
    shutil.rmtree('dist')
if Path(f'{APP_NAME}.spec').exists():
    os.remove(f'{APP_NAME}.spec')

# --- Opciones de PyInstaller ---
pyinstaller_options = [
    '--name', APP_NAME,
    '--onefile',          # Crear un Ãºnico ejecutable.
    '--windowed',         # AplicaciÃ³n de GUI, sin consola de comandos.
    '--clean',            # Limpiar cachÃ© de PyInstaller antes de compilar.
    '--hidden-import', 'qrcode',
    '--hidden-import', 'PIL',
    '--hidden-import', 'PIL.Image',
    '--hidden-import', 'PIL.ImageFile',
    '--collect-submodules', 'qrcode',
]

# AÃ±adir icono si el archivo existe
if Path(ICON_FILE).exists():
    print(f"ðŸ–¼ï¸  AÃ±adiendo icono: {ICON_FILE}")
    pyinstaller_options.extend(['--icon', ICON_FILE])
else:
    print(f"âš ï¸  No se encontrÃ³ icono en '{ICON_FILE}'. Se usarÃ¡ el icono por defecto.")

# AÃ±adir el punto de entrada del script
pyinstaller_options.append(ENTRY_POINT)

# --- Ejecutar PyInstaller ---
print("\nðŸš€ Ejecutando PyInstaller...")
print(f"   Comando: pyinstaller {' '.join(pyinstaller_options)}")

PyInstaller.__main__.run(pyinstaller_options)

print("\nâœ… Â¡CompilaciÃ³n completada con Ã©xito!")
print(f"   Tu ejecutable se encuentra en la carpeta: {Path('dist').resolve()}")
