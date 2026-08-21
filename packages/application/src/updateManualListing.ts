import {
  normalizeManualListingDraft,
  type ManualListingDraftInput,
} from "@chaoran-property-intelligence/domain";

import {
  ManualListingNotFoundError,
  type ManualListingMutationRepositoryPort,
  type ManualListingRecord,
} from "./manualListingRepository.js";

export type ManualListingPatchInput = Partial<ManualListingDraftInput>;

export interface UpdateManualListingInput {
  listingId: string;
  patch: ManualListingPatchInput;
}

export interface UpdateManualListingOptions {
  repository: ManualListingMutationRepositoryPort;
  now: () => Date;
}

export class InvalidManualListingPatchError extends Error {
  constructor() {
    super("Manual listing patch was invalid");
    this.name = "InvalidManualListingPatchError";
  }
}

export class UpdateManualListing {
  constructor(private readonly options: UpdateManualListingOptions) {}

  async execute(input: UpdateManualListingInput): Promise<ManualListingRecord> {
    if (!isUuid(input.listingId)) {
      throw new ManualListingNotFoundError();
    }
    assertPatchKeys(input.patch);

    const current = await this.options.repository.findActiveManualListing(
      input.listingId,
    );
    if (current === null) {
      throw new ManualListingNotFoundError();
    }

    const normalized = normalizeManualListingDraft(
      mergePatch(current, input.patch),
      this.options.now(),
    );
    const updated = await this.options.repository.updateManualListing({
      id: input.listingId,
      listing: normalized.listing,
      notes: normalized.notes,
      updatedAt: normalized.listing.firstDiscoveredAt,
    });
    if (updated === null) {
      throw new ManualListingNotFoundError();
    }
    return updated;
  }
}

function mergePatch(
  current: ManualListingRecord,
  patch: ManualListingPatchInput,
): ManualListingDraftInput {
  const listing = current.listing;
  return {
    addressLine1: patch.addressLine1 ?? listing.addressLine1,
    addressLine2: readOptionalPatch(patch, "addressLine2", listing.addressLine2),
    city: patch.city ?? listing.city,
    state: patch.state ?? listing.state,
    zipCode: patch.zipCode ?? listing.zipCode,
    latitude: patch.latitude ?? listing.latitude,
    longitude: patch.longitude ?? listing.longitude,
    propertyType: readOptionalPatch(
      patch,
      "propertyType",
      listing.propertyType,
    ),
    bedrooms: readOptionalPatch(patch, "bedrooms", listing.bedrooms),
    bathrooms: readOptionalPatch(patch, "bathrooms", listing.bathrooms),
    price: readOptionalPatch(patch, "price", listing.price),
    status: patch.status ?? listing.status,
    listedDate: readOptionalPatch(patch, "listedDate", listing.listedDate),
    mlsName: readOptionalPatch(patch, "mlsName", listing.mlsName),
    mlsNumber: readOptionalPatch(patch, "mlsNumber", listing.mlsNumber),
    notes: readOptionalPatch(patch, "notes", current.notes),
  };
}

function readOptionalPatch<
  K extends
    | "addressLine2"
    | "propertyType"
    | "bedrooms"
    | "bathrooms"
    | "price"
    | "listedDate"
    | "mlsName"
    | "mlsNumber"
    | "notes",
>(
  patch: ManualListingPatchInput,
  field: K,
  current: NonNullable<ManualListingDraftInput[K]> | null,
): Exclude<ManualListingDraftInput[K], undefined> {
  const value = patch[field];
  return Object.hasOwn(patch, field) && value !== undefined
    ? (value as Exclude<ManualListingDraftInput[K], undefined>)
    : (current as Exclude<ManualListingDraftInput[K], undefined>);
}

function assertPatchKeys(patch: ManualListingPatchInput): void {
  const keys = Object.keys(patch);
  if (
    keys.length === 0 ||
    keys.some((key) => !manualListingPatchFields.has(key))
  ) {
    throw new InvalidManualListingPatchError();
  }
}

const manualListingPatchFields = new Set([
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "zipCode",
  "latitude",
  "longitude",
  "propertyType",
  "bedrooms",
  "bathrooms",
  "price",
  "status",
  "listedDate",
  "mlsName",
  "mlsNumber",
  "notes",
]);

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
