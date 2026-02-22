import React from "react";
import Module from "node:module";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
}));

const incidentsApiMocks = vi.hoisted(() => ({
  listIncidentsByInstallation: vi.fn(),
}));

const photosApiMocks = vi.hoisted(() => ({
  resolveIncidentPhotoPreviewTarget: vi.fn(),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, item) => ({ ...acc, ...flattenStyle(item) }),
      {},
    );
  }
  if (style && typeof style === "object") {
    return style as Record<string, unknown>;
  }
  return {};
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createReactNativeMock() {
  const ReactModule = require("react") as typeof React;
  return {
    ActivityIndicator: ({ children, ...props }: any) =>
      ReactModule.createElement("ActivityIndicator", props, children),
    Alert: { alert: vi.fn() },
    Image: ({ children, ...props }: any) => ReactModule.createElement("Image", props, children),
    ScrollView: ({ children, ...props }: any) =>
      ReactModule.createElement("ScrollView", props, children),
    StyleSheet: {
      create: (styles: any) => styles,
      flatten: flattenStyle,
    },
    Text: ({ children, ...props }: any) => ReactModule.createElement("Text", props, children),
    TouchableOpacity: ({ children, ...props }: any) =>
      ReactModule.createElement("TouchableOpacity", props, children),
    View: ({ children, ...props }: any) => ReactModule.createElement("View", props, children),
  };
}

const originalModuleLoad = (Module as any)._load as (...args: any[]) => unknown;
(Module as any)._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === "react-native") {
    return createReactNativeMock();
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

afterAll(() => {
  (Module as any)._load = originalModuleLoad;
});

vi.mock("react-native", () => createReactNativeMock());

vi.mock("expo-router", () => {
  const Stack = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  Stack.Screen = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Stack,
    useLocalSearchParams: () => ({ incidentId: "50", installationId: "7" }),
    useRouter: () => routerMocks,
  };
});

vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    React.useEffect(() => callback(), [callback]);
  },
}));

vi.mock("@/src/api/incidents", () => incidentsApiMocks);
vi.mock("@/src/api/photos", () => photosApiMocks);
vi.mock("@/src/api/client", () => ({
  extractApiError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
vi.mock("@/src/theme/theme-preference", () => ({
  useThemePreference: () => ({
    mode: "light",
    resolvedScheme: "light",
    loading: false,
    setMode: async () => undefined,
  }),
}));

import IncidentDetailScreen from "./detail";

describe("IncidentDetailScreen accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    photosApiMocks.resolveIncidentPhotoPreviewTarget.mockResolvedValue({
      uri: "https://example.com/photo.jpg",
      headers: {},
    });
  });

  it("exposes loading state for refresh button and interactive labels for actions", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    const deferredList = createDeferred({
      success: true,
      installation_id: 7,
      incidents: [
        {
          id: 50,
          installation_id: 7,
          reporter_username: "tester",
          note: "Fallo de prueba",
          time_adjustment_seconds: 20,
          severity: "high",
          source: "mobile",
          created_at: "2026-02-20T10:00:00.000Z",
          photos: [
            {
              id: 5,
              incident_id: 50,
              r2_key: "a/b.jpg",
              file_name: "captura.jpg",
              content_type: "image/jpeg",
              size_bytes: 340000,
              sha256: null,
              created_at: "2026-02-20T10:01:00.000Z",
            },
          ],
        },
      ],
    });
    incidentsApiMocks.listIncidentsByInstallation.mockImplementationOnce(
      () => deferredList.promise,
    );

    const view = render(<IncidentDetailScreen />);

    const refreshButton = view.getByLabelText("Refrescar datos de la incidencia");
    expect(refreshButton.props.accessibilityRole).toBe("button");
    expect(refreshButton.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true, busy: true }),
    );
    expect(flattenStyle(refreshButton.props.style).minHeight).toBeGreaterThanOrEqual(44);

    deferredList.resolve({
      success: true,
      installation_id: 7,
      incidents: [
        {
          id: 50,
          installation_id: 7,
          reporter_username: "tester",
          note: "Fallo de prueba",
          time_adjustment_seconds: 20,
          severity: "high",
          source: "mobile",
          created_at: "2026-02-20T10:00:00.000Z",
          photos: [
            {
              id: 5,
              incident_id: 50,
              r2_key: "a/b.jpg",
              file_name: "captura.jpg",
              content_type: "image/jpeg",
              size_bytes: 340000,
              sha256: null,
              created_at: "2026-02-20T10:01:00.000Z",
            },
          ],
        },
      ],
    });

    await waitFor(() => {
      expect(view.getByText("Adjuntar evidencia")).toBeTruthy();
    });

    const refreshReady = view.getByLabelText("Refrescar datos de la incidencia");
    expect(refreshReady.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false, busy: false }),
    );

    const backButton = view.getByLabelText("Volver a la pantalla anterior");
    expect(backButton.props.accessibilityRole).toBe("button");
    expect(flattenStyle(backButton.props.style).minHeight).toBeGreaterThanOrEqual(44);

    await waitFor(() => {
      expect(view.getByLabelText("Abrir vista completa de la foto 5")).toBeTruthy();
    });
    const openPhoto = view.getByLabelText("Abrir vista completa de la foto 5");
    expect(openPhoto.props.accessibilityRole).toBe("imagebutton");
    expect(openPhoto).toBeTruthy();

    const addEvidence = view.getByLabelText("Adjuntar evidencia fotografica");
    expect(addEvidence.props.accessibilityRole).toBe("button");
    expect(flattenStyle(addEvidence.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it("keeps main action focus order from top controls to primary CTA", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    incidentsApiMocks.listIncidentsByInstallation.mockResolvedValueOnce({
      success: true,
      installation_id: 7,
      incidents: [
        {
          id: 50,
          installation_id: 7,
          reporter_username: "tester",
          note: "Fallo de prueba",
          time_adjustment_seconds: 20,
          severity: "high",
          source: "mobile",
          created_at: "2026-02-20T10:00:00.000Z",
          photos: [],
        },
      ],
    });

    const view = render(<IncidentDetailScreen />);
    await waitFor(() => {
      expect(view.getByLabelText("Adjuntar evidencia fotografica")).toBeTruthy();
    });

    const labels = view
      .UNSAFE_getAllByType("TouchableOpacity")
      .map((node) => node.props.accessibilityLabel)
      .filter(Boolean);

    expect(labels.indexOf("Refrescar datos de la incidencia")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Volver a la pantalla anterior")).toBeGreaterThan(
      labels.indexOf("Refrescar datos de la incidencia"),
    );
    expect(labels.indexOf("Adjuntar evidencia fotografica")).toBeGreaterThan(
      labels.indexOf("Volver a la pantalla anterior"),
    );
  });
});
