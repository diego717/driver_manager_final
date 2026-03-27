import {
  type CreatePublicTrackingLinkResponse,
  type DeletePublicTrackingLinkResponse,
  type GetPublicTrackingLinkResponse,
  type PublicTrackingLink,
} from "../types/api";
import { ensurePositiveInt } from "../utils/validation";
import { signedJsonRequest } from "./client";

type RawPublicTrackingLink = Omit<PublicTrackingLink, "installation_id"> & {
  installation_id?: number | string | null;
};

type RawGetPublicTrackingLinkResponse = Omit<GetPublicTrackingLinkResponse, "link"> & {
  link: RawPublicTrackingLink;
};

type RawCreatePublicTrackingLinkResponse = Omit<CreatePublicTrackingLinkResponse, "link"> & {
  link: RawPublicTrackingLink;
};

function normalizeOptionalPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizePublicTrackingLink(link: RawPublicTrackingLink): PublicTrackingLink {
  return {
    ...link,
    active: link?.active === true,
    installation_id: normalizeOptionalPositiveInt(link?.installation_id),
    token_id: typeof link?.token_id === "string" ? link.token_id : null,
    tracking_url: typeof link?.tracking_url === "string" ? link.tracking_url : null,
  };
}

export async function getInstallationPublicTrackingLink(
  installationId: number,
): Promise<PublicTrackingLink> {
  ensurePositiveInt(installationId, "installationId");
  const response = await signedJsonRequest<RawGetPublicTrackingLinkResponse>({
    method: "GET",
    path: `/installations/${installationId}/public-tracking-link`,
  });
  return normalizePublicTrackingLink(response.link);
}

export async function createInstallationPublicTrackingLink(
  installationId: number,
): Promise<PublicTrackingLink> {
  ensurePositiveInt(installationId, "installationId");
  const response = await signedJsonRequest<RawCreatePublicTrackingLinkResponse>({
    method: "POST",
    path: `/installations/${installationId}/public-tracking-link`,
  });
  return normalizePublicTrackingLink(response.link);
}

export async function deleteInstallationPublicTrackingLink(
  installationId: number,
): Promise<DeletePublicTrackingLinkResponse> {
  ensurePositiveInt(installationId, "installationId");
  return signedJsonRequest<DeletePublicTrackingLinkResponse>({
    method: "DELETE",
    path: `/installations/${installationId}/public-tracking-link`,
  });
}
