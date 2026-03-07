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
  signedJsonRequest: vi.fn(async () => ({})),
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

import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { uploadIncidentPhoto } from "@/src/api/photos";
import UploadIncidentPhotoScreen from "@/app/incident/upload";

describe("UploadIncidentPhotoScreen upload flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes wizard flow and uploads confirmed evidence", async () => {
    const { fireEvent, render, waitFor } = await import("@testing-library/react-native/pure");

    vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({
      granted: true,
    } as any);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///picked.jpg",
          fileName: "picked.jpg",
          width: 800,
          height: 600,
        },
      ],
    } as any);

    vi.mocked(ImageManipulator.manipulateAsync).mockResolvedValue({ uri: "file:///processed.jpg" } as any);
    vi.mocked(uploadIncidentPhoto).mockResolvedValue({ photo: { id: 77 } } as any);

    const view = render(<UploadIncidentPhotoScreen />);
    fireEvent.press(view.getByText("Siguiente").parent);
    fireEvent.press(view.getByText("Siguiente").parent);
    expect(view.getByText("Paso 3 de 4: Fotos")).toBeTruthy();

    const galleryButton = view.getByLabelText("Seleccionar foto desde la galeria");
    fireEvent.press(galleryButton);

    await waitFor(() => {
      expect(view.getByText("Archivo: picked.jpg")).toBeTruthy();
    });
    fireEvent.press(view.getByText("Confirmar").parent);
    expect(view.getByText(/Captured:/)).toBeTruthy();

    fireEvent.press(view.getByText("Siguiente").parent);
    expect(view.getByText("Paso 4 de 4: Confirmacion")).toBeTruthy();
    fireEvent.press(view.getByLabelText("Confirmar y guardar evidencia"));

    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalled();
      expect(uploadIncidentPhoto).toHaveBeenCalledTimes(1);
      expect(view.getByText("Evidencias guardadas")).toBeTruthy();
    });
  });
});
