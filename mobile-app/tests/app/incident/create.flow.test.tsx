import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

const routeParamsMocks = vi.hoisted(() => ({
  params: {
    installationId: "45",
  } as Record<string, string>,
}));

const sessionMocks = vi.hoisted(() => ({
  checkingSession: false,
  hasActiveSession: true,
}));

const apiMocks = vi.hoisted(() => ({
  listInstallations: vi.fn(),
  getCurrentLinkedTechnicianContext: vi.fn(),
  resolveAssetByExternalCode: vi.fn(),
  linkAssetToInstallation: vi.fn(),
}));

const syncMocks = vi.hoisted(() => ({
  enqueueCreateIncident: vi.fn(),
  registerIncidentExecutors: vi.fn(),
  runSync: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  captureCurrentGpsSnapshot: vi.fn(),
  canReachConfiguredApi: vi.fn(),
  triggerSuccessHaptic: vi.fn(),
  triggerWarningHaptic: vi.fn(),
}));

vi.mock("expo-router", () => ({
  useRouter: () => routerMocks,
  useLocalSearchParams: () => routeParamsMocks.params,
}));

vi.mock("react-native", () => ({
  ActivityIndicator: ({ children, ...props }: any) => React.createElement("ActivityIndicator", props, children),
  Platform: {
    OS: "ios",
    select: (options: Record<string, unknown>) => options.ios ?? options.default,
  },
  StyleSheet: {
    create: (styles: any) => styles,
  },
  Text: ({ children, ...props }: any) => React.createElement("Text", props, children),
  TextInput: ({ children, ...props }: any) => React.createElement("TextInput", props, children),
  TouchableOpacity: ({ children, ...props }: any) =>
    React.createElement("TouchableOpacity", props, children),
  View: ({ children, ...props }: any) => React.createElement("View", props, children),
}));

