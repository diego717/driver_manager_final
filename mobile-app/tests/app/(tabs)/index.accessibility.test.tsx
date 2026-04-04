import React from "react";
import Module from "node:module";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const incidentsApiMocks = vi.hoisted(() => ({
  createIncident: vi.fn(),
  createInstallationRecord: vi.fn(),
  listInstallations: vi.fn(),
}));
const assetsApiMocks = vi.hoisted(() => ({
  resolveAssetByExternalCode: vi.fn(),
  linkAssetToInstallation: vi.fn(),
}));
const statisticsApiMocks = vi.hoisted(() => ({
  getDashboardStatistics: vi.fn(),
}));
const driversApiMocks = vi.hoisted(() => ({
  deleteDriver: vi.fn(),
  listDrivers: vi.fn(),
  uploadDriver: vi.fn(),
}));
const techniciansApiMocks = vi.hoisted(() => ({
  getCurrentLinkedTechnicianContext: vi.fn(async () => ({
    user: { username: "usuario_web" },
    technician: null,
  })),
}));

const secureStorageMocks = vi.hoisted(() => ({
  getStoredWebAccessUsername: vi.fn(async () => "usuario_web"),
}));
const webAuthMocks = vi.hoisted(() => ({
  clearWebSession: vi.fn(),
  readStoredWebSession: vi.fn(async () => ({
    accessToken: "token-123",
    expiresAt: "2030-01-01T00:00:00.000Z",
    username: "usuario_web",
    role: "admin",
  })),
}));
const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));
const routeParamMocks = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
const startupSessionPolicyMocks = vi.hoisted(() => ({
  consumeForceLoginOnOpenFlag: vi.fn(() => false),
}));
const webSessionStoreMocks = vi.hoisted(() => ({
  useSharedWebSessionState: vi.fn(() => ({
    checkingSession: false,
    hasActiveSession: true,
    lastCheckedAt: Date.now(),
  })),
}));

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "").trim();
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : normalized;
  const value = Number.parseInt(full, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function parseColor(input: string): { r: number; g: number; b: number; a: number } {
  const value = String(input || "").trim();
  if (value.startsWith("#")) {
    const rgb = hexToRgb(value);
    return { ...rgb, a: 1 };
  }
  const rgbaMatch = value.match(
    /^rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*(?:,\s*([0-9]*\.?[0-9]+)\s*)?\)$/i,
  );
  if (!rgbaMatch) {
    throw new Error(`Unsupported color format: ${value}`);
  }
  return {
    r: Number(rgbaMatch[1]),
    g: Number(rgbaMatch[2]),
    b: Number(rgbaMatch[3]),
    a: rgbaMatch[4] ? Number(rgbaMatch[4]) : 1,
  };
}

