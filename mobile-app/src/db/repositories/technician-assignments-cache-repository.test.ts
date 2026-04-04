import { beforeEach, describe, expect, it, vi } from "vitest";

type TechnicianAssignmentCacheRecord = {
  id: string;
  technicianId: number;
  tenantId: string;
  entityType: string;
  entityId: string;
  assignmentRole: string;
  assignedByUserId: number | null;
  assignedByUsername: string | null;
  assignedAt: string | null;
  unassignedAt: string | null;
  metadataJson: string | null;
  technicianDisplayName: string | null;
  technicianEmployeeCode: string | null;
  technicianIsActive: boolean | null;
  cachedAt: Date | null;
  markAsDeleted: () => Promise<void>;
  destroyPermanently: () => Promise<void>;
};

const dbState = vi.hoisted(() => ({
  records: [] as TechnicianAssignmentCacheRecord[],
  nextId: 1,
}));

function buildRecord(): TechnicianAssignmentCacheRecord {
  const record = {
    id: `assignment-${dbState.nextId++}`,
    technicianId: 0,
    tenantId: "",
    entityType: "",
    entityId: "",
    assignmentRole: "",
    assignedByUserId: null,
    assignedByUsername: null,
    assignedAt: null,
    unassignedAt: null,
    metadataJson: null,
    technicianDisplayName: null,
    technicianEmployeeCode: null,
    technicianIsActive: null,
    cachedAt: null,
    markAsDeleted: vi.fn(async () => undefined),
    destroyPermanently: vi.fn(async () => {
      const index = dbState.records.indexOf(record);
      if (index >= 0) dbState.records.splice(index, 1);
    }),
  };
  return record;
}

vi.mock("../index", () => ({
  database: {
    write: async (work: () => unknown) => await work(),
    get: (table: string) => {
      if (table !== "technician_assignments_cache") throw new Error(`Unknown table ${table}`);
      return {
        create: async (builder: (record: TechnicianAssignmentCacheRecord) => void) => {
          const record = buildRecord();
          builder(record);
          dbState.records.push(record);
          return record;
        },
        query: () => ({
          fetch: async () => dbState.records,
        }),
      };
    },
  },
}));

import { technicianAssignmentsCacheRepository } from "./technician-assignments-cache-repository";

describe("technician-assignments-cache-repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.records = [];
    dbState.nextId = 1;
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  it("replaces assignments only for the selected technician", async () => {
    const staleTarget = buildRecord();
    staleTarget.technicianId = 5;
    const keepOther = buildRecord();
    keepOther.technicianId = 6;
    dbState.records.push(staleTarget, keepOther);

    await technicianAssignmentsCacheRepository.replaceForTechnician(5, [
      {
        id: 1,
        tenant_id: " tenant-1 ",
        technician_id: 5,
        entity_type: " installation ",
        entity_id: " 45 ",
        assignment_role: " assistant ",
        assigned_by_user_id: "9" as any,
        assigned_by_username: " supervisor ",
        assigned_at: "2026-04-04T12:00:00.000Z",
        unassigned_at: null,
        metadata_json: ' {"a":1} ',
        technician_display_name: " Diego ",
        technician_employee_code: " TEC-5 ",
        technician_is_active: 1 as any,
      } as any,
    ]);

    expect(staleTarget.markAsDeleted).toHaveBeenCalledTimes(1);
    expect(keepOther.markAsDeleted).not.toHaveBeenCalled();
    expect(dbState.records.filter((record) => record.technicianId === 5)).toHaveLength(1);
    expect(dbState.records.filter((record) => record.technicianId === 6)).toHaveLength(1);
    expect(dbState.records.find((record) => record.technicianId === 5)).toEqual(
      expect.objectContaining({
        tenantId: "tenant-1",
        entityType: "installation",
        entityId: "45",
        assignmentRole: "assistant",
        assignedByUserId: 9,
        assignedByUsername: "supervisor",
        technicianDisplayName: "Diego",
        technicianEmployeeCode: "TEC-5",
        technicianIsActive: true,
        cachedAt: new Date(1_700_000_000_000),
      }),
    );
  });

  it("lists cached assignments for one technician with negative local ids", async () => {
    const one = buildRecord();
    one.technicianId = 8;
    one.tenantId = "default";
    one.entityType = "incident";
    one.entityId = "77";
    one.assignmentRole = "";
    one.assignedByUserId = null;
    one.assignedByUsername = "ops";
    one.technicianDisplayName = "Tec Uno";
    one.technicianEmployeeCode = "T-1";
    one.technicianIsActive = null;

    const two = buildRecord();
    two.technicianId = 8;
    two.tenantId = "default";
    two.entityType = "asset";
    two.entityId = "22";
    two.assignmentRole = "reviewer";
    two.assignedByUserId = 12;
    two.assignedByUsername = "admin";
    two.technicianDisplayName = "Tec Uno";
    two.technicianEmployeeCode = "T-1";
    two.technicianIsActive = false;

    const other = buildRecord();
    other.technicianId = 9;
    dbState.records.push(one, two, other);

    const assignments = await technicianAssignmentsCacheRepository.listByTechnicianId(8);

    expect(assignments).toEqual([
      expect.objectContaining({
        id: -1,
        technician_id: 8,
        entity_type: "incident",
        entity_id: "77",
        assignment_role: "owner",
        assigned_by_user_id: null,
        assigned_by_username: "ops",
        technician_is_active: null,
      }),
      expect.objectContaining({
        id: -2,
        technician_id: 8,
        entity_type: "asset",
        entity_id: "22",
        assignment_role: "reviewer",
        assigned_by_user_id: 12,
        assigned_by_username: "admin",
        technician_is_active: false,
      }),
    ]);
  });
});
