import os
import shutil
from pathlib import Path

import PyInstaller.__main__

APP_NAME = "SiteOps"
ENTRY_POINT = "main.py"
ICON_FILE = "assets/app_icon.ico"

print("Cleaning previous build artifacts...")
if Path("build").exists():
    shutil.rmtree("build")
if Path("dist").exists():
    shutil.rmtree("dist")
if Path(f"{APP_NAME}.spec").exists():
    os.remove(f"{APP_NAME}.spec")

pyinstaller_options = [
    "--name",
    APP_NAME,
    "--onefile",
    "--windowed",
    "--clean",
    "--hidden-import",
    "qrcode",
    "--hidden-import",
    "PIL",
    "--hidden-import",
    "PIL.Image",
    "--hidden-import",
    "PIL.ImageFile",
    "--collect-submodules",
    "qrcode",
]

if Path(ICON_FILE).exists():
    print(f"Including icon: {ICON_FILE}")
    pyinstaller_options.extend(["--icon", ICON_FILE])
else:
    print(f"WARNING: icon not found at '{ICON_FILE}'. Using the default icon.")

pyinstaller_options.append(ENTRY_POINT)

print("\nRunning PyInstaller...")
print(f"Command: pyinstaller {' '.join(pyinstaller_options)}")

PyInstaller.__main__.run(pyinstaller_options)

print("\nBuild completed successfully.")
print(f"Executable available in: {Path('dist').resolve()}")