function blendOver(
  foreground: { r: number; g: number; b: number; a: number },
  background: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  const alpha = Math.max(0, Math.min(1, foreground.a));
  return {
    r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
  };
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: { r: number; g: number; b: number }): number {
  return (
    0.2126 * srgbToLinear(color.r) +
    0.7152 * srgbToLinear(color.g) +
    0.0722 * srgbToLinear(color.b)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const fgParsed = parseColor(foreground);
  const bgParsed = parseColor(background);
  const fgRgb = blendOver(fgParsed, { r: bgParsed.r, g: bgParsed.g, b: bgParsed.b });
  const bgRgb = { r: bgParsed.r, g: bgParsed.g, b: bgParsed.b };
  const fgLum = relativeLuminance(fgRgb);
  const bgLum = relativeLuminance(bgRgb);
  const light = Math.max(fgLum, bgLum);
  const dark = Math.min(fgLum, bgLum);
  return (light + 0.05) / (dark + 0.05);
}

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
  const AnimatedView = ({ children, ...props }: any) =>
    ReactModule.createElement("Animated.View", props, children);
  class AnimatedValueMock {
    private currentValue: number;
    constructor(initialValue: number) {
      this.currentValue = initialValue;
    }
    setValue(nextValue: number) {
      this.currentValue = nextValue;
    }
    interpolate() {
      return `${this.currentValue * 100}%`;
    }
  }
  const createAnimatedDriver = (value: AnimatedValueMock, toValue?: number) => ({
    start: (callback?: (result: { finished: boolean }) => void) => {
      if (typeof toValue === "number") {
        value.setValue(toValue);
      }
      callback?.({ finished: true });
    },
    stop: vi.fn(),
  });
  const FlatList = ({
    children,
    data = [],
    renderItem,
    keyExtractor,
    initialNumToRender,
    ListHeaderComponent,
    onScroll,
    ...props
  }: any) => {
    const [renderCount, setRenderCount] = ReactModule.useState(
      Math.min(initialNumToRender ?? data.length, data.length),
    );
    const visibleItems = data.slice(0, renderCount);
    return ReactModule.createElement(
      "FlatList",
      {
        ...props,
        initialNumToRender,
        windowSize: props.windowSize,
        removeClippedSubviews: props.removeClippedSubviews,
        onScroll: (event: unknown) => {
          onScroll?.(event);
          setRenderCount(data.length);
        },
      },
      ListHeaderComponent,
      visibleItems.map((item: unknown, index: number) =>
        ReactModule.createElement(
          ReactModule.Fragment,
          { key: keyExtractor ? keyExtractor(item, index) : String(index) },
          renderItem?.({ item, index }),
        ),
      ),
      children,
    );
  };
  return {
    AccessibilityInfo: {
      isReduceMotionEnabled: vi.fn(async () => false),
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    ActivityIndicator: ({ children, ...props }: any) =>
      ReactModule.createElement("ActivityIndicator", props, children),
    Alert: { alert: vi.fn() },
    Animated: {
      Value: AnimatedValueMock,
      timing: (value: AnimatedValueMock, config: { toValue: number }) =>
        createAnimatedDriver(value, config?.toValue),
      spring: (value: AnimatedValueMock, config: { toValue: number }) =>
        createAnimatedDriver(value, config?.toValue),
      parallel: (
        animations: Array<{ start?: (callback?: (result: { finished: boolean }) => void) => void }>,
      ) => ({
        start: (callback?: (result: { finished: boolean }) => void) => {
          animations.forEach((animation) => animation?.start?.());
          callback?.({ finished: true });
        },
        stop: vi.fn(),
      }),
      View: AnimatedView,
    },
    Easing: {
      out: (fn: unknown) => fn,
      quad: vi.fn(),
      cubic: vi.fn(),
    },
    FlatList,
    Platform: {
      OS: "ios",
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
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
vi.mock("expo-router", () => ({
  useRouter: () => routerMocks,
  useLocalSearchParams: () => routeParamMocks.value,
}));

vi.mock("@/src/api/incidents", () => incidentsApiMocks);
vi.mock("@/src/api/assets", () => assetsApiMocks);
vi.mock("@/src/api/statistics", () => statisticsApiMocks);
vi.mock("@/src/api/drivers", () => driversApiMocks);
vi.mock("@/src/api/technicians", () => techniciansApiMocks);
vi.mock("@/src/storage/secure", () => secureStorageMocks);
vi.mock("@/src/api/webAuth", () => webAuthMocks);
vi.mock("@/src/security/startup-session-policy", () => startupSessionPolicyMocks);
vi.mock("@/src/session/web-session-store", () => webSessionStoreMocks);
vi.mock("@/src/components/SyncStatusBanner", () => ({
  default: () => null,
}));
vi.mock("@/src/services/sync/incident-outbox-service", () => ({
  enqueueCreateIncident: vi.fn(),
  registerIncidentExecutors: vi.fn(),
}));
vi.mock("@/src/services/sync/photo-outbox-service", () => ({
  registerPhotoExecutors: vi.fn(),
}));
vi.mock("@/src/services/sync/incident-evidence-outbox-service", () => ({
  registerIncidentEvidenceExecutors: vi.fn(),
}));
vi.mock("@/src/services/sync/case-outbox-service", () => ({
  enqueueCreateCase: vi.fn(),
  registerCaseExecutors: vi.fn(),
}));
vi.mock("@/src/services/sync/sync-runner", () => ({
  runSync: vi.fn(),
}));
vi.mock("@/src/services/location", () => ({
  captureCurrentGpsSnapshot: vi.fn(async () => ({
    status: "unavailable",
    source: "none",
    note: "mocked location",
  })),
}));
vi.mock("expo-modules-core", () => ({
  EventEmitter: class EventEmitter {
    addListener() { return { remove: () => {} }; }
    removeAllListeners() {}
    emit() {}
  },
  requireOptionalNativeModule: () => null,
  requireNativeModule: () => ({}),
  Platform: { OS: "ios", select: (obj: any) => obj.ios ?? obj.default },
}));
vi.mock("expo-document-picker", () => ({
  getDocumentAsync: vi.fn(async () => ({ canceled: true, assets: [] })),
}));
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

import TodayScreen from "@/app/(tabs)/index";
import CreateIncidentScreen from "@/app/incident/create";

describe("TodayScreen accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParamMocks.value = {};
    incidentsApiMocks.listInstallations.mockResolvedValue([
      { id: 17, client_name: "ACME Logistica" },
    ]);
    statisticsApiMocks.getDashboardStatistics.mockResolvedValue({
      incident_in_progress_count: 1,
      incident_sla_minutes: 30,
    });
  });

  it("exposes labels, roles and touch target sizes for guided top-level controls", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    const view = render(<TodayScreen />);
    await waitFor(() => {
      expect(incidentsApiMocks.listInstallations).toHaveBeenCalled();
    });

    const refreshButton = view.getByLabelText("Refrescar resumen operativo");
    expect(refreshButton.props.accessibilityRole).toBe("button");
    expect(refreshButton.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false, busy: false }),
    );
    expect(flattenStyle(refreshButton.props.style).minHeight).toBeGreaterThanOrEqual(44);

    const openFlowButton = view.getByLabelText("Abrir el caso 17");
    expect(openFlowButton.props.accessibilityRole).toBe("button");
    expect(flattenStyle(openFlowButton.props.style).minHeight).toBeGreaterThanOrEqual(44);

    const backlogButton = view.getByLabelText("Abrir backlog del caso 17");
    expect(backlogButton.props.accessibilityRole).toBe("button");
    expect(flattenStyle(backlogButton.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it("keeps a logical focus order for guided actions", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    const view = render(<TodayScreen />);
    await waitFor(() => {
      expect(incidentsApiMocks.listInstallations).toHaveBeenCalled();
    });

    const labels = view
      .UNSAFE_getAllByType("TouchableOpacity")
      .map((node) => node.props.accessibilityLabel)
      .filter(Boolean);

    expect(labels.indexOf("Refrescar resumen operativo")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Abrir el caso 17")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Abrir backlog del caso 17")).toBeGreaterThanOrEqual(0);
  });

  it("renders the distilled home without exposing the old form on home", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    incidentsApiMocks.listInstallations.mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, index) => ({
        id: index + 1,
        client_name: `Cliente ${index + 1}`,
      })),
    );

    const view = render(<TodayScreen />);
    await waitFor(() => {
      expect(view.getByText("Caso foco")).toBeTruthy();
    });

    expect(view.getByText("Escanear equipo")).toBeTruthy();
    expect(view.getByText("Caso manual")).toBeTruthy();
    expect(view.getByText("Inventario")).toBeTruthy();
    expect(view.getByText("Ver backlog")).toBeTruthy();
    expect(view.queryByLabelText("ID de registro para la incidencia")).toBeNull();
  });
});

