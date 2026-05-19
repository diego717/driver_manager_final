import { Redirect, useLocalSearchParams } from "expo-router";

export default function QrHubRedirectScreen() {
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const target = String(rawMode || "").trim().toLowerCase() === "generate"
    ? "/qr-generator"
    : "/scan";

  return <Redirect href={target as never} />;
}
