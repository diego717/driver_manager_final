import PyInstaller.__main__
import os
import shutil
from pathlib import Path

# --- Configuración ---
APP_NAME = "DriverManager"
ENTRY_POINT = "main.py"
# Icono opcional para el ejecutable.
ICON_FILE = "assets/app_icon.ico"

# --- Limpieza de compilaciones anteriores ---
print("🧹 Limpiando compilaciones anteriores...")
if Path('build').exists():
    shutil.rmtree('build')
if Path('dist').exists():
    shutil.rmtree('dist')
if Path(f'{APP_NAME}.spec').exists():
    os.remove(f'{APP_NAME}.spec')

# --- Opciones de PyInstaller ---
pyinstaller_options = [
    '--name', APP_NAME,
    '--onefile',          # Crear un único ejecutable.
    '--windowed',         # Aplicación de GUI, sin consola de comandos.
    '--clean',            # Limpiar caché de PyInstaller antes de compilar.
]

# Añadir icono si el archivo existe
if Path(ICON_FILE).exists():
    print(f"🖼️  Añadiendo icono: {ICON_FILE}")
    pyinstaller_options.extend(['--icon', ICON_FILE])
else:
    print(f"⚠️  No se encontró icono en '{ICON_FILE}'. Se usará el icono por defecto.")

# Añadir el punto de entrada del script
pyinstaller_options.append(ENTRY_POINT)

# --- Ejecutar PyInstaller ---
print("\n🚀 Ejecutando PyInstaller...")
print(f"   Comando: pyinstaller {' '.join(pyinstaller_options)}")

PyInstaller.__main__.run(pyinstaller_options)

print("\n✅ ¡Compilación completada con éxito!")
print(f"   Tu ejecutable se encuentra en la carpeta: {Path('dist').resolve()}")
