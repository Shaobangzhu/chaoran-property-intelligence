import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  Home,
  LoaderCircle,
  MapPinned,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import {
  listingPropertyTypes,
  listingSearchCities,
  maximumListingSearchBathrooms,
  maximumListingSearchBedrooms,
  maximumListingSearchPrice,
  type ListingPropertyType,
  type ListingSearchCity,
} from "@chaoran-property-intelligence/domain";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ListingSearchCriteriaChangedError,
  ListingSearchCriteriaValidationError,
  type EditableListingSearchCriteria,
  type ListingSearchCriteriaSnapshot,
  type UpdateListingSearchCriteriaInput,
} from "./listingSearchCriteriaApi.js";

export type ListingSearchCriteriaLoader = (
  signal: AbortSignal,
) => Promise<ListingSearchCriteriaSnapshot>;

export type ListingSearchCriteriaSaver = (
  input: UpdateListingSearchCriteriaInput,
) => Promise<ListingSearchCriteriaSnapshot>;

interface SearchCriteriaScreenProps {
  loadCriteria: ListingSearchCriteriaLoader;
  saveCriteria: ListingSearchCriteriaSaver;
}

interface CriteriaFormValues {
  propertyType: ListingPropertyType;
  minimumPrice: string;
  maximumPrice: string;
  minimumBedrooms: number;
  minimumBathrooms: number;
  cities: ListingSearchCity[];
}

type CriteriaField = "minimumPrice" | "maximumPrice" | "cities";
type CriteriaFieldErrors = Partial<Record<CriteriaField, string>>;

type ScreenState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      persisted: ListingSearchCriteriaSnapshot;
      draft: CriteriaFormValues;
    };

type Operation = "idle" | "saving" | "reloading";
type Feedback =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }
  | { kind: "conflict"; message: string }
  | null;

const bedroomOptions = Array.from(
  { length: maximumListingSearchBedrooms + 1 },
  (_value, index) => index,
);
const bathroomOptions = Array.from(
  { length: maximumListingSearchBathrooms * 2 + 1 },
  (_value, index) => index / 2,
);