vi.mock("@react-navigation/native", async () => {
  const ReactModule = await import("react");
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

vi.mock("@/src/api/assets", () => ({
  resolveAssetByExternalCode: apiMocks.resolveAssetByExternalCode,
  linkAssetToInstallation: apiMocks.linkAssetToInstallation,
}));

vi.mock("@/src/api/client", () => ({
  extractApiError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock("@/src/api/incidents", () => ({
  listInstallations: apiMocks.listInstallations,
}));

vi.mock("@/src/api/technicians", () => ({
  getCurrentLinkedTechnicianContext: apiMocks.getCurrentLinkedTechnicianContext,
}));

vi.mock("@/src/components/EmptyStateCard", () => ({
  default: ({ title, body }: { title: string; body: string }) => (
    <>
      <>{title}</>
      <>{body}</>
    </>
  ),
}));

vi.mock("@/src/components/InlineFeedback", () => ({
  default: ({ message }: { message: string }) => <>{message}</>,
}));

vi.mock("@/src/components/ScreenHero", () => ({
  default: ({ title, description, children }: React.PropsWithChildren<{ title: string; description: string }>) => (
    <>
      <>{title}</>
      <>{description}</>
      {children}
    </>
  ),
}));

vi.mock("@/src/components/ScreenScaffold", () => ({
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("@/src/components/SectionCard", () => ({
  default: ({
    title,
    description,
    aside,
    children,
  }: React.PropsWithChildren<{ title: string; description?: string; aside?: React.ReactNode }>) => (
    <>
      <>{title}</>
      <>{description}</>
      {aside}
      {children}
    </>
  ),
}));

vi.mock("@/src/components/StatusChip", () => ({
  default: ({ value }: { value?: string | null }) => <>{value || ""}</>,
}));

vi.mock("@/src/components/SyncStatusBanner", () => ({
  default: () => <>sync-banner</>,
}));

vi.mock("@/src/components/WebInlineLoginCard", () => ({
  default: ({ hint }: { hint: string }) => <>{hint}</>,
}));

vi.mock("@/src/services/haptics", () => ({
  triggerSuccessHaptic: serviceMocks.triggerSuccessHaptic,
  triggerWarningHaptic: serviceMocks.triggerWarningHaptic,
}));

vi.mock("@/src/services/location", () => ({
  captureCurrentGpsSnapshot: serviceMocks.captureCurrentGpsSnapshot,
}));

vi.mock("@/src/services/network/api-connectivity", () => ({
  canReachConfiguredApi: serviceMocks.canReachConfiguredApi,
}));

vi.mock("@/src/services/sync/incident-outbox-service", () => ({
  enqueueCreateIncident: syncMocks.enqueueCreateIncident,
  registerIncidentExecutors: syncMocks.registerIncidentExecutors,
}));

vi.mock("@/src/services/sync/sync-runner", () => ({
  runSync: syncMocks.runSync,
}));

vi.mock("@/src/session/web-session-store", () => ({
  useSharedWebSessionState: () => sessionMocks,
}));

vi.mock("@/src/theme/palette", () => ({
  useAppPalette: () => ({
    loadingSpinner: "#0f8b84",
    textSecondary: "#666",
    primaryButtonBg: "#0f8b84",
    primaryButtonText: "#fff",
    heroEyebrowBg: "#eef6f6",
    heroBorder: "#d1e7e5",
    heroEyebrowText: "#0f8b84",
    secondaryButtonBg: "#f5f5f5",
    secondaryButtonText: "#222",
    inputBorder: "#ccc",
    refreshBg: "#f0f0f0",
    refreshText: "#333",
    infoBg: "#e8f4ff",
    infoBorder: "#90caf9",
    warningBg: "#fff3cd",
    warningText: "#8a6d3b",
    surfaceAlt: "#fafafa",
    border: "#ddd",
    textPrimary: "#111",
    label: "#333",
    inputBg: "#fff",
    placeholder: "#999",
    textMuted: "#777",
    severityBg: "#f5f5f5",
    severityBorder: "#ccc",
  }),
}));

import CreateIncidentScreen from "@/app/incident/create";

function flattenText(node: any): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (!node) return "";
  return flattenText(node.children ?? []);
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CreateIncidentScreen flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParamsMocks.params = { installationId: "45" };
    sessionMocks.checkingSession = false;
    sessionMocks.hasActiveSession = true;
    apiMocks.listInstallations.mockResolvedValue([
      { id: 45, client_name: "Cliente Demo", attention_state: "attention" },
    ]);
    apiMocks.getCurrentLinkedTechnicianContext.mockResolvedValue({
      user: { username: "web_user" },
      technician: { display_name: "Tecnico Uno", employee_code: "TEC-1" },
    });
    apiMocks.resolveAssetByExternalCode.mockResolvedValue({
      asset: { id: 88 },
    });
    apiMocks.linkAssetToInstallation.mockResolvedValue({ success: true });
    syncMocks.enqueueCreateIncident.mockResolvedValue({ localId: "incident-local-1" });
    serviceMocks.canReachConfiguredApi.mockResolvedValue(true);
    serviceMocks.captureCurrentGpsSnapshot.mockResolvedValue({
      status: "captured",
      source: "browser",
      lat: -34.9,
      lng: -56.1,
      accuracy_m: 12,
      captured_at: "2026-04-04T10:00:00.000Z",
      note: "",
    });
  });

  it("requires a GPS override note when capture is not usable", async () => {
    serviceMocks.captureCurrentGpsSnapshot.mockResolvedValue({
      status: "denied",
      source: "browser",
      note: "No se concedio permiso de ubicacion.",
    });

    let tree: any;
    await act(async () => {
      tree = create(<CreateIncidentScreen />);
    });
    await flushAsync();

    expect(
      tree.root.findAll((node: any) => flattenText(node).includes("Cliente Demo")).length,
    ).toBeGreaterThan(0);

    const noteInput = tree.root.find(
      (node: any) => node.props?.accessibilityLabel === "Nota de la incidencia",
    );
    const createButton = tree.root.find(
      (node: any) => node.props?.accessibilityLabel === "Crear incidencia",
    );

    await act(async () => {
      noteInput.props.onChangeText("GPS caido en la zona");
    });
    await act(async () => {
      createButton.props.onPress();
    });
    await flushAsync();

    expect(
      tree.root.findAll((node: any) => flattenText(node).match(/motivo de override/i)).length,
    ).toBeGreaterThan(0);

    expect(syncMocks.enqueueCreateIncident).not.toHaveBeenCalled();
    expect(serviceMocks.triggerWarningHaptic).toHaveBeenCalled();
    tree.unmount();
  });

  it("queues the incident, triggers sync and links the asset when online", async () => {
    routeParamsMocks.params = {
      installationId: "45",
      assetExternalCode: "EQ-9",
    };

    let tree: any;
    await act(async () => {
      tree = create(<CreateIncidentScreen />);
    });
    await flushAsync();

    expect(
      tree.root.findAll((node: any) => flattenText(node).includes("Cliente Demo")).length,
    ).toBeGreaterThan(0);
    expect(
      tree.root.findAll((node: any) => flattenText(node).includes("Tecnico Uno")).length,
    ).toBeGreaterThan(0);

    const noteInput = tree.root.find(
      (node: any) => node.props?.accessibilityLabel === "Nota de la incidencia",
    );
    const createButton = tree.root.find(
      (node: any) => node.props?.accessibilityLabel === "Crear incidencia",
    );

    await act(async () => {
      noteInput.props.onChangeText("Falla de encendido");
    });
    await act(async () => {
      createButton.props.onPress();
    });
    await flushAsync();

    expect(syncMocks.enqueueCreateIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 45,
        remoteInstallationId: 45,
        note: "Falla de encendido",
        reporterUsername: "Tecnico Uno",
        gps: expect.objectContaining({ status: "captured" }),
      }),
    );
    expect(syncMocks.runSync).toHaveBeenCalledTimes(1);
    expect(apiMocks.resolveAssetByExternalCode).toHaveBeenCalledWith("EQ-9");
    expect(apiMocks.linkAssetToInstallation).toHaveBeenCalledWith(
      88,
      45,
      expect.stringContaining("incident-local-1"),
    );
    expect(
      tree.root.findAll((node: any) => flattenText(node).match(/sincronizando con el servidor/i)).length,
    ).toBeGreaterThan(0);
    tree.unmount();
  });

  it("keeps the incident queued locally without forcing sync when offline", async () => {
    serviceMocks.canReachConfiguredApi.mockResolvedValue(false);

    let tree: any;
    await act(async () => {
      tree = create(<CreateIncidentScreen />);
    });
    await flushAsync();

    expect(
      tree.root.findAll((node: any) => flattenText(node).includes("Cliente Demo")).length,
    ).toBeGreaterThan(0);

    const noteInput = tree.root.find(
      (node: any) => node.props?.accessibilityLabel === "Nota de la incidencia",
    );
    const createButton = tree.root.find(
      (node: any) => node.props?.accessibilityLabel === "Crear incidencia",
    );

    await act(async () => {
      noteInput.props.onChangeText("Falla intermitente");
    });
    await act(async () => {
      createButton.props.onPress();
    });
    await flushAsync();

    expect(syncMocks.enqueueCreateIncident).toHaveBeenCalledTimes(1);
    expect(syncMocks.runSync).not.toHaveBeenCalled();
    expect(apiMocks.linkAssetToInstallation).not.toHaveBeenCalled();
    expect(
      tree.root.findAll((node: any) => flattenText(node).match(/pendiente de sincronizar/i)).length,
    ).toBeGreaterThan(0);
    tree.unmount();
  });
});
