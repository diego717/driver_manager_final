"""
Módulo para gestionar conexión y operaciones con Cloudflare R2
"""

import boto3
from botocore.exceptions import ClientError
import json
from pathlib import Path
from datetime import datetime
import os
import re

from core.logger import get_logger
from core.exceptions import handle_errors, CloudStorageError, ConfigurationError

logger = get_logger()


class CloudflareR2Manager:
    """Gestor de conexión y operaciones con Cloudflare R2"""
    
    @handle_errors("r2_manager_init", reraise=True)
    def __init__(self, account_id, access_key_id, secret_access_key, bucket_name):
        """
        Inicializar conexión con Cloudflare R2
        
        Args:
            account_id: ID de cuenta de Cloudflare
            access_key_id: Access Key ID de R2
            secret_access_key: Secret Access Key de R2
            bucket_name: Nombre del bucket
        """
        logger.operation_start("r2_manager_init", bucket=bucket_name)
        
        if not all([account_id, access_key_id, secret_access_key, bucket_name]):
            raise ConfigurationError("Faltan credenciales de R2 (account_id, access_key, secret_key, bucket).")

        self.bucket_name = bucket_name
        # Cache en memoria para evitar pedir head_object repetidamente por driver.
        # key -> {"size_bytes": int, "size_mb": float}
        self._driver_size_cache = {}
        safe_bucket_name = re.sub(r'[^A-Za-z0-9_.-]+', '_', str(bucket_name or "default"))
        self._driver_size_cache_file = (
            Path.home() / ".driver_manager" / "cache" / f"driver_size_cache_{safe_bucket_name}.json"
        )
        
        # Limpiar account_id si viene con URL completa (error común)
        if 'https://' in account_id or 'http://' in account_id:
            logger.warning("El Account ID parece una URL. Intentando extraer el ID.")
            # Usuario pegó URL completa en vez de solo el Account ID
            # Extraer solo el account_id de URLs como:
            # https://dash.cloudflare.com/abc123/r2/overview
            match = re.search(r'cloudflare\.com/([a-f0-9]{32})/', account_id)
            if match:
                account_id = match.group(1)
                logger.info(f"Account ID extraído: ****{account_id[-4:]}")
            else:
                # Si no se puede extraer, eliminar https:// y tomar primera parte
                account_id = account_id.replace('https://', '').replace('http://', '').split('/')[0]
                logger.warning(f"No se pudo extraer el ID de forma segura. Usando: {account_id}")
        
        # Endpoint de Cloudflare R2
        endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"
        
        # Crear cliente S3 compatible
        try:
            self.s3_client = boto3.client(
                's3',
                endpoint_url=endpoint_url,
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
                region_name='auto'  # R2 usa 'auto' como región
            )
            # Probar conexión
            self.s3_client.head_bucket(Bucket=self.bucket_name)
        except ClientError as e:
            logger.error("Error de cliente Boto3 al conectar con R2.", details=str(e), exc_info=True)
            raise CloudStorageError(f"Error al conectar con R2: {e.response['Error']['Message']}", original_error=e)
        except Exception as e:
            logger.error("Error inesperado al inicializar el cliente S3.", details=str(e), exc_info=True)
            raise ConfigurationError(f"Error de configuración de R2: {e}", original_error=e)
        
        # Verificar o crear manifest
        self.manifest_key = "manifest.json"
        self._ensure_manifest()
        self._load_driver_size_cache()
        logger.operation_end("r2_manager_init", success=True)
    
    @handle_errors("_ensure_manifest", reraise=True)
    def _ensure_manifest(self):
        """Asegurar que existe el archivo manifest.json"""
        try:
            self.s3_client.head_object(Bucket=self.bucket_name, Key=self.manifest_key)
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                # No existe, crear uno vacío
                logger.info("Manifest no encontrado. Creando uno nuevo.")
                initial_manifest = {
                    "version": "1.0",
                    "last_updated": datetime.now().isoformat(),
                    "drivers": []
                }
                self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=self.manifest_key,
                    Body=json.dumps(initial_manifest, indent=2),
                    ContentType='application/json'
                )
            else:
                raise CloudStorageError("Error al verificar el manifest en R2.", original_error=e)
    
    @handle_errors("_get_manifest", reraise=True)
    def _get_manifest(self):
        """Obtener manifest actual"""
        response = self.s3_client.get_object(
            Bucket=self.bucket_name,
            Key=self.manifest_key
        )
        return json.loads(response['Body'].read().decode('utf-8'))

    def _load_driver_size_cache(self):
        """Cargar cache persistente de tamaños de drivers desde disco."""
        cache_file = self._driver_size_cache_file
        self._driver_size_cache = {}

        try:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
        except Exception as error:
            logger.warning("No se pudo preparar directorio de cache de tamaños", details=str(error))
            return

        if not cache_file.exists():
            return

        try:
            with open(cache_file, 'r', encoding='utf-8') as cache_stream:
                payload = json.load(cache_stream)
        except Exception as error:
            logger.warning("No se pudo cargar cache de tamaños de drivers", path=str(cache_file), details=str(error))
            return

        raw_cache = payload.get("sizes") if isinstance(payload, dict) and isinstance(payload.get("sizes"), dict) else payload
        if not isinstance(raw_cache, dict):
            return

        normalized_cache = {}
        for raw_key, raw_entry in raw_cache.items():
            driver_key = str(raw_key or "").strip()
            if not driver_key or not isinstance(raw_entry, dict):
                continue

            size_bytes = raw_entry.get("size_bytes")
            size_mb = raw_entry.get("size_mb")
            try:
                if size_bytes in (None, '') and size_mb not in (None, ''):
                    size_bytes = int(round(float(size_mb) * 1024 * 1024))
                elif size_bytes not in (None, ''):
                    size_bytes = max(0, int(size_bytes))
                else:
                    continue

                normalized_cache[driver_key] = {
                    "size_bytes": size_bytes,
                    "size_mb": round(size_bytes / (1024 * 1024), 2),
                }
            except (TypeError, ValueError):
                continue

        self._driver_size_cache = normalized_cache

    def _save_driver_size_cache(self):
        """Persistir cache de tamaños de drivers en disco."""
        cache_file = self._driver_size_cache_file

        try:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "version": 1,
                "updated_at": datetime.now().isoformat(),
                "sizes": self._driver_size_cache,
            }
            temp_file = cache_file.with_suffix(cache_file.suffix + ".tmp")
            with open(temp_file, 'w', encoding='utf-8') as cache_stream:
                json.dump(payload, cache_stream, indent=2)
            temp_file.replace(cache_file)
        except Exception as error:
            logger.warning("No se pudo guardar cache de tamaños de drivers", path=str(cache_file), details=str(error))

    def _set_driver_size_cache_entry(self, driver_key, size_bytes=None, size_mb=None, save=False):
        """Actualizar una entrada del cache con tamaño normalizado."""
        normalized_key = str(driver_key or "").strip()
        if not normalized_key:
            return False

        try:
            if size_bytes in (None, ''):
                if size_mb in (None, ''):
                    return False
                normalized_mb = round(float(size_mb), 2)
                normalized_bytes = int(round(normalized_mb * 1024 * 1024))
            else:
                normalized_bytes = max(0, int(size_bytes))
                normalized_mb = round(normalized_bytes / (1024 * 1024), 2)
        except (TypeError, ValueError):
            return False

        entry = {
            "size_bytes": normalized_bytes,
            "size_mb": normalized_mb,
        }
        changed = self._driver_size_cache.get(normalized_key) != entry
        self._driver_size_cache[normalized_key] = entry

        if save and changed:
            self._save_driver_size_cache()

        return changed

    def _remove_driver_size_cache_entry(self, driver_key, save=False):
        """Eliminar una entrada del cache de tamaños."""
        normalized_key = str(driver_key or "").strip()
        if not normalized_key:
            return False

        if normalized_key not in self._driver_size_cache:
            return False

        self._driver_size_cache.pop(normalized_key, None)
        if save:
            self._save_driver_size_cache()
        return True
    
    @handle_errors("_update_manifest", reraise=True)
    def _update_manifest(self, manifest):
        """Actualizar manifest"""
        manifest['last_updated'] = datetime.now().isoformat()
        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=self.manifest_key,
            Body=json.dumps(manifest, indent=2),
            ContentType='application/json'
        )
    
    @handle_errors("list_drivers", reraise=True, default_return=[])
    def list_drivers(self):
        """
        Listar todos los drivers disponibles
        
        Returns:
            Lista de diccionarios con información de drivers
        """
        logger.operation_start("list_drivers")
        manifest = self._get_manifest()

        # Leer metadata desde manifest para evitar N+1 requests (head_object por driver).
        drivers = []
        cache_changed = False
        manifest_keys = set()
        for driver_info in manifest.get('drivers', []):
            normalized = dict(driver_info or {})
            driver_key = str(normalized.get('key') or '').strip()
            if driver_key:
                manifest_keys.add(driver_key)

            size_bytes = normalized.get('size_bytes')
            try:
                if size_bytes is not None:
                    size_bytes = max(0, int(size_bytes))
                    normalized['size_bytes'] = size_bytes
                    if normalized.get('size_mb') in (None, ''):
                        normalized['size_mb'] = round(size_bytes / (1024 * 1024), 2)
                    if driver_key and self._set_driver_size_cache_entry(
                        driver_key,
                        size_bytes=size_bytes,
                        size_mb=normalized.get('size_mb'),
                        save=False,
                    ):
                        cache_changed = True
                elif driver_key and normalized.get('size_mb') not in (None, ''):
                    if self._set_driver_size_cache_entry(
                        driver_key,
                        size_mb=normalized.get('size_mb'),
                        save=False,
                    ):
                        cache_changed = True
            except (TypeError, ValueError):
                normalized.pop('size_bytes', None)

            if not normalized.get('last_modified'):
                uploaded = normalized.get('uploaded')
                if uploaded:
                    try:
                        parsed = datetime.fromisoformat(str(uploaded).replace('Z', '+00:00'))
                        normalized['last_modified'] = parsed.strftime('%Y-%m-%d %H:%M:%S')
                    except ValueError:
                        normalized['last_modified'] = str(uploaded)

            drivers.append(normalized)

        stale_keys = [cached_key for cached_key in list(self._driver_size_cache.keys()) if cached_key not in manifest_keys]
        for stale_key in stale_keys:
            if self._remove_driver_size_cache_entry(stale_key, save=False):
                cache_changed = True

        if cache_changed:
            self._save_driver_size_cache()
        
        logger.operation_end("list_drivers", success=True, count=len(drivers))
        return drivers

    def get_driver_size_mb(self, driver):
        """
        Obtener tamaño del driver en MB usando cache local (memoria + disco).

        Flujo:
        1) Reutiliza size_mb/size_bytes si ya vienen en el dict.
        2) Usa cache por key si ya se consultó antes.
        3) Si falta info, hace UN head_object para ese key y guarda cache.
        """
        if not isinstance(driver, dict):
            return None

        driver_key = str(driver.get('key') or '')
        if not driver_key:
            return None

        # 1) Si ya tenemos tamaño en el dict, normalizar y cachear.
        size_mb = driver.get('size_mb')
        if size_mb not in (None, ''):
            try:
                normalized_mb = round(float(size_mb), 2)
                size_bytes = driver.get('size_bytes')
                if size_bytes in (None, ''):
                    size_bytes = int(normalized_mb * 1024 * 1024)
                else:
                    size_bytes = max(0, int(size_bytes))
                self._set_driver_size_cache_entry(
                    driver_key,
                    size_bytes=size_bytes,
                    size_mb=normalized_mb,
                    save=True,
                )
                driver['size_mb'] = normalized_mb
                driver['size_bytes'] = size_bytes
                return normalized_mb
            except (TypeError, ValueError):
                pass

        # 2) Cache local.
        cached = self._driver_size_cache.get(driver_key)
        if cached:
            driver['size_bytes'] = cached["size_bytes"]
            driver['size_mb'] = cached["size_mb"]
            return cached["size_mb"]

        # 3) Consulta única a R2 para este driver.
        try:
            response = self.s3_client.head_object(Bucket=self.bucket_name, Key=driver_key)
            size_bytes = max(0, int(response.get('ContentLength') or 0))
            size_mb = round(size_bytes / (1024 * 1024), 2)
            self._set_driver_size_cache_entry(
                driver_key,
                size_bytes=size_bytes,
                size_mb=size_mb,
                save=True,
            )
            driver['size_bytes'] = size_bytes
            driver['size_mb'] = size_mb
            return size_mb
        except Exception as error:
            logger.warning(
                "No se pudo resolver tamaño de driver por head_object",
                key=driver_key,
                details=str(error),
            )
            return None
    
    @handle_errors("upload_driver", reraise=True)
    def upload_driver(self, local_file_path, brand, version, description="", progress_callback=None):
        """
        Subir un driver a R2
        
        Args:
            local_file_path: Ruta local del archivo
            brand: Marca (Magicard, Zebra, Entrust Sigma)
            version: Versión del driver
            description: Descripción opcional
            progress_callback: Función callback para progreso (0-100)
        """
        logger.operation_start("upload_driver", file=local_file_path, brand=brand, version=version)
        # Generar key en formato: drivers/brand/version/filename
        file_name = Path(local_file_path).name
        driver_key = f"drivers/{brand}/{version}/{file_name}"
        
        # Callback de progreso
        file_size = os.path.getsize(local_file_path)
        
        def upload_progress(bytes_transferred):
            if progress_callback and file_size > 0:
                percent = int((bytes_transferred / file_size) * 100)
                progress_callback(percent)
        
        # Subir archivo
        self.s3_client.upload_file(
            local_file_path,
            self.bucket_name,
            driver_key,
            Callback=upload_progress
        )
        
        # Actualizar manifest
        manifest = self._get_manifest()
        
        # Verificar si ya existe y eliminarlo
        removed_entries = [
            d for d in manifest['drivers']
            if d['brand'] == brand and d['version'] == version
        ]
        manifest['drivers'] = [
            d for d in manifest['drivers']
            if not (d['brand'] == brand and d['version'] == version)
        ]
        
        uploaded_at = datetime.now()

        # Agregar nuevo driver
        driver_entry = {
            "brand": brand,
            "version": version,
            "description": description,
            "key": driver_key,
            "filename": file_name,
            "uploaded": uploaded_at.isoformat(),
            "last_modified": uploaded_at.strftime('%Y-%m-%d %H:%M:%S'),
            "size_bytes": file_size,
            "size_mb": round(file_size / (1024 * 1024), 2),
        }
        
        manifest['drivers'].append(driver_entry)
        self._update_manifest(manifest)

        cache_changed = False
        for removed in removed_entries:
            if self._remove_driver_size_cache_entry(removed.get('key'), save=False):
                cache_changed = True

        if self._set_driver_size_cache_entry(
            driver_key,
            size_bytes=file_size,
            size_mb=driver_entry.get("size_mb"),
            save=False,
        ):
            cache_changed = True

        if cache_changed:
            self._save_driver_size_cache()
        
        logger.operation_end("upload_driver", success=True, key=driver_key)
        return driver_key
    
    @handle_errors("download_driver", reraise=True)
    def download_driver(self, driver_key, local_path, progress_callback=None):
        """
        Descargar un driver
        
        Args:
            driver_key: Key del driver en R2
            local_path: Ruta local donde guardar
            progress_callback: Función callback para progreso (0-100)
        """
        logger.operation_start("download_driver", key=driver_key, path=local_path)
        # Asegurar directorio
        Path(local_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Obtener tamaño del archivo
        response = self.s3_client.head_object(
            Bucket=self.bucket_name,
            Key=driver_key
        )
        file_size = response['ContentLength']
        
        # Callback de progreso
        bytes_so_far = 0
        def download_progress(bytes_chunk):
            nonlocal bytes_so_far
            bytes_so_far += bytes_chunk
            if progress_callback and file_size > 0:
                percent = int((bytes_so_far / file_size) * 100)
                progress_callback(percent)
        
        # Descargar
        self.s3_client.download_file(
            self.bucket_name,
            driver_key,
            local_path,
            Callback=download_progress
        )
        
        logger.operation_end("download_driver", success=True)
        return local_path
    
    @handle_errors("delete_driver", reraise=True)
    def delete_driver(self, driver_key):
        """
        Eliminar un driver
        
        Args:
            driver_key: Key del driver en R2
        """
        logger.operation_start("delete_driver", key=driver_key)
        # Eliminar archivo
        self.s3_client.delete_object(
            Bucket=self.bucket_name,
            Key=driver_key
        )
        
        # Actualizar manifest
        manifest = self._get_manifest()
        manifest['drivers'] = [
            d for d in manifest['drivers'] 
            if d['key'] != driver_key
        ]
        self._update_manifest(manifest)
        self._remove_driver_size_cache_entry(driver_key, save=True)
        logger.operation_end("delete_driver", success=True)
    
    @handle_errors("get_driver_info", reraise=True)
    def get_driver_info(self, brand, version):
        """
        Obtener información de un driver específico
        
        Args:
            brand: Marca del driver
            version: Versión del driver
            
        Returns:
            Diccionario con información del driver o None
        """
        manifest = self._get_manifest()
        
        for driver in manifest['drivers']:
            if driver['brand'] == brand and driver['version'] == version:
                return driver
        
        return None
    
    @handle_errors("search_drivers", reraise=True, default_return=[])
    def search_drivers(self, brand=None, version=None):
        """
        Buscar drivers con filtros
        
        Args:
            brand: Filtrar por marca (opcional)
            version: Filtrar por versión (opcional)
            
        Returns:
            Lista de drivers que coinciden
        """
        drivers = self.list_drivers()
        
        if brand:
            drivers = [d for d in drivers if d['brand'] == brand]
        
        if version:
            drivers = [d for d in drivers if d['version'] == version]
        
        return drivers
    
    @handle_errors("upload_file_content", reraise=True)
    def upload_file_content(self, key, content):
        """Subir contenido como archivo a R2"""
        logger.operation_start("upload_file_content", key=key)
        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=content.encode('utf-8'),
            ContentType='application/json'
        )
        logger.operation_end("upload_file_content", success=True)
        return True
    
    @handle_errors("download_file_content", reraise=True)
    def download_file_content(self, key):
        """Descargar contenido de archivo desde R2"""
        logger.operation_start("download_file_content", key=key)
        try:
            response = self.s3_client.get_object(
                Bucket=self.bucket_name,
                Key=key
            )
            content = response['Body'].read().decode('utf-8')
            logger.operation_end("download_file_content", success=True)
            return content
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                logger.warning(f"El archivo con key '{key}' no se encontró en el bucket.", key=key)
                return None # Return None if file not found, not an error
            else:
                raise CloudStorageError(f"Error al descargar contenido del archivo: {e.response['Error']['Message']}", original_error=e)
