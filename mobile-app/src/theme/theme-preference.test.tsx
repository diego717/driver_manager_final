import React, { useEffect, useRef } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rnState = vi.hoisted(() => ({
  colorScheme: "light" as "light" | "dark" | null,
}));

const secureMocks = vi.hoisted(() => ({
  getStoredThemeMode: vi.fn(
    async (): Promise<"system" | "light" | "dark" | null> => null,
  ),
  setStoredThemeMode: vi.fn(async () => undefined),
}));

vi.mock("react-native", () => ({
  useColorScheme: () => rnState.colorScheme,
}));

vi.mock("../storage/secure", () => secureMocks);

import {
  ThemePreferenceProvider,
  useThemePreference,
} from "./theme-preference";

function flushAsync(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("theme-preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rnState.colorScheme = "light";
    secureMocks.getStoredThemeMode.mockResolvedValue(null);
  });

  it("resolves to light when mode is light regardless system scheme", async () => {
    rnState.colorScheme = "dark";
    secureMocks.getStoredThemeMode.mockResolvedValueOnce("light");

    const latestRef: { current: ReturnType<typeof useThemePreference> | null } = {
      current: null,
    };
    const Probe = () => {
      const value = useThemePreference();
      useEffect(() => {
        latestRef.current = value;
      }, [value]);
      return null;
    };

    const treeRef: { current: { unmount: () => void } | null } = { current: null };
    await act(async () => {
      treeRef.current = create(
        <ThemePreferenceProvider>
          <Probe />
        </ThemePreferenceProvider>,
      );
    });
    await flushAsync();

    expect(latestRef.current?.mode).toBe("light");
    expect(latestRef.current?.resolvedScheme).toBe("light");
    expect(latestRef.current?.loading).toBe(false);
    treeRef.current?.unmount();
  });

  it("follows system scheme when mode is system", async () => {
    rnState.colorScheme = "dark";
    secureMocks.getStoredThemeMode.mockResolvedValueOnce("system");

    const latestRef: { current: ReturnType<typeof useThemePreference> | null } = {
      current: null,
    };
    const Probe = () => {
      const value = useThemePreference();
      useEffect(() => {
        latestRef.current = value;
      }, [value]);
      return null;
    };

    const treeRef: { current: { unmount: () => void } | null } = { current: null };
    await act(async () => {
      treeRef.current = create(
        <ThemePreferenceProvider>
          <Probe />
        </ThemePreferenceProvider>,
      );
    });
    await flushAsync();

    expect(latestRef.current?.mode).toBe("system");
    expect(latestRef.current?.resolvedScheme).toBe("dark");
    treeRef.current?.unmount();
  });

  it("setMode persists and updates state without remount", async () => {
    const latestRef: { current: ReturnType<typeof useThemePreference> | null } = {
      current: null,
    };
    let mountCount = 0;
    const Probe = () => {
      const mountedRef = useRef(false);
      if (!mountedRef.current) {
        mountedRef.current = true;
        mountCount += 1;
      }

      const value = useThemePreference();
      useEffect(() => {
        latestRef.current = value;
      }, [value]);
      return null;
    };

    const treeRef: { current: { unmount: () => void } | null } = { current: null };
    await act(async () => {
      treeRef.current = create(
        <ThemePreferenceProvider>
          <Probe />
        </ThemePreferenceProvider>,
      );
    });
    await flushAsync();

    await act(async () => {
      await latestRef.current?.setMode("dark");
    });

    expect(secureMocks.setStoredThemeMode).toHaveBeenCalledWith("dark");
    expect(latestRef.current?.mode).toBe("dark");
    expect(latestRef.current?.resolvedScheme).toBe("dark");
    expect(mountCount).toBe(1);
    treeRef.current?.unmount();
  });
});
