import React from "react";
import Module from "node:module";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  back: vi.fn(),
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

vi.mock("react-native", () => createReactNativeMock());

vi.mock("expo-router", () => {
  const Stack = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  Stack.Screen = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Stack,
    useLocalSearchParams: () => ({ installationId: "7" }),
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
vi.mock("@/src/services/incident-evidence", () => ({
  persistIncidentEvidenceLocally: vi.fn(),
  syncIncidentEvidence: vi.fn(),
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

import UploadIncidentEvidenceWizardScreen from "./upload";

describe("UploadIncidentEvidenceWizardScreen accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders step 1 controls with labels, roles and touch sizes", async () => {
    const { render } = await import("@testing-library/react-native/pure");
    const view = render(<UploadIncidentEvidenceWizardScreen />);

    expect(view.getByLabelText("ID de instalacion para el asistente")).toBeTruthy();

    const checklistItem = view.getByLabelText("Checklist Driver verificado");
    expect(checklistItem.props.accessibilityRole).toBe("checkbox");
    expect(checklistItem.props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );

    const previousButton = view.getByLabelText("Paso anterior del asistente");
    expect(previousButton.props.accessibilityRole).toBe("button");
    expect(flattenStyle(previousButton.props.style).minHeight).toBeGreaterThanOrEqual(44);

    const nextButton = view.getByLabelText("Siguiente paso del asistente");
    expect(nextButton.props.accessibilityRole).toBe("button");
    expect(flattenStyle(nextButton.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it("moves to note step and exposes note input label", async () => {
    const { fireEvent, render } = await import("@testing-library/react-native/pure");
    const view = render(<UploadIncidentEvidenceWizardScreen />);

    fireEvent.press(view.getByLabelText("Checklist Driver verificado"));
    fireEvent.press(view.getByLabelText("Siguiente paso del asistente"));

    expect(view.getByLabelText("Nota de incidencia")).toBeTruthy();
  });
});
