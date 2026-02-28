import { signedJsonRequest } from "./client";

export type LookupEntityType = "installation" | "asset";

export interface LookupCodeResponse {
  success: boolean;
  match: {
    type: LookupEntityType;
    installation_id?: number | null;
    asset_id?: string | null;
    external_code?: string | null;
  };
}

export async function lookupCode(
  code: string,
  type: LookupEntityType,
): Promise<LookupCodeResponse> {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    throw new Error("Codigo requerido.");
  }

  const query = new URLSearchParams({ code: normalizedCode, type });
  return signedJsonRequest<LookupCodeResponse>({
    method: "GET",
    path: `/lookup?${query.toString()}`,
  });
}
