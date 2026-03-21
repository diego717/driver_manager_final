const fs = require("fs");
const path = require("path");

const { expo: baseExpoConfig } = require("./app.json");

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
