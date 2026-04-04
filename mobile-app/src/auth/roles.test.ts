import { describe, expect, it } from "vitest";

import {
  canDeleteCriticalData,
  canManagePlatform,
  canManageTechnicians,
  canManageUsers,
  canWriteOperationalData,
  normalizeWebRole,
} from "./roles";

describe("web roles", () => {
  it("normalizes legacy viewer role to solo_lectura", () => {
    expect(normalizeWebRole("viewer")).toBe("solo_lectura");
  });

  it("falls back to solo_lectura for unknown roles", () => {
    expect(normalizeWebRole("something-else")).toBe("solo_lectura");
  });

  it("preserves platform roles", () => {
    expect(normalizeWebRole(" platform_owner ")).toBe("platform_owner");
    expect(normalizeWebRole("SUPER_ADMIN")).toBe("super_admin");
  });

  it("allows only platform roles to manage platform state", () => {
    expect(canManagePlatform("platform_owner")).toBe(true);
    expect(canManagePlatform("super_admin")).toBe(true);
    expect(canManagePlatform("admin")).toBe(false);
  });

  it("allows admin and platform roles to manage users and technicians", () => {
    expect(canManageUsers("admin")).toBe(true);
    expect(canManageUsers("super_admin")).toBe(true);
    expect(canManageUsers("supervisor")).toBe(false);
    expect(canManageTechnicians("platform_owner")).toBe(true);
    expect(canManageTechnicians("solo_lectura")).toBe(false);
  });

  it("allows operational writes for admin supervisor tecnico and platform roles", () => {
    expect(canWriteOperationalData("admin")).toBe(true);
    expect(canWriteOperationalData("supervisor")).toBe(true);
    expect(canWriteOperationalData("tecnico")).toBe(true);
    expect(canWriteOperationalData("platform_owner")).toBe(true);
    expect(canWriteOperationalData("viewer")).toBe(false);
  });

  it("limits critical deletions to platform roles", () => {
    expect(canDeleteCriticalData("super_admin")).toBe(true);
    expect(canDeleteCriticalData("platform_owner")).toBe(true);
    expect(canDeleteCriticalData("admin")).toBe(false);
  });
});
