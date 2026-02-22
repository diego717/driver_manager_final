import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = "https://worker.example";
});

const secureState = vi.hoisted(() => new Map<string, string>());
const axiosRequestMock = vi.hoisted(() => vi.fn());
const axiosCreateMock = vi.hoisted(() =>
  vi.fn(() => ({
    request: axiosRequestMock,
  })),
);

vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureState.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => secureState.get(key) ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureState.delete(key);
  }),
}));

vi.mock("axios", () => ({
  default: {
    create: axiosCreateMock,
  },
  create: axiosCreateMock,
}));

import {
  clearInstallationsCache,
  createIncident,
  listIncidentsByInstallation,
  listInstallations,
} from "../api/incidents";
import { loginWebSession } from "../api/webAuth";

describe("critical integration flow: web login + incidents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secureState.clear();
    clearInstallationsCache();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("completes login -> load installations -> create incident -> verify in list", async () => {
    const installations = [
      { id: 1, client_name: "ACME" },
      { id: 2, client_name: "Globex" },
    ];
    const incidentsByInstallation = new Map<number, any[]>();
    let nextIncidentId = 100;

    const nowIso = "2026-02-22T12:00:00.000Z";
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        access_token: "web-token-1",
        token_type: "Bearer",
        expires_in: 3600,
        expires_at: "2030-01-01T00:00:00.000Z",
        user: {
          username: "admin",
          role: "admin",
        },
      }),
    } as any);

    axiosRequestMock.mockImplementation(async (config: any) => {
      const method = String(config.method || "GET").toUpperCase();
      const url = String(config.url || "");
      const headers = (config.headers || {}) as Record<string, string>;
      const bearer = headers.Authorization;

      if (url.startsWith("/web/")) {
        expect(bearer).toBe("Bearer web-token-1");
      }

      if (method === "GET" && url === "/web/installations") {
        return { data: installations };
      }

      const incidentsMatch = url.match(/^\/web\/installations\/(\d+)\/incidents$/);
      if (incidentsMatch && method === "POST") {
        const installationId = Number.parseInt(incidentsMatch[1], 10);
        const payload = config.data as Record<string, unknown>;
        const created = {
          id: nextIncidentId++,
          installation_id: installationId,
          reporter_username: String(payload.reporter_username || "mobile_user"),
          note: String(payload.note || ""),
          time_adjustment_seconds: Number(payload.time_adjustment_seconds || 0),
          severity: String(payload.severity || "medium"),
          source: String(payload.source || "mobile"),
          created_at: nowIso,
        };
        const current = incidentsByInstallation.get(installationId) || [];
        incidentsByInstallation.set(installationId, [...current, { ...created, photos: [] }]);
        return {
          data: {
            success: true,
            incident: created,
          },
        };
      }

      if (incidentsMatch && method === "GET") {
        const installationId = Number.parseInt(incidentsMatch[1], 10);
        return {
          data: {
            success: true,
            installation_id: installationId,
            incidents: incidentsByInstallation.get(installationId) || [],
          },
        };
      }

      throw new Error(`Unhandled request: ${method} ${url}`);
    });

    const login = await loginWebSession(" Admin ", "  p@ss with spaces  ");
    expect(login.user.username).toBe("admin");

    const availableInstallations = await listInstallations();
    expect(availableInstallations).toHaveLength(2);
    expect(availableInstallations[0].id).toBe(1);

    const createResponse = await createIncident(1, {
      note: "Impresora sin respuesta",
      reporter_username: "admin",
      time_adjustment_seconds: 120,
      severity: "high",
      source: "mobile",
      apply_to_installation: false,
    });
    expect(createResponse.success).toBe(true);
    expect(createResponse.incident.installation_id).toBe(1);

    const listed = await listIncidentsByInstallation(1);
    expect(listed.success).toBe(true);
    expect(listed.incidents).toHaveLength(1);
    expect(listed.incidents[0].note).toBe("Impresora sin respuesta");
    expect(listed.incidents[0].photos).toEqual([]);
  });
});
