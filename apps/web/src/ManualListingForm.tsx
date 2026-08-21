import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  MapPin,
  Save,
  X,
} from "lucide-react";
import { cloneElement, type FormEvent, type ReactElement, useState } from "react";

import type { ListingCoordinates } from "./ListingsMap.js";
import {
  ManualListingValidationError,
  type ListingSummary,
  type ManualListingDraft,
  type ManualListingField,
  type ManualListingPatch,
} from "./listingsApi.js";

export type ManualListingCreator = (
  draft: ManualListingDraft,
) => Promise<ListingSummary>;

export type ManualListingUpdater = (
  listingId: string,
  patch: ManualListingPatch,
) => Promise<ListingSummary>;

interface ManualListingFormProps {
  coordinates: ListingCoordinates | null;
  createListing: ManualListingCreator;
  initialListing?: ListingSummary;
  markerConfirmed: boolean;
  onCancel: () => void;
  onSaved: (listing: ListingSummary) => void;
  onShowMap: () => void;
  updateListing: ManualListingUpdater;
}

type SubmissionState =
  | "idle"
  | "submitting"
  | "invalid"
  | "unchanged"
  | "unavailable";

export function ManualListingForm({
  coordinates,
  createListing,
  initialListing,
  markerConfirmed,
  onCancel,
  onSaved,
  onShowMap,
  updateListing,
}: ManualListingFormProps): React.JSX.Element {
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");
  const [invalidField, setInvalidField] =
    useState<ManualListingField | null>(null);
  const [notesAction, setNotesAction] = useState<"keep" | "replace" | "clear">(
    "keep",
  );
  const isEditing = initialListing !== undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      submissionState === "submitting" ||
      coordinates === null ||
      !markerConfirmed
    ) {
      return;
    }

    setSubmissionState("submitting");
    setInvalidField(null);
    try {
      const formData = new FormData(event.currentTarget);
      let listing: ListingSummary;
      if (initialListing === undefined) {
        listing = await createListing(readDraft(formData, coordinates));
      } else {
        const patch = readPatch(
          formData,
          coordinates,
          initialListing,
          notesAction,
        );
        if (Object.keys(patch).length === 0) {
          setSubmissionState("unchanged");
          return;
        }
        listing = await updateListing(initialListing.id, patch);
      }
      onSaved(listing);
    } catch (error) {
      if (error instanceof ManualListingValidationError) {
        setInvalidField(error.field);
        setSubmissionState("invalid");
        focusInvalidField(error.field);
      } else {
        setSubmissionState("unavailable");
      }
    }
  };

  const locationInvalid =
    invalidField === "latitude" || invalidField === "longitude";
  const feedback = getSubmissionFeedback(submissionState, invalidField);

  return (
    <section className="manual-listing-panel" aria-labelledby="manual-form-title">
      <div className="manual-form-heading">
        <div>
          <p className="section-label">Manual source</p>
          <h2 id="manual-form-title">
            {isEditing ? "Edit manual listing" : "Create manual listing"}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={isEditing ? "Cancel editing" : "Cancel creation"}
          disabled={submissionState === "submitting"}
          onClick={onCancel}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      <form
        className="manual-listing-form"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <fieldset disabled={submissionState === "submitting"}>
          <legend>Address</legend>
          <FormField
            id="manual-addressLine1"
            invalid={invalidField === "addressLine1"}
            label="Address line 1"
          >
            <input
              id="manual-addressLine1"
              name="addressLine1"
              type="text"
              autoComplete="address-line1"
              defaultValue={initialListing?.addressLine1 ?? ""}
              maxLength={200}
              required
            />
          </FormField>
          <FormField
            id="manual-addressLine2"
            invalid={invalidField === "addressLine2"}
            label="Unit or address line 2"
          >
            <input
              id="manual-addressLine2"
              name="addressLine2"
              type="text"
              autoComplete="address-line2"
              defaultValue={initialListing?.addressLine2 ?? ""}
              maxLength={100}
            />
          </FormField>
          <div className="form-grid form-grid-location">
            <FormField
              id="manual-city"
              invalid={invalidField === "city"}
              label="City"
            >
              <input
                id="manual-city"
                name="city"
                type="text"
                autoComplete="address-level2"
                defaultValue={initialListing?.city ?? ""}
                maxLength={100}
                required
              />
            </FormField>
            <FormField
              id="manual-state"
              invalid={invalidField === "state"}
              label="State"
            >
              <input
                id="manual-state"
                name="state"
                type="text"
                autoComplete="address-level1"
                readOnly
                value="CA"
              />
            </FormField>
            <FormField
              id="manual-zipCode"
              invalid={invalidField === "zipCode"}
              label="ZIP code"
            >
              <input
                id="manual-zipCode"
                name="zipCode"
                type="text"
                autoComplete="postal-code"
                defaultValue={initialListing?.zipCode ?? ""}
                inputMode="numeric"
                maxLength={10}
                pattern="[0-9]{5}(-[0-9]{4})?"
                required
              />
            </FormField>
          </div>
        </fieldset>

        <fieldset disabled={submissionState === "submitting"}>
          <legend>Property</legend>
          <div className="form-grid form-grid-two">
            <FormField
              id="manual-propertyType"
              invalid={invalidField === "propertyType"}
              label="Property type"
            >
              <input
                id="manual-propertyType"
                name="propertyType"
                type="text"
                defaultValue={initialListing?.propertyType ?? ""}
                maxLength={100}
              />
            </FormField>
            <FormField
              id="manual-status"
              invalid={invalidField === "status"}
              label="Status"
            >
              <select
                id="manual-status"
                name="status"
                defaultValue={
                  initialListing?.status === "Pending" ? "Pending" : "Active"
                }
              >
                <option value="Active">Active</option>
                <option value="Pending">Pending</option>
              </select>
            </FormField>
          </div>
          <div className="form-grid form-grid-three">
            <FormField
              id="manual-bedrooms"
              invalid={invalidField === "bedrooms"}
              label="Bedrooms"
            >
              <input
                id="manual-bedrooms"
                name="bedrooms"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.5"
                defaultValue={initialListing?.bedrooms ?? ""}
              />
            </FormField>
            <FormField
              id="manual-bathrooms"
              invalid={invalidField === "bathrooms"}
              label="Bathrooms"
            >
              <input
                id="manual-bathrooms"
                name="bathrooms"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.5"
                defaultValue={initialListing?.bathrooms ?? ""}
              />
            </FormField>
            <FormField
              id="manual-price"
              invalid={invalidField === "price"}
              label="Price"
            >
              <input
                id="manual-price"
                name="price"
                type="number"
                inputMode="numeric"
                min="0"
                max="2147483647"
                step="1"
                defaultValue={initialListing?.price ?? ""}
              />
            </FormField>
          </div>
          <FormField
            id="manual-listedDate"
            invalid={invalidField === "listedDate"}
            label="Listed date"
          >
            <input
              id="manual-listedDate"
              name="listedDate"
              type="date"
              defaultValue={initialListing?.listedDate ?? ""}
            />
          </FormField>
        </fieldset>

        <fieldset disabled={submissionState === "submitting"}>
          <legend>Reference</legend>
          <div className="form-grid form-grid-two">
            <FormField
              id="manual-mlsName"
              invalid={invalidField === "mlsName"}
              label="MLS name"
            >
              <input
                id="manual-mlsName"
                name="mlsName"
                type="text"
                defaultValue={initialListing?.mlsName ?? ""}
                maxLength={100}
              />
            </FormField>
            <FormField
              id="manual-mlsNumber"
              invalid={invalidField === "mlsNumber"}
              label="MLS number"
            >
              <input
                id="manual-mlsNumber"
                name="mlsNumber"
                type="text"
                defaultValue={initialListing?.mlsNumber ?? ""}
                maxLength={100}
              />
            </FormField>
          </div>
          {isEditing ? (
            <>
              <FormField
                id="manual-notesAction"
                invalid={false}
                label="Notes"
              >
                <select
                  id="manual-notesAction"
                  name="notesAction"
                  value={notesAction}
                  onChange={(event) =>
                    setNotesAction(
                      event.target.value as "keep" | "replace" | "clear",
                    )
                  }
                >
                  <option value="keep">Keep existing notes</option>
                  <option value="replace">Replace notes</option>
                  <option value="clear">Clear notes</option>
                </select>
              </FormField>
              {notesAction === "replace" ? (
                <FormField
                  id="manual-notes"
                  invalid={invalidField === "notes"}
                  label="Replacement notes"
                >
                  <textarea
                    id="manual-notes"
                    name="notes"
                    maxLength={4000}
                    rows={4}
                  />
                </FormField>
              ) : null}
            </>
          ) : (
            <FormField
              id="manual-notes"
              invalid={invalidField === "notes"}
              label="Notes"
            >
              <textarea
                id="manual-notes"
                name="notes"
                maxLength={4000}
                rows={4}
              />
            </FormField>
          )}
        </fieldset>

        <section
          className={`location-confirmation${locationInvalid ? " is-invalid" : ""}`}
          aria-label="Listing coordinates"
        >
          <div className="location-confirmation-copy">
            <MapPin aria-hidden="true" size={18} />
            <div>
              <strong>
                {coordinates === null
                  ? "Marker required"
                  : markerConfirmed
                    ? "Marker confirmed"
                    : "Confirmation required"}
              </strong>
              <span>
                {coordinates === null
                  ? "No coordinates selected"
                  : formatCoordinates(coordinates)}
              </span>
            </div>
          </div>
          <button className="secondary-button" type="button" onClick={onShowMap}>
            <MapPin aria-hidden="true" size={16} />
            Open map
          </button>
        </section>

        <div className="manual-form-feedback" aria-live="polite">
          {feedback === null ? null : (
            <p role="alert">
              <AlertCircle aria-hidden="true" size={16} />
              {feedback}
            </p>
          )}
        </div>

        <div className="manual-form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={submissionState === "submitting"}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={!markerConfirmed || submissionState === "submitting"}
          >
            {submissionState === "submitting" ? (
              <LoaderCircle className="spin" aria-hidden="true" size={17} />
            ) : markerConfirmed ? (
              <Save aria-hidden="true" size={17} />
            ) : (
              <CheckCircle2 aria-hidden="true" size={17} />
            )}
            {submissionState === "submitting"
              ? "Saving"
              : isEditing
                ? "Save changes"
                : "Save listing"}
          </button>
        </div>
      </form>
    </section>
  );
}

