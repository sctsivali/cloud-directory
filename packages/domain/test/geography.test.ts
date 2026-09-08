import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAP_PRECISIONS,
  canAssignMapPrecision,
  projectMapPin,
  validateDeployment,
  validateFacility,
} from "../src/geography.ts";
import type { Deployment, Facility } from "../src/geography.ts";

const cityOnlyFacility: Facility = {
  id: "fac-city",
  name: "Jakarta presence",
  locationId: 1,
  address: null,
  operator: null,
  lat: -6.2,
  lng: 106.8,
  mapPrecision: "undisclosed",
};

describe("locations, facilities, and map precision", () => {
  it("enumerates map precision including facility_exact and undisclosed", () => {
    assert.deepEqual(MAP_PRECISIONS, [
      "facility_exact",
      "campus",
      "city_centroid",
      "region_centroid",
      "undisclosed",
    ]);
  });

  it("does not allow city-only evidence to create an exact-facility map pin", () => {
    assert.equal(
      canAssignMapPrecision({
        requested: "facility_exact",
        evidenceKind: "city_name_only",
        hasCoordinates: true,
      }),
      false
    );
    assert.equal(
      canAssignMapPrecision({
        requested: "facility_exact",
        evidenceKind: "city_name_only",
        hasCoordinates: false,
      }),
      false
    );
    assert.equal(projectMapPin(cityOnlyFacility), null);
    assert.equal(
      projectMapPin({ ...cityOnlyFacility, mapPrecision: "facility_exact" }),
      null,
      "validator must refuse projecting a pin that city-only evidence cannot support"
    );
  });

  it("allows city centroid when the evidence is a city name, never as facility_exact", () => {
    assert.equal(
      canAssignMapPrecision({
        requested: "city_centroid",
        evidenceKind: "city_name_only",
        hasCoordinates: true,
      }),
      true
    );
    const pin = projectMapPin({
      ...cityOnlyFacility,
      mapPrecision: "city_centroid",
    });
    assert.equal(pin, null, "city centroid is not an exact-facility pin");
  });

  it("allows facility_exact only with facility-identity evidence and coordinates", () => {
    assert.equal(
      canAssignMapPrecision({
        requested: "facility_exact",
        evidenceKind: "facility_identity",
        hasCoordinates: true,
      }),
      true
    );
    assert.equal(
      canAssignMapPrecision({
        requested: "facility_exact",
        evidenceKind: "facility_identity",
        hasCoordinates: false,
      }),
      false
    );
    const exact: Facility = {
      ...cityOnlyFacility,
      mapPrecision: "facility_exact",
      name: "Nusantara DC Hall A",
    };
    const pin = projectMapPin(exact, { evidenceKind: "facility_identity" });
    assert.deepEqual(pin, { lat: -6.2, lng: 106.8 });
  });

  it("rejects blank facility names and deployments without a location", () => {
    assert.equal(validateFacility(cityOnlyFacility).ok, true);
    assert.equal(validateFacility({ ...cityOnlyFacility, name: "" }).ok, false);
    const deployment: Deployment = {
      id: "dep-1",
      providerId: "local-packages",
      offeringId: null,
      locationId: 1,
    };
    assert.equal(validateDeployment(deployment).ok, true);
    assert.equal(validateDeployment({ ...deployment, locationId: null }).ok, false);
  });
});
