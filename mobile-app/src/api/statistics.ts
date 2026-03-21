import type { DashboardStatistics } from "../types/api";
import { signedJsonRequest } from "./client";

export async function getDashboardStatistics(): Promise<DashboardStatistics> {
  return signedJsonRequest<DashboardStatistics>({
    method: "GET",
    path: "/statistics",
  });
}
