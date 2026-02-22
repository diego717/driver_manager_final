import React from "react";
import Module from "node:module";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const incidentsApiMocks = vi.hoisted(() => ({
  createIncident: vi.fn(),
  createInstallationRecord: vi.fn(),
  listInstallations: vi.fn(),
}));

const secureStorageMocks = vi.hoisted(() => ({
  getStoredWebAccessUsername: vi.fn(async () => "usuario_web"),
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

function createReactNativeMock() {
  const ReactModule = require("react") as typeof React;
  return {
    ActivityIndicator: ({ children, ...props }: any) =>
      ReactModule.createElement("ActivityIndicator", props, children),
    Alert: { alert: vi.fn() },
    ScrollView: ({ children, ...props }: any) =>
      ReactModule.createElement("ScrollView", props, children),
    StyleSheet: {
      create: (styles: any) => styles,
      flatten: flattenStyle,
    },
    Text: ({ children, ...props }: any) => ReactModule.createElement("Text", props, children),
    TextInput: ({ children, ...props }: any) =>
      ReactModule.createElement("TextInput", props, children),
    TouchableOpacity: ({ children, ...props }: any) =>
      ReactModule.createElement("TouchableOpacity", props, children),
    View: ({ children, ...props }: any) => ReactModule.createElement("View", props, children),
  };
}

vi.mock("react-native", () => createReactNativeMock());

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

vi.mock("@react-navigation/native", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    React.useEffect(() => callback(), [callback]);
  },
}));

vi.mock("@/src/api/incidents", () => incidentsApiMocks);
vi.mock("@/src/storage/secure", () => secureStorageMocks);
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

import CreateIncidentScreen from "./index";

describe("CreateIncidentScreen accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    incidentsApiMocks.listInstallations.mockResolvedValue([
      { id: 17, client_name: "ACME Logistica" },
    ]);
  });

  it("exposes labels, roles, states and touch target sizes for critical controls", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    const view = render(<CreateIncidentScreen />);
    await waitFor(() => {
      expect(incidentsApiMocks.listInstallations).toHaveBeenCalled();
    });

    expect(view.getByLabelText("ID de instalacion para la incidencia")).toBeTruthy();
    expect(view.getByLabelText("Usuario reportante de la incidencia")).toBeTruthy();
    expect(view.getByLabelText("Nota de la incidencia")).toBeTruthy();
    expect(view.getByLabelText("Ajuste de tiempo en segundos")).toBeTruthy();

    const toggleManual = view.getByLabelText("Mostrar formulario de registro manual");
    expect(toggleManual.props.accessibilityRole).toBe("button");
    expect(toggleManual.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false, busy: false, expanded: false }),
    );
    expect(flattenStyle(toggleManual.props.style).minHeight).toBeGreaterThanOrEqual(44);

    const refreshButton = view.getByLabelText("Refrescar lista de instalaciones");
    expect(refreshButton.props.accessibilityRole).toBe("button");
    expect(refreshButton.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false, busy: false }),
    );
    expect(flattenStyle(refreshButton.props.style).minHeight).toBeGreaterThanOrEqual(44);

    const mediumSeverity = view.getByLabelText("Seleccionar severidad Media");
    expect(mediumSeverity.props.accessibilityRole).toBe("button");
    expect(mediumSeverity.props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );

    const submitButton = view.getByLabelText("Crear incidencia");
    expect(submitButton.props.accessibilityRole).toBe("button");
    expect(submitButton.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false, busy: false }),
    );
    expect(flattenStyle(submitButton.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it("keeps a logical focus order for top-level actions", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    const view = render(<CreateIncidentScreen />);
    await waitFor(() => {
      expect(incidentsApiMocks.listInstallations).toHaveBeenCalled();
    });

    const labels = view
      .UNSAFE_getAllByType("TouchableOpacity")
      .map((node) => node.props.accessibilityLabel)
      .filter(Boolean);

    expect(labels.indexOf("Mostrar formulario de registro manual")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Refrescar lista de instalaciones")).toBeGreaterThan(
      labels.indexOf("Mostrar formulario de registro manual"),
    );
    expect(labels.indexOf("Crear incidencia")).toBeGreaterThan(
      labels.indexOf("Refrescar lista de instalaciones"),
    );
  });
});
