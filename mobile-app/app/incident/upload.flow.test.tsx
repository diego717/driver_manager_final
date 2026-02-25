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

import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { uploadIncidentPhoto } from "@/src/api/photos";
import UploadIncidentPhotoScreen from "./upload";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("UploadIncidentPhotoScreen upload flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables and re-enables action buttons during image processing and upload", async () => {
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

    const processingDeferred = createDeferred<{ uri: string }>();
    vi.mocked(ImageManipulator.manipulateAsync).mockReturnValueOnce(processingDeferred.promise as any);

    const uploadDeferred = createDeferred<{ photo: { id: number } }>();
    vi.mocked(uploadIncidentPhoto).mockReturnValueOnce(uploadDeferred.promise as any);

    const view = render(<UploadIncidentPhotoScreen />);

    const galleryButton = view.getByLabelText("Seleccionar foto desde la galeria");
    const cameraButton = view.getByLabelText("Tomar foto con la camara");
    const uploadButton = view.getByLabelText("Subir foto de la incidencia");

    expect(galleryButton.props.disabled).toBe(false);
    expect(cameraButton.props.disabled).toBe(false);
    expect(uploadButton.props.disabled).toBe(false);

    fireEvent.press(galleryButton);

    await waitFor(() => {
      expect(view.getByLabelText("Seleccionar foto desde la galeria").props.disabled).toBe(true);
      expect(view.getByLabelText("Tomar foto con la camara").props.disabled).toBe(true);
      expect(view.getByLabelText("Subir foto de la incidencia").props.disabled).toBe(true);
    });

    processingDeferred.resolve({ uri: "file:///processed.jpg" });

    await waitFor(() => {
      expect(view.getByText("Archivo: picked.jpg")).toBeTruthy();
      expect(view.getByLabelText("Seleccionar foto desde la galeria").props.disabled).toBe(false);
      expect(view.getByLabelText("Tomar foto con la camara").props.disabled).toBe(false);
      expect(view.getByLabelText("Subir foto de la incidencia").props.disabled).toBe(false);
    });

    fireEvent.press(view.getByLabelText("Subir foto de la incidencia"));

    await waitFor(() => {
      expect(view.getByLabelText("Seleccionar foto desde la galeria").props.disabled).toBe(true);
      expect(view.getByLabelText("Tomar foto con la camara").props.disabled).toBe(true);
      expect(view.getByLabelText("Subir foto de la incidencia").props.disabled).toBe(true);
    });

    uploadDeferred.resolve({ photo: { id: 77 } });

    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalled();
      expect(view.getByLabelText("Seleccionar foto desde la galeria").props.disabled).toBe(false);
      expect(view.getByLabelText("Tomar foto con la camara").props.disabled).toBe(false);
      expect(view.getByLabelText("Subir foto de la incidencia").props.disabled).toBe(false);
      expect(view.getByText("Foto ID: 77")).toBeTruthy();
    });
  });
});
