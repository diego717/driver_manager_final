const fs = require("fs");
const path = require("path");

const baseExpoConfig = {
  name: "SiteOps",
  slug: "mobile-app",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "mobileapp",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  splash: {
    image: "./assets/images/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.diego717.drivermanager",
    buildNumber: "1",
    infoPlist: {
      NSFaceIDUsageDescription: "Permite desbloquear SiteOps con Face ID.",
      NSLocationWhenInUseUsageDescription:
        "Permite capturar la ubicacion para validar cierres operativos en sitio.",
      UIBackgroundModes: ["remote-notification"],
    },
  },
  android: {
    package: "com.diego717.drivermanager",
    googleServicesFile: "./google-services.json",
    versionCode: 1,
    softwareKeyboardLayoutMode: "resize",
    permissions: [
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-local-authentication",
      {
        faceIDPermission: "Permite desbloquear SiteOps con Face ID.",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/images/icon.png",
        color: "#0b7a75",
        defaultChannel: "incidents",
        enableBackgroundRemoteNotifications: true,
      },
    ],
    [
      "expo-media-library",
      {
        photosPermission: "Permite guardar imagenes QR en la galeria.",
        savePhotosPermission: "Permite guardar imagenes QR en la galeria.",
        granularPermissions: ["photo"],
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Permite capturar la ubicacion para validar cierres operativos en sitio.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: "9203816d-c0f9-446f-a1d4-24f76db40f12",
    },
    apiSecurity: {
      allowHttpApiBaseUrlInDebug: false,
    },
  },
};

function resolveFilePathFromEnv(envName, localFileName) {
  const fromEnv = String(process.env[envName] || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const localAbsolutePath = path.join(__dirname, localFileName);
  if (fs.existsSync(localAbsolutePath)) {
    return `./${localFileName}`;
  }

  return undefined;
}

function resolveTrimmedEnvValue(envName) {
  const value = String(process.env[envName] || "").trim();
  return value || undefined;
}

module.exports = () => {
  const expo = JSON.parse(JSON.stringify(baseExpoConfig));
  const appDisplayName = resolveTrimmedEnvValue("APP_DISPLAY_NAME");

  if (appDisplayName) {
    expo.name = appDisplayName;
  }

  const androidGoogleServicesFile = resolveFilePathFromEnv(
    "GOOGLE_SERVICES_JSON",
    "google-services.json",
  );
  if (androidGoogleServicesFile) {
    expo.android = expo.android || {};
    expo.android.googleServicesFile = androidGoogleServicesFile;
  } else if (expo.android && "googleServicesFile" in expo.android) {
    delete expo.android.googleServicesFile;
  }

  const iosGoogleServicesFile = resolveFilePathFromEnv(
    "GOOGLE_SERVICE_INFO_PLIST",
    "GoogleService-Info.plist",
  );
  if (iosGoogleServicesFile) {
    expo.ios = expo.ios || {};
    expo.ios.googleServicesFile = iosGoogleServicesFile;
  } else if (expo.ios && "googleServicesFile" in expo.ios) {
    delete expo.ios.googleServicesFile;
  }

  return { expo };
};
