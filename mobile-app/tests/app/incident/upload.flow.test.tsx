import React from "react";
import Module from "node:module";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));
const routeParamsMocks = vi.hoisted(() => ({
  params: {
    incidentId: "25",
    installationId: "7",
  } as Record<string, string>,
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
      timing: (value: AnimatedValueMock, config: { toValue: number }) => ({
        start: (callback?: (result: { finished: boolean }) => void) => {
          value.setValue(config.toValue);
          callback?.({ finished: true });
        },
      }),
      parallel: (animations: Array<{ start?: (callback?: (result: { finished: boolean }) => void) => void }>) => ({
        start: (callback?: (result: { finished: boolean }) => void) => {
          animations.forEach((animation) => animation?.start?.());
          callback?.({ finished: true });
        },
      }),
      sequence: (animations: Array<{ start?: (callback?: (result: { finished: boolean }) => void) => void }>) => ({
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
      bezier: vi.fn(() => (value: number) => value),
      inOut: (fn: unknown) => fn,
      out: (fn: unknown) => fn,
      linear: (value: number) => value,
      quad: vi.fn(),
      cubic: vi.fn(),
    },
    Image: ({ children, ...props }: any) => ReactModule.createElement("Image", props, children),
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

vi.mock("react-native", () => {
  return createReactNativeMock();
});

vi.mock("expo-router", () => {
  const Stack = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  Stack.Screen = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Stack,
    useLocalSearchParams: () => routeParamsMocks.params,
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
vi.mock("@/src/api/incidents", () => ({
  updateIncidentEvidence: vi.fn(async () => ({})),
}));
const syncQueueMocks = vi.hoisted(() => ({
  enqueueUploadIncidentPhoto: vi.fn(async () => ({ localId: "photo-1", jobId: "job-photo-1" })),
  enqueueUpdateIncidentEvidence: vi.fn(async () => ({ localId: "evidence-1", jobId: "job-evidence-1" })),
  runSync: vi.fn(),
}));
const connectivityMocks = vi.hoisted(() => ({
  canReachConfiguredApi: vi.fn(async () => true),
}));
vi.mock("@/src/services/sync/photo-outbox-service", () => ({
  enqueueUploadIncidentPhoto: syncQueueMocks.enqueueUploadIncidentPhoto,
}));
vi.mock("@/src/services/sync/incident-evidence-outbox-service", () => ({
  enqueueUpdateIncidentEvidence: syncQueueMocks.enqueueUpdateIncidentEvidence,
}));
vi.mock("@/src/services/network/api-connectivity", () => connectivityMocks);
vi.mock("@/src/services/sync/sync-runner", () => ({
  runSync: syncQueueMocks.runSync,
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
import { updateIncidentEvidence } from "@/src/api/incidents";
import UploadIncidentPhotoScreen from "@/app/incident/upload";

describe("UploadIncidentPhotoScreen upload flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectivityMocks.canReachConfiguredApi.mockResolvedValue(true);
    routeParamsMocks.params = {
      incidentId: "25",
      installationId: "7",
    };
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
    vi.mocked(updateIncidentEvidence).mockResolvedValue({} as any);

    const view = render(<UploadIncidentPhotoScreen />);
    fireEvent.press(view.getByText("Siguiente").parent);
    fireEvent.changeText(
      view.getByLabelText("Nota operativa de la evidencia"),
      "Checklist y foto capturados en sitio",
    );
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
      expect(updateIncidentEvidence).toHaveBeenCalledWith(25, {
        checklist_items: [],
        evidence_note: "Checklist y foto capturados en sitio",
      });
      expect(uploadIncidentPhoto).toHaveBeenCalledTimes(1);
      expect(syncQueueMocks.enqueueUpdateIncidentEvidence).not.toHaveBeenCalled();
      expect(syncQueueMocks.enqueueUploadIncidentPhoto).not.toHaveBeenCalled();
      expect(syncQueueMocks.runSync).not.toHaveBeenCalled();
      expect(view.getByText("Evidencias guardadas")).toBeTruthy();
    });
  });

  it("keeps the evidence queued locally without forcing sync when offline", async () => {
    const { fireEvent, render, waitFor } = await import("@testing-library/react-native/pure");

    connectivityMocks.canReachConfiguredApi.mockResolvedValue(false);
    vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({
      granted: true,
    } as any);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///picked-offline.jpg",
          fileName: "picked-offline.jpg",
          width: 800,
          height: 600,
        },
      ],
    } as any);
    vi.mocked(ImageManipulator.manipulateAsync).mockResolvedValue({ uri: "file:///processed-offline.jpg" } as any);

    const view = render(<UploadIncidentPhotoScreen />);
    fireEvent.press(view.getByText("Siguiente").parent);
    fireEvent.changeText(
      view.getByLabelText("Nota operativa de la evidencia"),
      "Sin red, dejar en cola",
    );
    fireEvent.press(view.getByText("Siguiente").parent);
    fireEvent.press(view.getByLabelText("Seleccionar foto desde la galeria"));

    await waitFor(() => {
      expect(view.getByText("Archivo: picked-offline.jpg")).toBeTruthy();
    });
    fireEvent.press(view.getByText("Confirmar").parent);
    fireEvent.press(view.getByText("Siguiente").parent);
    fireEvent.press(view.getByLabelText("Confirmar y guardar evidencia"));

    await waitFor(() => {
      expect(syncQueueMocks.enqueueUpdateIncidentEvidence).toHaveBeenCalledTimes(1);
      expect(syncQueueMocks.enqueueUploadIncidentPhoto).toHaveBeenCalledTimes(1);
      expect(updateIncidentEvidence).not.toHaveBeenCalled();
      expect(uploadIncidentPhoto).not.toHaveBeenCalled();
      expect(syncQueueMocks.runSync).not.toHaveBeenCalled();
      expect(routerMocks.replace).toHaveBeenCalled();
    });
  });

  it("queues evidence against a local incident when no remote incident id exists yet", async () => {
    const { fireEvent, render, waitFor } = await import("@testing-library/react-native/pure");

    routeParamsMocks.params = {
      localIncidentLocalId: "incident-local-44",
      incidentJobId: "job-incident-44",
      installationId: "7",
    };
    connectivityMocks.canReachConfiguredApi.mockResolvedValue(false);
    vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({
      granted: true,
    } as any);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///picked-local.jpg",
          fileName: "picked-local.jpg",
          width: 800,
          height: 600,
        },
      ],
    } as any);
    vi.mocked(ImageManipulator.manipulateAsync).mockResolvedValue({ uri: "file:///processed-local.jpg" } as any);

    const view = render(<UploadIncidentPhotoScreen />);
    expect(view.getByText("Incidencia local pendiente: incident-local-44")).toBeTruthy();
    fireEvent.press(view.getByText("Siguiente").parent);
    fireEvent.changeText(
      view.getByLabelText("Nota operativa de la evidencia"),
      "Guardar junto con incidencia local",
    );
    fireEvent.press(view.getByText("Siguiente").parent);
    fireEvent.press(view.getByLabelText("Seleccionar foto desde la galeria"));

    await waitFor(() => {
      expect(view.getByText("Archivo: picked-local.jpg")).toBeTruthy();
    });
    fireEvent.press(view.getByText("Confirmar").parent);
    fireEvent.press(view.getByText("Siguiente").parent);
    fireEvent.press(view.getByLabelText("Confirmar y guardar evidencia"));

    await waitFor(() => {
      expect(syncQueueMocks.enqueueUpdateIncidentEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteIncidentId: null,
          localIncidentLocalId: "incident-local-44",
          dependsOnJobId: "job-incident-44",
        }),
      );
      expect(syncQueueMocks.enqueueUploadIncidentPhoto).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteIncidentId: null,
          localIncidentLocalId: "incident-local-44",
          dependsOnJobId: "job-incident-44",
        }),
      );
      expect(updateIncidentEvidence).not.toHaveBeenCalled();
      expect(uploadIncidentPhoto).not.toHaveBeenCalled();
      expect(syncQueueMocks.runSync).not.toHaveBeenCalled();
      expect(routerMocks.replace).toHaveBeenCalledWith("/work?installationId=7");
    });
  });
});