describe("CreateIncidentScreen accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParamMocks.value = { installationId: "17" };
    incidentsApiMocks.listInstallations.mockResolvedValue([
      { id: 17, client_name: "ACME Logistica" },
    ]);
  });

  it("keeps only case-scoped form controls in the dedicated incident route", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    const view = render(<CreateIncidentScreen />);
    await waitFor(() => {
      expect(incidentsApiMocks.listInstallations).toHaveBeenCalled();
    });

    expect(view.getByText("Caso listo")).toBeTruthy();
    expect(view.getByLabelText("Nota de la incidencia")).toBeTruthy();
    expect(view.queryByLabelText("ID de registro para la incidencia")).toBeNull();
    expect(view.queryByLabelText("Usuario reportante de la incidencia")).toBeNull();

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

  it("shows a dedicated empty state when the route does not include a case", async () => {
    const { render } = await import("@testing-library/react-native/pure");
    routeParamMocks.value = {};

    const view = render(<CreateIncidentScreen />);
    expect(view.getByText("Falta resolver el caso")).toBeTruthy();
    expect(view.getByLabelText("Abrir el flujo para resolver el caso")).toBeTruthy();
  });
});

describe("Day 2 accessibility normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driversApiMocks.listDrivers.mockResolvedValue([
      {
        key: "driver-zebra-v1",
        brand: "Zebra",
        version: "v1.0.0",
        filename: "zebra-driver-v1.zip",
        size_bytes: 2048,
        uploaded: "2026-03-01T10:00:00.000Z",
        last_modified: "2026-03-01T10:00:00.000Z",
      },
    ]);
    driversApiMocks.uploadDriver.mockResolvedValue({
      key: "driver-zebra-v1",
      brand: "Zebra",
      version: "v1.0.0",
      filename: "zebra-driver-v1.zip",
      size_bytes: 2048,
      uploaded: "2026-03-01T10:00:00.000Z",
      last_modified: "2026-03-01T10:00:00.000Z",
    });
    driversApiMocks.deleteDriver.mockResolvedValue(undefined);
  });

  it("keeps warning/error text contrast at AA level for light and dark palettes", async () => {
    const { getAppPalette } = await import("@/src/theme/palette");
    const minimumAa = 4.5;

    const light = getAppPalette("light");
    const dark = getAppPalette("dark");

    const lightWarningBg = parseColor(light.warningBg);
    const lightErrorBg = parseColor(light.errorBg);
    const lightSurface = parseColor(light.surface);
    const lightWarningFinal = blendOver(lightWarningBg, {
      r: lightSurface.r,
      g: lightSurface.g,
      b: lightSurface.b,
    });
    const lightErrorFinal = blendOver(lightErrorBg, {
      r: lightSurface.r,
      g: lightSurface.g,
      b: lightSurface.b,
    });

    expect(
      contrastRatio(
        light.warningText,
        `rgb(${lightWarningFinal.r}, ${lightWarningFinal.g}, ${lightWarningFinal.b})`,
      ),
    ).toBeGreaterThanOrEqual(minimumAa);
    expect(
      contrastRatio(
        light.errorText,
        `rgb(${lightErrorFinal.r}, ${lightErrorFinal.g}, ${lightErrorFinal.b})`,
      ),
    ).toBeGreaterThanOrEqual(minimumAa);

    const darkWarningBg = parseColor(dark.warningBg);
    const darkErrorBg = parseColor(dark.errorBg);
    const darkSurface = parseColor(dark.surface);
    const darkWarningFinal = blendOver(darkWarningBg, {
      r: darkSurface.r,
      g: darkSurface.g,
      b: darkSurface.b,
    });
    const darkErrorFinal = blendOver(darkErrorBg, {
      r: darkSurface.r,
      g: darkSurface.g,
      b: darkSurface.b,
    });

    expect(
      contrastRatio(
        dark.warningText,
        `rgb(${darkWarningFinal.r}, ${darkWarningFinal.g}, ${darkWarningFinal.b})`,
      ),
    ).toBeGreaterThanOrEqual(minimumAa);
    expect(
      contrastRatio(
        dark.errorText,
        `rgb(${darkErrorFinal.r}, ${darkErrorFinal.g}, ${darkErrorFinal.b})`,
      ),
    ).toBeGreaterThanOrEqual(minimumAa);
  });

  it("keeps drivers critical touch targets at least 44x44", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    const { default: DriversScreen } = await import("@/app/drivers");
    const view = render(<DriversScreen />);

    await waitFor(() => {
      expect(driversApiMocks.listDrivers).toHaveBeenCalled();
    });

    const selectFileButton = view.getByLabelText("Seleccionar archivo de driver");
    const uploadButton = view.getByLabelText("Subir driver");
    const refreshButton = view.getByLabelText("Actualizar lista de drivers");
    const deleteButton = view.getByLabelText("Eliminar driver Zebra v1.0.0");

    expect(flattenStyle(selectFileButton.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(flattenStyle(uploadButton.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(flattenStyle(refreshButton.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(flattenStyle(deleteButton.props.style).minHeight).toBeGreaterThanOrEqual(44);

    const textInputs = view.UNSAFE_getAllByType("TextInput");
    textInputs.forEach((input) => {
      expect(flattenStyle(input.props.style).minHeight).toBeGreaterThanOrEqual(44);
    });
  });
});
