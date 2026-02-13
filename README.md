# 🖨️ Driver Manager - Gestor de Controladores para Impresoras de Tarjetas

[![Tests](https://github.com/diego717/driver_manager_final/actions/workflows/tests.yml/badge.svg)](https://github.com/diego717/driver_manager_final/actions/workflows/tests.yml)

**Driver Manager** es una aplicación de escritorio desarrollada en Python y PyQt6, diseñada para centralizar, gestionar y auditar la instalación de controladores para impresoras de tarjetas de identificación (como Magicard, Zebra, Entrust, etc.).

La aplicación utiliza la infraestructura de **Cloudflare (R2 y D1)** para ofrecer una solución portable, segura y multi-usuario, ideal para técnicos de soporte que trabajan en diferentes equipos.

!screenshot

---

## ✨ Características Principales

- **Gestión Centralizada de Drivers**: Sube, lista, descarga e instala drivers desde una única interfaz.
- **Integración con la Nube**: Utiliza **Cloudflare R2** para el almacenamiento de los archivos de drivers y la configuración del sistema de usuarios.
- **Modo Portable**: Funciona directamente desde una unidad USB sin necesidad de instalación local. La configuración se almacena de forma cifrada en el propio dispositivo.
- **Seguridad Robusta**:
- **Configuración Cifrada**: Las credenciales de la nube se guardan en un archivo `config.enc` cifrado con **AES-256**.
- **Inyección Segura**: Al iniciar por primera vez, consume un archivo `portable_config.json`, lo cifra y lo elimina para no dejar rastros de las credenciales en texto plano.
- **Verificación de Integridad**: Usa **HMAC** para asegurar que la configuración no ha sido alterada.
- **Sistema Multi-Usuario con Roles**:
  - **super_admin**: Control total, incluyendo la gestión de credenciales de la nube y la creación de otros usuarios.
  - **admin**: Puede gestionar drivers (subir/eliminar) y ver el historial, pero no puede ver ni modificar las credenciales de la nube.
  - **viewer**: Rol de solo lectura (aún en desarrollo).
- **Historial y Auditoría de Instalaciones**:
  - Cada instalación (exitosa o fallida) se registra en una base de datos **Cloudflare D1** a través de una API (Worker).
  - Permite editar registros para añadir notas o corregir tiempos.
  - Log de auditoría detallado para acciones críticas (logins, subidas, eliminaciones, etc.).
- **Generación de Reportes**: Exporta el historial de instalaciones a archivos **Excel (.xlsx)** para reportes diarios o mensuales.
- **Caché Local**: Guarda los drivers descargados en una caché local para agilizar futuras instalaciones.
- **Interfaz Moderna**:
  - Soporte para temas (claro y oscuro).
  - Interfaz intuitiva organizada en pestañas.

---

## 🛠️ Tecnología Utilizada

- **Lenguaje**: Python 3
- **Interfaz Gráfica**: PyQt6
- **Almacenamiento en la Nube**: Cloudflare R2 (compatible con S3)
- **Base de Datos en la Nube**: Cloudflare D1 (a través de un Worker API)
- **Comunicación Cloud**:
  - `boto3`: Para interactuar con el almacenamiento R2.
  - `requests`: Para comunicarse con la API del historial en Cloudflare Workers.
- **Seguridad**:
  - `cryptography`: Para el cifrado AES-256.
  - `bcrypt`: Para el hashing seguro de contraseñas de usuario.
- **Reportes**: `openpyxl` (para la generación de archivos Excel).

---

## 🚀 Configuración y Puesta en Marcha

La aplicación está diseñada para ser **portable**. Sigue estos pasos para configurarla en una unidad USB:

1. **Clona o copia los archivos del proyecto** en la raíz de tu unidad USB.

2. **Crea el archivo de configuración portable**: En la misma carpeta raíz, crea un archivo llamado `portable_config.json` con tus credenciales de Cloudflare.

    ```json
    {
      "account_id": "TU_ACCOUNT_ID_DE_CLOUDFLARE",
      "access_key_id": "TU_ACCESS_KEY_ID_DE_R2",
      "secret_access_key": "TU_SECRET_ACCESS_KEY_DE_R2",
      "bucket_name": "NOMBRE_DE_TU_BUCKET",
      "api_url": "URL_DE_TU_WORKER_API_PARA_HISTORIAL"
    }
    ```

3. **Ejecuta la aplicación**: Inicia `main.py` o el ejecutable `DriverManager.exe`.

    - **En el primer inicio**, la aplicación detectará `portable_config.json`.
    - Cifrará su contenido y lo guardará en una carpeta `config/` dentro del USB con el nombre `config.enc`.
    - Por seguridad, **eliminará automáticamente el archivo `portable_config.json`**.
    - Te guiará para crear el primer usuario **super_admin**.

4. **Inicios Posteriores**: La aplicación leerá directamente del archivo cifrado `config.enc`, manteniendo tus credenciales seguras.

---

## 📖 Uso de la Aplicación

La interfaz se divide en tres pestañas principales:

1. 📦 Drivers Disponibles
   - Filtra los drivers por marca.
- Selecciona un driver para ver sus detalles (versión, tamaño, fecha).
  - **Descarga** el driver a tu equipo o **Descarga e Instala** directamente. La instalación intentará ejecutarse de forma silenciosa y, si no es posible, solicitará permisos de administrador.

2. 📊 Historial y Reportes
- Visualiza un historial de todas las instalaciones realizadas.
- Edita registros para añadir notas o corregir el tiempo de instalación.
  - Genera reportes en formato Excel del día actual o de un mes específico.
  - Consulta estadísticas de instalaciones.

3. 🔐 Administración
- **Inicio de Sesión**: Accede con tu usuario y contraseña. El panel se adaptará a tu rol.
- **Gestión de Drivers (admin/super_admin)**: Sube nuevos drivers a la nube o elimina los existentes.
- **Gestión de Usuarios (super_admin)**: Crea nuevos usuarios, desactívalos y gestiona roles.
- **Configuración de la Nube (super_admin)**: Visualiza y modifica las credenciales de Cloudflare R2.
- **Configuración General**: Cambia tu contraseña, limpia la caché de drivers descargados y cambia el tema de la aplicación.

---

## 🛡️ Modelo de Seguridad

La seguridad es un pilar fundamental de este proyecto, especialmente al manejar credenciales de la nube en un entorno portable.

- **Cifrado en Reposo**: El archivo `config.enc` está protegido con cifrado simétrico AES-256, derivado de una contraseña maestra.
- **Protección de Credenciales**: El archivo `portable_config.json` es un vector de entrada temporal. Se elimina tras la inyección inicial para minimizar la exposición.
- **Control de Acceso Basado en Roles (RBAC)**: Los roles `super_admin` y `admin` tienen capacidades distintas, protegiendo las configuraciones más sensibles.
- **Auditoría**: Todas las acciones importantes quedan registradas, permitiendo trazar quién hizo qué y cuándo.

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia MIT. Consulta el archivo `LICENSE` para más detalles
