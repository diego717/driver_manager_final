#!/usr/bin/env python3
import re

# Leer el archivo worker.js
with open('worker.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Agregar log para login exitoso
old_login_success = '''    await clearWebLoginRateLimit(env, rateLimitIdentifier);
    const token = await buildWebAccessToken(env, {
      username: user.username,
      role: user.role,
      user_id: Number(user.id),
    });

    return jsonResponse('''

new_login_success = '''    await clearWebLoginRateLimit(env, rateLimitIdentifier);
    
    // Log audit event for successful login
    await logAuditEvent(env, {
      action: "web_login_success",
      username: user.username,
      success: true,
      details: {
        role: user.role,
        user_id: Number(user.id)
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });
    
    const token = await buildWebAccessToken(env, {
      username: user.username,
      role: user.role,
      user_id: Number(user.id),
    });

    return jsonResponse('''

content = content.replace(old_login_success, new_login_success)

# 2. Agregar log para login fallido
old_login_fail = '''    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        await recordFailedWebLoginAttempt(env, rateLimitIdentifier);
      }
      throw error;
    }'''

new_login_fail = '''    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        await recordFailedWebLoginAttempt(env, rateLimitIdentifier);
        
        // Log audit event for failed login
        await logAuditEvent(env, {
          action: "web_login_failed",
          username: username,
          success: false,
          details: {
            reason: error.message,
            status_code: error.status
          },
          ipAddress: getClientIpForRateLimit(request),
          platform: "web"
        });
      }
      throw error;
    }'''

content = content.replace(old_login_fail, new_login_fail)

# 3. Agregar log para creación de usuario
old_create_user = '''    const username = validateWebUsername(body?.username);
    const password = validateWebPassword(body?.password);
    const role = normalizeWebRole(body?.role || "viewer");
    const createdUser = await createWebUser(env, { username, password, role });

    return jsonResponse('''

new_create_user = '''    const username = validateWebUsername(body?.username);
    const password = validateWebPassword(body?.password);
    const role = normalizeWebRole(body?.role || "viewer");
    const createdUser = await createWebUser(env, { username, password, role });

    // Log audit event for user creation
    await logAuditEvent(env, {
      action: "web_user_created",
      username: session.sub,
      success: true,
      details: {
        created_user: createdUser.username,
        created_user_id: createdUser.id,
        created_role: createdUser.role,
        performed_by: session.sub,
        performed_by_role: session.role
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });

    return jsonResponse('''

content = content.replace(old_create_user, new_create_user)

# 4. Agregar log para actualización de usuario
old_update_user = '''    await updateWebUserRoleAndStatus(env, {
      userId,
      role: nextRole,
      isActive: nextIsActive,
    });

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse('''

new_update_user = '''    await updateWebUserRoleAndStatus(env, {
      userId,
      role: nextRole,
      isActive: nextIsActive,
    });

    // Log audit event for user update
    await logAuditEvent(env, {
      action: "web_user_updated",
      username: session.sub,
      success: true,
      details: {
        updated_user_id: userId,
        updated_user: existingUser.username,
        old_role: existingUser.role,
        new_role: nextRole,
        old_active: Boolean(existingUser.is_active),
        new_active: Boolean(nextIsActive),
        performed_by: session.sub,
        performed_by_role: session.role
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse('''

content = content.replace(old_update_user, new_update_user)

# 5. Agregar log para reset de contraseña
old_reset_password = '''    const newPassword = validateWebPassword(body?.new_password, "new_password");
    await forceResetWebUserPassword(env, { userId, newPassword });

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse('''

new_reset_password = '''    const newPassword = validateWebPassword(body?.new_password, "new_password");
    await forceResetWebUserPassword(env, { userId, newPassword });

    // Log audit event for password reset
    await logAuditEvent(env, {
      action: "web_password_reset",
      username: session.sub,
      success: true,
      details: {
        target_user_id: userId,
        target_user: existingUser.username,
        performed_by: session.sub,
        performed_by_role: session.role
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });

    const updatedUser = await getWebUserById(env, userId);
    return jsonResponse('''

content = content.replace(old_reset_password, new_reset_password)

# 6. Agregar log para importación de usuarios
old_import = '''    return jsonResponse(
      {
        success: true,
        imported: processedUsers.length,
        created,
        updated,
        users: processedUsers,
      },
      200,
    );'''

new_import = '''    // Log audit event for user import
    await logAuditEvent(env, {
      action: "web_users_imported",
      username: session.sub,
      success: true,
      details: {
        total_imported: processedUsers.length,
        created,
        updated,
        performed_by: session.sub,
        performed_by_role: session.role
      },
      ipAddress: getClientIpForRateLimit(request),
      platform: "web"
    });

    return jsonResponse(
      {
        success: true,
        imported: processedUsers.length,
        created,
        updated,
        users: processedUsers,
      },
      200,
    );'''

content = content.replace(old_import, new_import)

# 7. Agregar log para creación de instalación
old_installation = '''          .run();

          return jsonResponse({ success: true }, 201);'''

new_installation = '''          .run();

          // Log audit event for installation creation
          await logAuditEvent(env, {
            action: "installation_created",
            username: webSession?.sub || "api",
            success: true,
            details: {
              driver_brand: payload.driver_brand,
              driver_version: payload.driver_version,
              status: payload.status,
              client_name: payload.client_name
            },
            ipAddress: getClientIpForRateLimit(request),
            platform: isWebRoute ? "web" : "api"
          });

          return jsonResponse({ success: true }, 201);'''

content = content.replace(old_installation, new_installation)

# 8. Agregar log para eliminación de instalación
old_delete = '''          await env.DB.prepare("DELETE FROM installations WHERE id = ?").bind(recordId).run();
          return jsonResponse({ message: `Registro ${recordId} eliminado.` });'''

new_delete = '''          // Log audit event for installation deletion
          await logAuditEvent(env, {
            action: "installation_deleted",
            username: webSession?.sub || "api",
            success: true,
            details: {
              deleted_id: recordId
            },
            ipAddress: getClientIpForRateLimit(request),
            platform: isWebRoute ? "web" : "api"
          });

          await env.DB.prepare("DELETE FROM installations WHERE id = ?").bind(recordId).run();
          return jsonResponse({ message: `Registro ${recordId} eliminado.` });'''

content = content.replace(old_delete, new_delete)

# Guardar el archivo actualizado
with open('worker.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Logs de auditoría agregados exitosamente")
print("   - web_login_success")
print("   - web_login_failed")
print("   - web_user_created")
print("   - web_user_updated")
print("   - web_password_reset")
print("   - web_users_imported")
print("   - installation_created")
print("   - installation_deleted")
print("   - create_incident (ya existía)")
