if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("[PWA] Service Worker registered:", registration.scope);

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              if (typeof showNotification === "function") {
                showNotification("🔄 Nueva versión disponible. Recarga para actualizar.", "info");
              }
            }
          });
        });
      })
      .catch((err) => {
        console.error("[PWA] Service Worker registration failed:", err);
      });

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data === "update-available" && typeof showNotification === "function") {
        showNotification("🔄 Nueva versión disponible. Recarga para actualizar.", "info");
      }
    });
  });
}

let deferredPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  const useCustomInstallFlow = window.__DM_USE_CUSTOM_INSTALL_PROMPT__ === true;
  if (!useCustomInstallFlow) {
    deferredPrompt = null;
    return;
  }

  event.preventDefault();
  deferredPrompt = event;
  console.log("[PWA] Install prompt available");
});

window.addEventListener("appinstalled", () => {
  console.log("[PWA] App installed");
  deferredPrompt = null;
  if (typeof showNotification === "function") {
    showNotification("✅ App instalada correctamente", "success");
  }
});
