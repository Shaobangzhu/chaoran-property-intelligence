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
} from "./listingsApi.js";

export type ManualListingCreator = (
  draft: ManualListingDraft,
) => Promise<ListingSummary>;

interface ManualListingFormProps {
  coordinates: ListingCoordinates | null;
  createListing: ManualListingCreator;
  markerConfirmed: boolean;
  onCancel: () => void;
  onCreated: (listing: ListingSummary) => void;
  onShowMap: () => void;
}

type SubmissionState = "idle" | "submitting" | "invalid" | "unavailable";

export function ManualListingForm({
  coordinates,
  createListing,
  markerConfirmed,
  onCancel,
  onCreated,
  onShowMap,
}: ManualListingFormProps): React.JSX.Element {
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");
  const [invalidField, setInvalidField] =
    useState<ManualListingField | null>(null);

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
      const listing = await createListing(
        readDraft(new FormData(event.currentTarget), coordinates),
      );
      onCreated(listing);
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
          <h2 id="manual-form-title">Create manual listing</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Cancel creation"
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
                maxLength={100}
              />
            </FormField>
            <FormField
              id="manual-status"
              invalid={invalidField === "status"}
              label="Status"
            >
              <select id="manual-status" name="status" defaultValue="Active">
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
              />
            </FormField>
          </div>
          <FormField
            id="manual-listedDate"
            invalid={invalidField === "listedDate"}
            label="Listed date"
          >
            <input id="manual-listedDate" name="listedDate" type="date" />
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
                maxLength={100}
              />
            </FormField>
          </div>
          <FormField
            id="manual-notes"
            invalid={invalidField === "notes"}
            label="Notes"
          >
            <textarea id="manual-notes" name="notes" maxLength={4000} rows={4} />
          </FormField>
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
            {submissionState === "submitting" ? "Saving" : "Save listing"}
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
