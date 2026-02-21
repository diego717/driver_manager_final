# Plan de Implementación: Biometría y Notificaciones Push

## 1. Dependencias a agregar

```
json
{
  "expo-local-authentication": "~15.0.8",
  "expo-notifications": "~0.30.9"
}
```

## 2. Archivos a crear

### Biometría
- `src/services/biometric.ts` - Servicio de autenticación biométrica
- `src/components/BiometricLockScreen.tsx` - Pantalla de bloqueo
- `src/storage/app-preferences.ts` - Preferencias de la app (biometric enabled)

### Notificaciones
- `src/services/notifications.ts` - Servicio de notificaciones
- `src/hooks/useNotifications.ts` - Hook para manejar notificaciones

## 3. Archivos a modificar

- `mobile-app/package.json` - Agregar dependencias
- `mobile-app/app.json` - Agregar permisos
- `mobile-app/app/_layout.tsx` - Integrar lock screen biométrico
- `mobile-app/app/(tabs)/_layout.tsx` - Proteger tabs con biometría

## 4. Flujo de Biometría

1. App se abre → Mostrar lock screen
2. Usuario autentica con Face ID/Touch ID
3. Si es exitoso → Mostrar app normalmente
4. Si falla → Mostrar opción de reintentar o usar código fallback

## 5. Flujo de Notificaciones

1. App inicia → Solicitar permisos de notificación
2. Registrar device token con Expo
3. Suscribirse a canales de incidencias
4. Manejar notificaciones en foreground y background

---

## Checklist de Implementación

- [ ] 1. Agregar dependencias a package.json
- [ ] 2. Actualizar app.json con permisos
- [ ] 3. Crear servicio de biometría
- [ ] 4. Crear pantalla de lock
- [ ] 5. Crear servicio de notificaciones
- [ ] 6. Crear hook de notificaciones
- [ ] 7. Actualizar _layout.tsx principal
- [ ] 8. Probar integración
