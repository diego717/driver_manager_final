import { HttpError } from "../lib/core.js";

export function createDevicesRouteHandlers({
  jsonResponse,
  normalizeFcmToken,
  readJsonOrThrowBadRequest,
  upsertDeviceTokenForWebUser,
}) {
  async function handleDevicesRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
  ) {
    if (routeParts.length === 1 && routeParts[0] === "devices" && request.method === "POST") {
      if (!isWebRoute || !webSession?.user_id) {
        throw new HttpError(401, "Registro de dispositivos requiere token Bearer web.");
      }

      const data = await readJsonOrThrowBadRequest(request);
      const fcmToken = normalizeFcmToken(data?.fcm_token);

      await upsertDeviceTokenForWebUser(env, {
        userId: Number(webSession.user_id),
        fcmToken,
        tenantId: webSession?.tenant_id,
        deviceModel: data?.device_model,
        appVersion: data?.app_version,
        platform: data?.platform || "android",
      });

      return jsonResponse(
        request,
        env,
        corsPolicy,
        {
          success: true,
          registered: true,
        },
        200,
      );
    }

    return null;
  }

  return {
    handleDevicesRoute,
  };
}
