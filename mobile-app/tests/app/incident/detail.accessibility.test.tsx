import React from "react";
import Module from "node:module";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
}));

const incidentsApiMocks = vi.hoisted(() => ({
  getIncidentById: vi.fn(),
  getLastIncidentDetailSource: vi.fn(() => "network"),
  updateIncidentStatus: vi.fn(),
  deleteIncident: vi.fn(),
}));

const photosApiMocks = vi.hoisted(() => ({
  resolveIncidentPhotoPreviewTarget: vi.fn(),
  fetchIncidentPhotoDataUri: vi.fn(),
}));
const techniciansApiMocks = vi.hoisted(() => ({
  getCurrentLinkedTechnicianContext: vi.fn(async () => ({ technician: null })),
  getTechnicianAssignmentsByEntity: vi.fn(async () => []),
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
      sequence: (
        animations: Array<{ start?: (callback?: (result: { finished: boolean }) => void) => void }>,
      ) => ({
        start: (callback?: (result: { finished: boolean }) => void) => {
          animations.forEach((animation) => animation?.start?.());
          callback?.({ finished: true });
        },
        stop: vi.fn(),
      }),
      loop: (animation: { start?: (callback?: (result: { finished: boolean }) => void) => void }) => ({
        start: (callback?: (result: { finished: boolean }) => void) => {
          animation?.start?.();
          callback?.({ finished: true });
        },
        stop: vi.fn(),
      }),
      View: AnimatedView,
    },
    Easing: {
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      linear: (value: number) => value,
      quad: vi.fn(),
      cubic: vi.fn(),
    },
    FlatList,
    Image: ({ children, ...props }: any) => ReactModule.createElement("Image", props, children),
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
    Platform: { OS: "ios", select: (obj: any) => obj.ios ?? obj.default },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
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
vi.mock("@/src/api/technicians", () => techniciansApiMocks);
vi.mock("@/src/api/client", () => ({
  extractApiError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
vi.mock("@/src/services/sync/photo-outbox-service", () => ({
  registerPhotoExecutors: vi.fn(),
}));
vi.mock("@/src/services/sync/incident-evidence-outbox-service", () => ({
  registerIncidentEvidenceExecutors: vi.fn(),
}));
vi.mock("@/src/services/sync/case-outbox-service", () => ({
  registerCaseExecutors: vi.fn(),
}));
vi.mock("@/src/services/sync/incident-outbox-service", () => ({
  registerIncidentExecutors: vi.fn(),
}));
vi.mock("@/src/services/sync/sync-runner", () => ({
  runSync: vi.fn(),
}));

vi.mock("expo-modules-core", () => ({
  EventEmitter: class EventEmitter {
    addListener() { return { remove: () => {} }; }
    removeAllListeners() {}
    emit() {}
  },
  Platform: { OS: "ios", select: (obj: any) => obj.ios ?? obj.default },
  requireNativeModule: () => ({}),
}));

vi.mock("@/src/theme/theme-preference", () => ({
  useThemePreference: () => ({
    mode: "light",
    resolvedScheme: "light",
    loading: false,
    setMode: async () => undefined,
  }),
}));

import IncidentDetailScreen from "@/app/incident/detail";

describe("IncidentDetailScreen accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    incidentsApiMocks.updateIncidentStatus.mockResolvedValue({
      success: true,
      incident: null,
    });
    incidentsApiMocks.deleteIncident.mockResolvedValue({
      success: true,
    });
    photosApiMocks.resolveIncidentPhotoPreviewTarget.mockResolvedValue({
      uri: "https://example.com/photo.jpg",
      headers: {},
    });
    photosApiMocks.fetchIncidentPhotoDataUri.mockResolvedValue(
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD",
    );
  });

  it("exposes loading state for refresh button and interactive labels for actions", async () => {
    const { fireEvent, render, waitFor } = await import("@testing-library/react-native/pure");
    const deferredList = createDeferred<any>();
    incidentsApiMocks.getIncidentById.mockImplementationOnce(
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
    fireEvent.press(openPhoto);
    expect(routerMocks.push).toHaveBeenCalledWith(
      expect.stringContaining("/incident/photo-viewer?photoId=5"),
    );
    expect(routerMocks.push).toHaveBeenCalledWith(expect.stringContaining("initialIndex=0"));
    expect(routerMocks.push).toHaveBeenCalledWith(expect.stringContaining("photoIds=5"));

    const addEvidence = view.getByLabelText("Adjuntar evidencia fotografica");
    expect(addEvidence.props.accessibilityRole).toBe("button");
    expect(flattenStyle(addEvidence.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it("keeps main action focus order from top controls to primary CTA", async () => {
    const { render, waitFor } = await import("@testing-library/react-native/pure");
    incidentsApiMocks.getIncidentById.mockResolvedValueOnce({
      id: 50,
      installation_id: 7,
      reporter_username: "tester",
      note: "Fallo de prueba",
      time_adjustment_seconds: 20,
      severity: "high",
      source: "mobile",
      created_at: "2026-02-20T10:00:00.000Z",
      photos: [],
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

  it("supports horizontal photo rendering and reveals the rest after swipe", async () => {
    const { fireEvent, render, waitFor } = await import("@testing-library/react-native/pure");
    incidentsApiMocks.getIncidentById.mockResolvedValueOnce({
      id: 50,
      installation_id: 7,
      reporter_username: "tester",
      note: "Fallo de prueba",
      time_adjustment_seconds: 20,
      severity: "high",
      source: "mobile",
      created_at: "2026-02-20T10:00:00.000Z",
      photos: Array.from({ length: 5 }, (_, index) => ({
        id: index + 1,
        incident_id: 50,
        r2_key: `a/${index + 1}.jpg`,
        file_name: `captura-${index + 1}.jpg`,
        content_type: "image/jpeg",
        size_bytes: 340000,
        sha256: null,
        created_at: "2026-02-20T10:01:00.000Z",
      })),
    });

    const view = render(<IncidentDetailScreen />);
    await waitFor(() => {
      expect(view.getByTestId("incident-photos-list")).toBeTruthy();
    });

    const photosList = view.getByTestId("incident-photos-list");
    expect(photosList.props.initialNumToRender).toBe(2);
    expect(photosList.props.windowSize).toBe(3);
    expect(photosList.props.removeClippedSubviews).toBe(true);
    expect(photosList.props.horizontal).toBe(true);
    expect(view.queryByText("#4 - captura-4.jpg")).toBeNull();

    fireEvent.scroll(photosList, {
      nativeEvent: {
        contentOffset: { x: 400, y: 0 },
        layoutMeasurement: { width: 320, height: 400 },
        contentSize: { width: 1200, height: 320 },
      },
    });

    expect(view.getByText("captura-4.jpg")).toBeTruthy();
  });
});
