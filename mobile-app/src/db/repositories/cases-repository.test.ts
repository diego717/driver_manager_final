import { beforeEach, describe, expect, it, vi } from "vitest";

type CaseRecord = {
  id: string;
  localId: string;
  remoteId: number | null;
  clientName: string;
  notes: string;
  localSyncStatus: "pending" | "syncing" | "failed" | "synced";
  syncAttempts: number;
  lastSyncError: string | null;
  clientRequestId: string;
  updatedAt: number;
  update: (updater: (record: CaseRecord) => void) => Promise<void>;
};

const dbState = vi.hoisted(() => ({
  cases: [] as CaseRecord[],
  nextId: 1,
}));

const secureMocks = vi.hoisted(() => ({
  secrets: new Map<string, Record<string, unknown>>(),
  setStoredCaseSecret: vi.fn(async (localId: string, payload: Record<string, unknown>) => {
    secureMocks.secrets.set(localId, payload);
  }),
  getStoredCaseSecret: vi.fn(async (localId: string) => secureMocks.secrets.get(localId) ?? null),
  redactStoredSensitiveValue: vi.fn(() => "[redacted]"),
}));

const sanitizeMocks = vi.hoisted(() => ({
  sanitizeStoredSyncMessage: vi.fn((value?: string | null) =>
    value ? `[safe] ${value}` : null,
  ),
}));

function buildCaseRecord(): CaseRecord {
  const record = {
    id: `case-${dbState.nextId++}`,
    localId: "",
    remoteId: null,
    clientName: "",
    notes: "",
    localSyncStatus: "pending" as const,
    syncAttempts: 0,
    lastSyncError: null,
    clientRequestId: "",
    updatedAt: 0,
    update: async (updater: (record: CaseRecord) => void) => {
      updater(record);
    },
  };
  return record;
}

vi.mock("../index", () => ({
  database: {
    write: async (work: () => unknown) => await work(),
    get: (table: string) => {
      if (table !== "cases_local") throw new Error(`Unknown table ${table}`);
      return {
        create: async (builder: (record: CaseRecord) => void) => {
          const record = buildCaseRecord();
          builder(record);
          dbState.cases.push(record);
          return record;
        },
        query: () => ({
          fetch: async () => dbState.cases,
        }),
      };
    },
  },
}));

vi.mock("../../storage/secure", () => secureMocks);
vi.mock("../../services/sync/sync-errors", () => sanitizeMocks);

import { casesRepository } from "./cases-repository";

describe("cases-repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.cases = [];
    dbState.nextId = 1;
    secureMocks.secrets.clear();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  it("creates local cases with redacted fields and stored secrets", async () => {
    const localCase = await casesRepository.createLocalCase({
      localId: "case-local-1",
      clientName: "Cliente Uno",
      notes: "Notas sensibles",
      clientRequestId: "req-case-1",
    });

    expect(localCase.clientName).toBe("[redacted]");
    expect(localCase.notes).toBe("[redacted]");
    expect(localCase.updatedAt).toBe(1_700_000_000_000);
    expect(secureMocks.setStoredCaseSecret).toHaveBeenCalledWith("case-local-1", {
      clientName: "Cliente Uno",
      notes: "Notas sensibles",
    });
  });

  it("updates sync status with sanitized errors and resolves sensitive fields", async () => {
    await casesRepository.createLocalCase({
      localId: "case-local-2",
      clientName: "Cliente Dos",
      notes: "Detalle privado",
      clientRequestId: "req-case-2",
    });

    await casesRepository.updateSyncStatus("case-local-2", "failed", "sqlite c:\\secret");
    const localCase = await casesRepository.getByLocalId("case-local-2");
    const sensitive = await casesRepository.resolveSensitiveFields(localCase!);

    expect(localCase?.syncAttempts).toBe(1);
    expect(localCase?.lastSyncError).toBe("[safe] sqlite c:\\secret");
    expect(sensitive).toEqual({
      clientName: "Cliente Dos",
      notes: "Detalle privado",
    });
  });

  it("marks remote ids as synced and lists only pending or failed cases", async () => {
    await casesRepository.createLocalCase({
      localId: "case-local-3",
      clientName: "Pendiente",
      notes: "",
      clientRequestId: "req-case-3",
    });
    await casesRepository.createLocalCase({
      localId: "case-local-4",
      clientName: "Otro",
      notes: "",
      clientRequestId: "req-case-4",
      syncStatus: "failed",
    });

    await casesRepository.updateRemoteId("case-local-3", 91);

    const pending = await casesRepository.getPendingCases();

    expect(pending.map((item) => item.localId)).toEqual(["case-local-4"]);
    expect(casesRepository.sanitizeStoredError("abc")).toBe("[safe] abc");
  });
});