function FormField({
  children,
  id,
  invalid,
  label,
}: {
  children: ReactElement<{ "aria-invalid"?: boolean }>;
  id: string;
  invalid: boolean;
  label: string;
}): React.JSX.Element {
  return (
    <div className={`form-field${invalid ? " is-invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, invalid ? { "aria-invalid": true } : {})}
    </div>
  );
}

function readDraft(
  formData: FormData,
  coordinates: ListingCoordinates,
): ManualListingDraft {
  return {
    addressLine1: readRequiredString(formData, "addressLine1"),
    ...readOptionalString(formData, "addressLine2"),
    city: readRequiredString(formData, "city"),
    state: "CA",
    zipCode: readRequiredString(formData, "zipCode"),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    ...readOptionalString(formData, "propertyType"),
    ...readOptionalNumber(formData, "bedrooms"),
    ...readOptionalNumber(formData, "bathrooms"),
    ...readOptionalNumber(formData, "price"),
    status:
      readRequiredString(formData, "status") === "Pending"
        ? "Pending"
        : "Active",
    ...readOptionalString(formData, "listedDate"),
    ...readOptionalString(formData, "mlsName"),
    ...readOptionalString(formData, "mlsNumber"),
    ...readOptionalString(formData, "notes"),
  };
}

function readPatch(
  formData: FormData,
  coordinates: ListingCoordinates,
  initial: ListingSummary,
  notesAction: "keep" | "replace" | "clear",
): ManualListingPatch {
  const patch: ManualListingPatch = {};
  const addressLine1 = readRequiredString(formData, "addressLine1");
  const city = readRequiredString(formData, "city");
  const zipCode = readRequiredString(formData, "zipCode");
  const status =
    readRequiredString(formData, "status") === "Pending"
      ? "Pending"
      : "Active";

  if (addressLine1 !== initial.addressLine1) patch.addressLine1 = addressLine1;
  if (city !== initial.city) patch.city = city;
  if (zipCode !== initial.zipCode) patch.zipCode = zipCode;
  if (status !== initial.status) patch.status = status;
  if (coordinates.latitude !== initial.latitude) {
    patch.latitude = coordinates.latitude;
  }
  if (coordinates.longitude !== initial.longitude) {
    patch.longitude = coordinates.longitude;
  }

  addOptionalStringPatch(patch, formData, "addressLine2", initial.addressLine2);
  addOptionalStringPatch(patch, formData, "propertyType", initial.propertyType);
  addOptionalNumberPatch(patch, formData, "bedrooms", initial.bedrooms);
  addOptionalNumberPatch(patch, formData, "bathrooms", initial.bathrooms);
  addOptionalNumberPatch(patch, formData, "price", initial.price);
  addOptionalStringPatch(patch, formData, "listedDate", initial.listedDate);
  addOptionalStringPatch(patch, formData, "mlsName", initial.mlsName);
  addOptionalStringPatch(patch, formData, "mlsNumber", initial.mlsNumber);

  if (notesAction === "clear") {
    patch.notes = null;
  } else if (notesAction === "replace") {
    const notes = readRequiredString(formData, "notes").trim();
    patch.notes = notes.length === 0 ? null : notes;
  }

  return patch;
}

type OptionalStringPatchField =
  | "addressLine2"
  | "propertyType"
  | "listedDate"
  | "mlsName"
  | "mlsNumber";

function addOptionalStringPatch(
  patch: ManualListingPatch,
  formData: FormData,
  field: OptionalStringPatchField,
  initialValue: string | null,
): void {
  const value = readRequiredString(formData, field).trim() || null;
  if (value !== initialValue) {
    patch[field] = value;
  }
}

type OptionalNumberPatchField = "bedrooms" | "bathrooms" | "price";

function addOptionalNumberPatch(
  patch: ManualListingPatch,
  formData: FormData,
  field: OptionalNumberPatchField,
  initialValue: number | null,
): void {
  const rawValue = readRequiredString(formData, field);
  const value = rawValue.length === 0 ? null : Number(rawValue);
  if (value !== initialValue) {
    patch[field] = value;
  }
}

function readRequiredString(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function readOptionalString<K extends ManualListingField>(
  formData: FormData,
  field: K,
): Partial<Record<K, string>> {
  const value = readRequiredString(formData, field).trim();
  return value.length === 0 ? {} : { [field]: value } as Record<K, string>;
}

function readOptionalNumber<K extends ManualListingField>(
  formData: FormData,
  field: K,
): Partial<Record<K, number>> {
  const value = readRequiredString(formData, field);
  return value.length === 0 ? {} : { [field]: Number(value) } as Record<K, number>;
}

function focusInvalidField(field: ManualListingField | null): void {
  const fieldId =
    field === "latitude" || field === "longitude" || field === null
      ? null
      : `manual-${field}`;
  if (fieldId !== null) {
    window.setTimeout(() => document.getElementById(fieldId)?.focus(), 0);
  }
}

function getSubmissionFeedback(
  state: SubmissionState,
  field: ManualListingField | null,
): string | null {
  if (state === "invalid") {
    return field === null
      ? "Check the listing details and try again."
      : `Check the ${formatFieldName(field)} field.`;
  }
  if (state === "unavailable") {
    return "The listing could not be saved. Try again.";
  }
  if (state === "unchanged") {
    return "No changes to save.";
  }
  return null;
}

function formatFieldName(field: ManualListingField): string {
  const labels: Record<ManualListingField, string> = {
    addressLine1: "address line 1",
    addressLine2: "address line 2",
    city: "city",
    state: "state",
    zipCode: "ZIP code",
    latitude: "map location",
    longitude: "map location",
    propertyType: "property type",
    bedrooms: "bedrooms",
    bathrooms: "bathrooms",
    price: "price",
    status: "status",
    listedDate: "listed date",
    mlsName: "MLS name",
    mlsNumber: "MLS number",
    notes: "notes",
  };
  return labels[field];
}

function formatCoordinates(coordinates: ListingCoordinates): string {
  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
}
