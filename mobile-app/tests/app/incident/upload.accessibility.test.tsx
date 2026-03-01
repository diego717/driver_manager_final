import React from "react";
import Module from "node:module";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
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

vi.mock("react-native", () => {
  return createReactNativeMock();
});

vi.mock("expo-router", () => {
  const Stack = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  Stack.Screen = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Stack,
    useLocalSearchParams: () => ({ incidentId: "25", installationId: "7" }),
    useRouter: () => routerMocks,
  };
});

vi.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  requestCameraPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
}));
vi.mock("expo-image-manipulator", () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ size: 2048 })),
}));
vi.mock("@/src/api/photos", () => ({
  uploadIncidentPhoto: vi.fn(),
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

import UploadIncidentPhotoScreen from "@/app/incident/upload";

describe("UploadIncidentPhotoScreen accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders wizard steps and exposes photo controls on step 3", async () => {
    const { fireEvent, render } = await import("@testing-library/react-native/pure");
    const view = render(<UploadIncidentPhotoScreen />);

    expect(view.getByText("Paso 1 de 4: Checklist")).toBeTruthy();
    expect(view.getByLabelText("ID de incidencia para subir evidencia")).toBeTruthy();

    const nextButtonStep1 = view.getByText("Siguiente");
    fireEvent.press(nextButtonStep1.parent);
    expect(view.getByText("Paso 2 de 4: Nota")).toBeTruthy();

    const nextButtonStep2 = view.getByText("Siguiente");
    fireEvent.press(nextButtonStep2.parent);
    expect(view.getByText("Paso 3 de 4: Fotos")).toBeTruthy();

    const galleryButton = view.getByLabelText("Seleccionar foto desde la galeria");
    expect(galleryButton.props.accessibilityRole).toBe("button");
    expect(flattenStyle(galleryButton.props.style).minHeight).toBeGreaterThanOrEqual(44);

    const cameraButton = view.getByLabelText("Tomar foto con la camara");
    expect(cameraButton.props.accessibilityRole).toBe("button");
    expect(flattenStyle(cameraButton.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it("keeps logical step progression from checklist to note and photos", async () => {
    const { fireEvent, render } = await import("@testing-library/react-native/pure");
    const view = render(<UploadIncidentPhotoScreen />);

    expect(view.getByText("Paso 1 de 4: Checklist")).toBeTruthy();
    fireEvent.press(view.getByText("Siguiente").parent);
    expect(view.getByText("Paso 2 de 4: Nota")).toBeTruthy();
    fireEvent.press(view.getByText("Siguiente").parent);
    expect(view.getByText("Paso 3 de 4: Fotos")).toBeTruthy();
  });
});