export function SearchCriteriaScreen({
  loadCriteria,
  saveCriteria,
}: SearchCriteriaScreenProps): React.JSX.Element {
  const [requestNumber, setRequestNumber] = useState(0);
  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [operation, setOperation] = useState<Operation>("idle");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [cityDisclosureOpen, setCityDisclosureOpen] = useState(false);
  const cityDisclosureRef = useRef<HTMLDivElement>(null);
  const cityDisclosureButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    setOperation("idle");
    setFeedback(null);
    setShowValidation(false);
    setCityDisclosureOpen(false);

    void loadCriteria(controller.signal).then(
      (snapshot) => {
        if (!controller.signal.aborted) {
          setState({
            draft: toFormValues(snapshot.criteria),
            persisted: snapshot,
            status: "ready",
          });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      },
    );

    return () => controller.abort();
  }, [loadCriteria, requestNumber]);

  useEffect(() => {
    if (!cityDisclosureOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        !cityDisclosureRef.current?.contains(target)
      ) {
        setCityDisclosureOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setCityDisclosureOpen(false);
        cityDisclosureButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cityDisclosureOpen]);

  const validation = useMemo(
    () => (state.status === "ready" ? validateForm(state.draft) : null),
    [state],
  );
  const isDirty =
    state.status === "ready" &&
    !formValuesEqual(state.draft, toFormValues(state.persisted.criteria));
  const isBusy = operation !== "idle";
  const requiresReload = feedback?.kind === "conflict";

  const updateDraft = (
    update: (draft: CriteriaFormValues) => CriteriaFormValues,
  ): void => {
    setState((current) =>
      current.status === "ready"
        ? { ...current, draft: update(current.draft) }
        : current,
    );
    if (feedback !== null && feedback.kind !== "conflict") {
      setFeedback(null);
    }
  };

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (
      state.status !== "ready" ||
      operation !== "idle" ||
      requiresReload ||
      !isDirty ||
      validation === null
    ) {
      return;
    }

    setShowValidation(true);
    if (validation.criteria === null) {
      return;
    }

    setOperation("saving");
    setFeedback(null);
    try {
      const saved = await saveCriteria({
        criteria: validation.criteria,
        expectedRevision: state.persisted.revision,
      });
      setState({
        draft: toFormValues(saved.criteria),
        persisted: saved,
        status: "ready",
      });
      setShowValidation(false);
      setCityDisclosureOpen(false);
      setFeedback({
        kind: "success",
        message: `Saved as revision ${saved.revision}. The next alert run will apply these criteria.`,
      });
    } catch (error) {
      if (error instanceof ListingSearchCriteriaChangedError) {
        setFeedback({
          kind: "conflict",
          message: "Criteria changed in another session. Reload the latest revision before saving again.",
        });
      } else if (error instanceof ListingSearchCriteriaValidationError) {
        setFeedback({
          kind: "error",
          message: "The criteria could not be saved. Review the entered values.",
        });
      } else {
        setFeedback({
          kind: "error",
          message: "Saving is unavailable. Your unsaved changes are still here.",
        });
      }
    } finally {
      setOperation("idle");
    }
  };

  const handleDiscard = (): void => {
    if (
      state.status !== "ready" ||
      operation !== "idle" ||
      requiresReload
    ) {
      return;
    }
    setState({
      ...state,
      draft: toFormValues(state.persisted.criteria),
    });
    setFeedback(null);
    setShowValidation(false);
    setCityDisclosureOpen(false);
  };

  const handleReload = async (): Promise<void> => {
    if (state.status !== "ready" || operation !== "idle") {
      return;
    }
    setOperation("reloading");
    try {
      const latest = await loadCriteria(new AbortController().signal);
      setState({
        draft: toFormValues(latest.criteria),
        persisted: latest,
        status: "ready",
      });
      setFeedback(null);
      setShowValidation(false);
      setCityDisclosureOpen(false);
    } catch {
      setFeedback({
        kind: "conflict",
        message: "The latest revision is unavailable. Your unsaved changes are still here.",
      });
    } finally {
      setOperation("idle");
    }
  };

  if (state.status === "loading") {
    return <LoadingState />;
  }
  if (state.status === "error") {
    return (
      <ErrorState onRetry={() => setRequestNumber((value) => value + 1)} />
    );
  }

  const { draft, persisted } = state;
  const errors = showValidation ? validation?.errors ?? {} : {};

  return (
    <main className="workspace search-criteria-workspace">
      <div className="workspace-heading">
        <div>
          <p className="section-label">Alert configuration</p>
          <h1>Search Criteria</h1>
          <p className="workspace-description">
            Set the property criteria used by future alert runs.
          </p>
        </div>
        <div className="criteria-revision" aria-label="Saved criteria version">
          <span>Revision {persisted.revision}</span>
          <time dateTime={persisted.updatedAt}>
            Updated {persisted.updatedAt.slice(0, 10)}
          </time>
        </div>
      </div>

      <form
        className="criteria-form"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="criteria-command-bar">
          <span className={isDirty ? "criteria-dirty" : "criteria-clean"}>
            {isDirty ? "Unsaved changes" : "Saved"}
          </span>
          <div className="criteria-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={!isDirty || isBusy || requiresReload}
              onClick={handleDiscard}
            >
              <RotateCcw aria-hidden="true" size={16} />
              Discard changes
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={!isDirty || isBusy || requiresReload}
              aria-label={operation === "saving" ? "Saving criteria" : undefined}
            >
              {operation === "saving" ? (
                <LoaderCircle className="spin" aria-hidden="true" size={16} />
              ) : (
                <Save aria-hidden="true" size={16} />
              )}
              {operation === "saving" ? "Saving" : "Save criteria"}
            </button>
          </div>
        </div>

        {feedback === null ? null : (
          <CriteriaFeedback
            feedback={feedback}
            isReloading={operation === "reloading"}
            onReload={() => void handleReload()}
          />
        )}

        <section className="criteria-section" aria-labelledby="property-criteria-title">
          <div className="criteria-section-heading">
            <Home aria-hidden="true" size={18} />
            <div>
              <h2 id="property-criteria-title">Property</h2>
              <p>Choose one property type and minimum room requirements.</p>
            </div>
          </div>
          <div className="criteria-field-grid criteria-field-grid-three">
            <div className="criteria-field">
              <label htmlFor="criteria-property-type">Property type</label>
              <select
                id="criteria-property-type"
                value={draft.propertyType}
                disabled={isBusy}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    propertyType: event.target.value as ListingPropertyType,
                  }))
                }
              >
                {listingPropertyTypes.map((propertyType) => (
                  <option key={propertyType} value={propertyType}>
                    {propertyType}
                  </option>
                ))}
              </select>
            </div>
            <div className="criteria-field">
              <label htmlFor="criteria-minimum-bedrooms">Minimum bedrooms</label>
              <select
                id="criteria-minimum-bedrooms"
                value={draft.minimumBedrooms}
                disabled={isBusy}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    minimumBedrooms: Number(event.target.value),
                  }))
                }
              >
                {bedroomOptions.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "Any" : `${value}+`}
                  </option>
                ))}
              </select>
            </div>
            <div className="criteria-field">
              <label htmlFor="criteria-minimum-bathrooms">Minimum bathrooms</label>
              <select
                id="criteria-minimum-bathrooms"
                value={draft.minimumBathrooms}
                disabled={isBusy}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    minimumBathrooms: Number(event.target.value),
                  }))
                }
              >
                {bathroomOptions.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "Any" : `${value}+`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="criteria-section" aria-labelledby="price-criteria-title">
          <div className="criteria-section-heading">
            <DollarSign aria-hidden="true" size={18} />
            <div>
              <h2 id="price-criteria-title">Price range</h2>
              <p>Enter whole-dollar minimum and maximum prices.</p>
            </div>
          </div>
          <div className="criteria-field-grid criteria-field-grid-two">
            <PriceField
              id="criteria-minimum-price"
              label="Minimum price"
              value={draft.minimumPrice}
              error={errors.minimumPrice}
              disabled={isBusy}
              onChange={(minimumPrice) =>
                updateDraft((current) => ({ ...current, minimumPrice }))
              }
            />
            <PriceField
              id="criteria-maximum-price"
              label="Maximum price"
              value={draft.maximumPrice}
              error={errors.maximumPrice}
              disabled={isBusy}
              onChange={(maximumPrice) =>
                updateDraft((current) => ({ ...current, maximumPrice }))
              }
            />
          </div>
        </section>

        <section className="criteria-section" aria-labelledby="city-criteria-title">
          <div className="criteria-section-heading">
            <MapPinned aria-hidden="true" size={18} />
            <div>
              <h2 id="city-criteria-title">Cities</h2>
              <p>Select between one and seven cities.</p>
            </div>
          </div>
          <div
            className={`criteria-city-field${errors.cities === undefined ? "" : " is-invalid"}`}
            ref={cityDisclosureRef}
          >
            <span className="criteria-field-label">Selected cities</span>
            <button
              ref={cityDisclosureButtonRef}
              className="criteria-city-trigger"
              type="button"
              aria-controls="criteria-city-options"
              aria-expanded={cityDisclosureOpen}
              aria-describedby={
                errors.cities === undefined ? undefined : "criteria-cities-error"
              }
              aria-invalid={errors.cities === undefined ? undefined : true}
              disabled={isBusy}
              onClick={() => setCityDisclosureOpen((open) => !open)}
            >
              <span>{citySelectionLabel(draft.cities.length)}</span>
              <ChevronDown aria-hidden="true" size={16} />
            </button>
            {cityDisclosureOpen ? (
              <fieldset id="criteria-city-options" className="criteria-city-options">
                <legend>Choose cities</legend>
                {listingSearchCities.map((city) => (
                  <label key={city}>
                    <input
                      type="checkbox"
                      checked={draft.cities.includes(city)}
                      onChange={() =>
                        updateDraft((current) => ({
                          ...current,
                          cities: toggleCity(current.cities, city),
                        }))
                      }
                    />
                    <span>{city}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {errors.cities === undefined ? null : (
              <p id="criteria-cities-error" className="criteria-field-error">
                {errors.cities}
              </p>
            )}
          </div>
        </section>
      </form>
    </main>
  );
}

function PriceField({
  id,
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const errorId = `${id}-error`;
  return (
    <div className={`criteria-field${error === undefined ? "" : " is-invalid"}`}>
      <label htmlFor={id}>{label}</label>
      <div className="criteria-currency-input">
        <span aria-hidden="true">$</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={10}
          value={value}
          disabled={disabled}
          aria-describedby={error === undefined ? undefined : errorId}
          aria-invalid={error === undefined ? undefined : true}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {error === undefined ? null : (
        <p id={errorId} className="criteria-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function CriteriaFeedback({
  feedback,
  isReloading,
  onReload,
}: {
  feedback: Exclude<Feedback, null>;
  isReloading: boolean;
  onReload: () => void;
}): React.JSX.Element {
  return (
    <div
      className={`criteria-feedback criteria-feedback-${feedback.kind}`}
      role={feedback.kind === "success" ? "status" : "alert"}
    >
      {feedback.kind === "success" ? (
        <CheckCircle2 aria-hidden="true" size={17} />
      ) : (
        <AlertCircle aria-hidden="true" size={17} />
      )}
      <span>{feedback.message}</span>
      {feedback.kind === "conflict" ? (
        <button
          className="feedback-reload"
          type="button"
          disabled={isReloading}
          onClick={onReload}
        >
          {isReloading ? (
            <LoaderCircle className="spin" aria-hidden="true" size={14} />
          ) : (
            <RefreshCw aria-hidden="true" size={14} />
          )}
          {isReloading ? "Reloading" : "Reload latest"}
        </button>
      ) : null}
    </div>
  );
}

function LoadingState(): React.JSX.Element {
  return (
    <main className="workspace">
      <div className="message-state" role="status" aria-label="Loading search criteria">
        <LoaderCircle className="spin" aria-hidden="true" size={25} />
        <h2>Loading Search Criteria</h2>
      </div>
    </main>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <main className="workspace">
      <section className="message-state error-state" role="alert">
        <AlertCircle aria-hidden="true" size={28} />
        <h2>Search Criteria unavailable</h2>
        <p>The saved criteria could not be reached.</p>
        <button className="retry-button" type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" size={16} />
          Retry
        </button>
      </section>
    </main>
  );
}

function validateForm(values: CriteriaFormValues): {
  criteria: EditableListingSearchCriteria | null;
  errors: CriteriaFieldErrors;
} {
  const errors: CriteriaFieldErrors = {};
  const minimumPrice = parsePrice(values.minimumPrice);
  const maximumPrice = parsePrice(values.maximumPrice);
  if (minimumPrice === null) {
    errors.minimumPrice = "Enter a whole-dollar amount from $0 to $2,147,483,647.";
  }
  if (maximumPrice === null) {
    errors.maximumPrice = "Enter a whole-dollar amount from $0 to $2,147,483,647.";
  }
  if (
    minimumPrice !== null &&
    maximumPrice !== null &&
    minimumPrice > maximumPrice
  ) {
    errors.minimumPrice = "Minimum price cannot exceed maximum price.";
    errors.maximumPrice = "Maximum price must be at least the minimum price.";
  }
  if (values.cities.length < 1 || values.cities.length > listingSearchCities.length) {
    errors.cities = "Select at least one city.";
  }

  if (
    minimumPrice === null ||
    maximumPrice === null ||
    Object.keys(errors).length > 0
  ) {
    return { criteria: null, errors };
  }
  return {
    criteria: {
      propertyType: values.propertyType,
      minimumPrice,
      maximumPrice,
      minimumBedrooms: values.minimumBedrooms,
      minimumBathrooms: values.minimumBathrooms,
      cities: listingSearchCities.filter((city) => values.cities.includes(city)),
    },
    errors,
  };
}

function parsePrice(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const price = Number(value);
  return Number.isSafeInteger(price) &&
    price >= 0 &&
    price <= maximumListingSearchPrice
    ? price
    : null;
}

function toFormValues(
  criteria: EditableListingSearchCriteria,
): CriteriaFormValues {
  return {
    propertyType: criteria.propertyType,
    minimumPrice: String(criteria.minimumPrice),
    maximumPrice: String(criteria.maximumPrice),
    minimumBedrooms: criteria.minimumBedrooms,
    minimumBathrooms: criteria.minimumBathrooms,
    cities: [...criteria.cities],
  };
}

function formValuesEqual(
  left: CriteriaFormValues,
  right: CriteriaFormValues,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toggleCity(
  selected: readonly ListingSearchCity[],
  city: ListingSearchCity,
): ListingSearchCity[] {
  const next = new Set(selected);
  if (next.has(city)) {
    next.delete(city);
  } else {
    next.add(city);
  }
  return listingSearchCities.filter((candidate) => next.has(candidate));
}

function citySelectionLabel(count: number): string {
  if (count === 0) {
    return "No cities selected";
  }
  return `${count} ${count === 1 ? "city" : "cities"} selected`;
}
