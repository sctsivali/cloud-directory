import { fail, ok, requireNonEmpty, type ValidationResult } from "./validation.ts";

export const MAP_PRECISIONS = [
  "facility_exact",
  "campus",
  "city_centroid",
  "region_centroid",
  "undisclosed",
] as const;

export type MapPrecision = (typeof MAP_PRECISIONS)[number];

export type MapEvidenceKind =
  | "city_name_only"
  | "region_name"
  | "campus"
  | "facility_identity"
  | "none";

export type Location = {
  id: number | string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  mapPrecision: MapPrecision;
};

export type Facility = {
  id: string;
  name: string;
  locationId: number | string | null;
  address: string | null;
  operator: string | null;
  lat: number | null;
  lng: number | null;
  mapPrecision: MapPrecision;
};

export type Deployment = {
  id: string;
  providerId: string;
  offeringId: string | null;
  locationId: number | string | null;
};

export type DeploymentFacility = {
  deploymentId: string;
  facilityId: string;
};

export function canAssignMapPrecision(args: {
  requested: MapPrecision;
  evidenceKind: MapEvidenceKind;
  hasCoordinates: boolean;
}): boolean {
  const { requested, evidenceKind, hasCoordinates } = args;
  switch (requested) {
    case "undisclosed":
      return true;
    case "region_centroid":
      return evidenceKind === "region_name" || evidenceKind === "city_name_only" || evidenceKind === "campus" || evidenceKind === "facility_identity";
    case "city_centroid":
      return (
        evidenceKind === "city_name_only" ||
        evidenceKind === "campus" ||
        evidenceKind === "facility_identity" ||
        evidenceKind === "region_name"
      );
    case "campus":
      return (evidenceKind === "campus" || evidenceKind === "facility_identity") && hasCoordinates;
    case "facility_exact":
      return evidenceKind === "facility_identity" && hasCoordinates;
    default:
      return false;
  }
}

/** Exact-facility pins require facility-identity evidence. City-only rows never project a pin. */
export function projectMapPin(
  facility: Facility,
  opts?: { evidenceKind?: MapEvidenceKind }
): { lat: number; lng: number } | null {
  const evidenceKind = opts?.evidenceKind ?? "none";
  if (facility.mapPrecision !== "facility_exact") {
    return null;
  }
  if (
    !canAssignMapPrecision({
      requested: "facility_exact",
      evidenceKind,
      hasCoordinates: facility.lat != null && facility.lng != null,
    })
  ) {
    return null;
  }
  if (facility.lat == null || facility.lng == null) {
    return null;
  }
  return { lat: facility.lat, lng: facility.lng };
}

export function validateFacility(facility: Facility): ValidationResult {
  const errors: string[] = [];
  const idErr = requireNonEmpty(facility.id, "id");
  if (idErr) errors.push(idErr);
  const nameErr = requireNonEmpty(facility.name, "name");
  if (nameErr) errors.push(nameErr);
  if (!(MAP_PRECISIONS as readonly string[]).includes(facility.mapPrecision)) {
    errors.push(`unsupported mapPrecision: ${facility.mapPrecision}`);
  }
  if (facility.mapPrecision === "facility_exact" && (facility.lat == null || facility.lng == null)) {
    errors.push("facility_exact requires coordinates");
  }
  if (errors.length) return fail(...errors);
  return ok();
}

export function validateDeployment(deployment: Deployment): ValidationResult {
  const errors: string[] = [];
  const idErr = requireNonEmpty(deployment.id, "id");
  if (idErr) errors.push(idErr);
  const providerErr = requireNonEmpty(deployment.providerId, "providerId");
  if (providerErr) errors.push(providerErr);
  if (deployment.locationId == null || deployment.locationId === "") {
    errors.push("locationId is required");
  }
  if (errors.length) return fail(...errors);
  return ok();
}
