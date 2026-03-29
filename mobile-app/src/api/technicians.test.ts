import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  signedJsonRequest: vi.fn(),
}));

const webAuthMocks = vi.hoisted(() => ({
  getCurrentWebSession: vi.fn(),
}));

vi.mock("./client", () => clientMocks);
vi.mock("./webAuth", () => webAuthMocks);

import {
  createTechnician,
  createTechnicianAssignment,
  deleteTechnicianAssignment,
  getCurrentLinkedTechnicianContext,
  getTechnicianAssignments,
  getTechnicianAssignmentsByEntity,
  listTechnicians,
  updateTechnician,
} from "./technicians";

describe("technicians api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists technicians using the web route and normalizes ids", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      technicians: [
        {
          id: 7,
          tenant_id: "tenant-a",
          web_user_id: "9",
          display_name: "Ana Campo",
          is_active: 1,
          active_assignment_count: "3",
        },
      ],
    });

    const technicians = await listTechnicians({ includeInactive: true });

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "GET",
      path: "/technicians?include_inactive=1",
    });
    expect(technicians[0]).toEqual(
      expect.objectContaining({
        id: 7,
        web_user_id: 9,
        display_name: "Ana Campo",
        active_assignment_count: 3,
      }),
    );
  });

  it("loads assignments for a technician", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      technician: { id: 7 },
      assignments: [
        {
          id: 11,
          tenant_id: "tenant-a",
          technician_id: "7",
          entity_type: "installation",
          entity_id: "44",
          assignment_role: "owner",
        },
      ],
    });

    const assignments = await getTechnicianAssignments(7);

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "GET",
      path: "/technicians/7/assignments",
    });
    expect(assignments[0]).toEqual(
      expect.objectContaining({
        id: 11,
        technician_id: 7,
        entity_type: "installation",
        entity_id: "44",
      }),
    );
  });

  it("creates a technician with optional linked web user", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      technician: {
        id: 12,
        tenant_id: "tenant-a",
        web_user_id: 9,
        display_name: "Ana Campo",
        employee_code: "TEC-11",
        is_active: true,
      },
    });

    const technician = await createTechnician({
      displayName: "Ana Campo",
      employeeCode: "TEC-11",
      webUserId: 9,
    });

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/technicians",
      data: {
        display_name: "Ana Campo",
        employee_code: "TEC-11",
        email: "",
        phone: "",
        notes: "",
        web_user_id: 9,
      },
    });
    expect(technician.web_user_id).toBe(9);
  });

  it("updates a technician and allows unlinking the web user", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      technician: {
        id: 12,
        tenant_id: "tenant-a",
        web_user_id: null,
        display_name: "Ana Campo",
        employee_code: "TEC-11",
        is_active: false,
      },
    });

    const technician = await updateTechnician(12, {
      webUserId: null,
      isActive: false,
    });

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/technicians/12",
      data: {
        web_user_id: null,
        is_active: false,
      },
    });
    expect(technician.is_active).toBe(false);
    expect(technician.web_user_id).toBeNull();
  });

  it("loads entity assignments using the shared route", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      entity_type: "incident",
      entity_id: "55",
      assignments: [],
    });

    await getTechnicianAssignmentsByEntity("incident", 55);

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "GET",
      path: "/technician-assignments?entity_type=incident&entity_id=55",
    });
  });

  it("creates an assignment for an entity", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      assignment: {
        id: 14,
        tenant_id: "tenant-a",
        technician_id: 7,
        entity_type: "asset",
        entity_id: "88",
        assignment_role: "assistant",
      },
    });

    const assignment = await createTechnicianAssignment(7, {
      entityType: "asset",
      entityId: 88,
      assignmentRole: "assistant",
    });

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/technicians/7/assignments",
      data: {
        entity_type: "asset",
        entity_id: "88",
        assignment_role: "assistant",
      },
    });
    expect(assignment.assignment_role).toBe("assistant");
  });

  it("deletes an assignment by id", async () => {
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      assignment: {
        id: 14,
        tenant_id: "tenant-a",
        technician_id: 7,
        entity_type: "asset",
        entity_id: "88",
        assignment_role: "assistant",
        unassigned_at: "2026-03-28T23:00:00.000Z",
      },
    });

    const assignment = await deleteTechnicianAssignment(14);

    expect(clientMocks.signedJsonRequest).toHaveBeenCalledWith({
      method: "DELETE",
      path: "/technician-assignments/14",
    });
    expect(assignment.unassigned_at).toBe("2026-03-28T23:00:00.000Z");
  });

  it("resolves the linked technician for the current web user", async () => {
    webAuthMocks.getCurrentWebSession.mockResolvedValueOnce({
      success: true,
      authenticated: true,
      token_type: "Bearer",
      expires_in: 3600,
      expires_at: "2026-03-28T20:00:00.000Z",
      user: {
        id: 9,
        username: "ana",
        role: "viewer",
      },
    });
    clientMocks.signedJsonRequest.mockResolvedValueOnce({
      success: true,
      technicians: [
        {
          id: 7,
          tenant_id: "tenant-a",
          web_user_id: 9,
          display_name: "Ana Campo",
          is_active: true,
        },
      ],
    });

    const context = await getCurrentLinkedTechnicianContext();

    expect(context.user.username).toBe("ana");
    expect(context.technician?.display_name).toBe("Ana Campo");
  });
});
