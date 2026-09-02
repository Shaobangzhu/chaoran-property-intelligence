import {
  AlertCircle,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  DollarSign,
  Info,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  Scale,
  Sparkles,
} from "lucide-react";
import {
  InvalidPriceDecisionAddressError,
  normalizePriceDecisionAddress,
  type PriceDecisionMode,
} from "@chaoran-property-intelligence/domain";
import { useEffect, useMemo, useRef, useState } from "react";

import { SessionAuthenticationRequiredError } from "./listingsApi.js";
import {
  PriceEstimationRequestError,
  PriceEstimationValidationError,
  type PriceEstimationFailureCode,
  type PriceEstimationInput,
  type PriceEstimationResult,
} from "./priceEstimationApi.js";

export type PriceEstimator = (
  input: PriceEstimationInput,
  signal: AbortSignal,
) => Promise<PriceEstimationResult>;

interface PriceEstimationScreenProps {
  readonly estimatePrice: PriceEstimator;
}

interface FormValues {
  readonly streetAddress: string;
  readonly city: string;
  readonly zipCode: string;
}

type FormField = keyof FormValues;
type FieldErrors = Partial<Record<FormField, string>>;

interface ResultSnapshot {
  readonly input: PriceEstimationInput;
  readonly result: PriceEstimationResult;
}

interface FailureState {
  readonly code: PriceEstimationFailureCode;
  readonly input: PriceEstimationInput;
}

const initialForm: FormValues = {
  streetAddress: "",
  city: "",
  zipCode: "",
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});
const detailedMoneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
});
const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function PriceEstimationScreen({
  estimatePrice,
}: PriceEstimationScreenProps): React.JSX.Element {
  const [form, setForm] = useState<FormValues>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState<PriceEstimationInput | null>(null);
  const [snapshot, setSnapshot] = useState<ResultSnapshot | null>(null);
  const [failure, setFailure] = useState<FailureState | null>(null);
  const requestGeneration = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const resultSummaryRef = useRef<HTMLElement>(null);
  const errorSummaryRef = useRef<HTMLElement>(null);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
      activeController.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (failure !== null) errorSummaryRef.current?.focus();
    else if (snapshot !== null) resultSummaryRef.current?.focus();
  }, [failure, snapshot]);

  const resultIsStale = useMemo(
    () => snapshot !== null && !formMatchesInput(form, snapshot.input),
    [form, snapshot],
  );

  const updateField = (field: FormField, value: string): void => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (current[field] === undefined) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFailure(null);
  };

  const startRequest = async (input: PriceEstimationInput): Promise<void> => {
    if (activeController.current !== null) return;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    const controller = new AbortController();
    activeController.current = controller;
    setSubmitting(input);
    setFailure(null);
    setSnapshot(null);
    try {
      const result = await estimatePrice(input, controller.signal);
      if (requestGeneration.current === generation && !controller.signal.aborted) {
        setSnapshot({ input, result });
      }
    } catch (error) {
      if (requestGeneration.current !== generation || controller.signal.aborted) {
        return;
      }
      if (error instanceof SessionAuthenticationRequiredError) return;
      if (error instanceof PriceEstimationValidationError) {
        const field = error.field === "form" ? null : error.field;
        if (field !== null) {
          setFieldErrors({ [field]: fieldErrorMessage(field) });
        } else {
          setFailure({ code: "unexpected", input });
        }
      } else {
        setFailure({
          code:
            error instanceof PriceEstimationRequestError
              ? error.code
              : "unexpected",
          input,
        });
      }
    } finally {
      if (requestGeneration.current === generation) {
        activeController.current = null;
        setSubmitting(null);
      }
    }
  };

  const submit = (mode: PriceDecisionMode): void => {
    if (submitting !== null) return;
    const validation = validateForm(form);
    setFieldErrors(validation.errors);
    if (validation.input === null) return;
    void startRequest({ ...validation.input, mode });
  };

  return (
    <main className="workspace price-estimation-workspace">
      <div className="workspace-heading">
        <div>
          <p className="section-label">Decision assistant</p>
          <h1>Price Estimation</h1>
          <p className="workspace-description">
            Compare recorded sales and observable market signals before setting a price.
          </p>
        </div>
        <div className="price-estimation-scope">
          <span>California properties only</span>
          <small>No result history is saved</small>
        </div>
      </div>

      <form
        className="price-estimation-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit("offer");
        }}
      >
        <div className="price-estimation-form-heading">
          <Building2 aria-hidden="true" size={20} />
          <div>
            <h2>Property address</h2>
            <p>Enter the subject property. State is supplied as CA.</p>
          </div>
        </div>
        <div className="price-estimation-fields">
          <FormField
            id="price-street-address"
            label="Street number and name"
            value={form.streetAddress}
            error={fieldErrors.streetAddress}
            autoComplete="address-line1"
            maxLength={160}
            placeholder="100 Main St"
            disabled={submitting !== null}
            onChange={(value) => updateField("streetAddress", value)}
          />
          <FormField
            id="price-city"
            label="City"
            value={form.city}
            error={fieldErrors.city}
            autoComplete="address-level2"
            maxLength={100}
            placeholder="Irvine"
            disabled={submitting !== null}
            onChange={(value) => updateField("city", value)}
          />
          <FormField
            id="price-zip-code"
            label="ZIP code"
            value={form.zipCode}
            error={fieldErrors.zipCode}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={5}
            placeholder="92618"
            disabled={submitting !== null}
            onChange={(value) => updateField("zipCode", value)}
          />
        </div>
        <div className="price-estimation-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={submitting !== null}
          >
            {submitting?.mode === "offer" ? (
              <LoaderCircle className="spin" aria-hidden="true" size={17} />
            ) : (
              <DollarSign aria-hidden="true" size={17} />
            )}
            {submitting?.mode === "offer" ? "Estimating offer" : "Set Offer Price"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={submitting !== null}
            onClick={() => submit("listing")}
          >
            {submitting?.mode === "listing" ? (
              <LoaderCircle className="spin" aria-hidden="true" size={17} />
            ) : (
              <BarChart3 aria-hidden="true" size={17} />
            )}
            {submitting?.mode === "listing"
              ? "Estimating listing"
              : "Set Listing Price"}
          </button>
        </div>
      </form>

      {submitting !== null ? (
        <div className="price-estimation-loading" role="status" aria-live="polite">
          <LoaderCircle className="spin" aria-hidden="true" size={20} />
          <div>
            <strong>Analyzing recorded sales and market evidence</strong>
            <span>This can take up to about a minute.</span>
          </div>
        </div>
      ) : null}

      {failure !== null && submitting === null ? (
        <PriceEstimationFailure
          summaryRef={errorSummaryRef}
          failure={failure}
          onRetry={() => void startRequest(failure.input)}
        />
      ) : null}

      {snapshot !== null ? (
        <PriceEstimationResults
          summaryRef={resultSummaryRef}
          snapshot={snapshot}
          stale={resultIsStale}
        />
      ) : null}
    </main>
  );
}

function FormField({
  id,
  label,
  value,
  error,
  onChange,
  ...inputProps
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange">) {
  const errorId = `${id}-error`;
  return (
    <div className={`price-estimation-field${error === undefined ? "" : " is-invalid"}`}>
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        id={id}
        value={value}
        aria-describedby={error === undefined ? undefined : errorId}
        aria-invalid={error === undefined ? undefined : true}
        onChange={(event) => onChange(event.target.value)}
      />
      {error === undefined ? null : (
        <p className="price-estimation-field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

function PriceEstimationFailure({
  failure,
  onRetry,
  summaryRef,
}: {
  readonly failure: FailureState;
  readonly onRetry: () => void;
  readonly summaryRef: React.Ref<HTMLElement>;
}): React.JSX.Element {
  const copy = failureCopy(failure.code);
  return (
    <section
      className="price-estimation-failure"
      ref={summaryRef}
      tabIndex={-1}
      role="alert"
      aria-labelledby="price-estimation-error-title"
    >
      <AlertCircle aria-hidden="true" size={24} />
      <div>
        <h2 id="price-estimation-error-title">{copy.title}</h2>
        <p>{copy.message}</p>
        <button className="secondary-button" type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" size={16} />
          Retry {failure.input.mode === "offer" ? "Offer" : "Listing"} Estimate
        </button>
      </div>
    </section>
  );
}

function PriceEstimationResults({
  snapshot,
  stale,
  summaryRef,
}: {
  readonly snapshot: ResultSnapshot;
  readonly stale: boolean;
  readonly summaryRef: React.Ref<HTMLElement>;
}): React.JSX.Element {
  const { result } = snapshot;
  const recommendationLabel =
    result.mode === "offer" ? "Recommended offer" : "Recommended listing price";
  const rangeLabel =
    result.mode === "offer" ? "Reasonable offer range" : "Expected market-value range";
  return (
    <section
      className="price-estimation-results"
      ref={summaryRef}
      tabIndex={-1}
      aria-labelledby="price-estimation-result-title"
    >
      {stale ? (
        <div className="price-estimation-stale" role="status">
          <Info aria-hidden="true" size={17} />
          Inputs changed. This result remains based on {snapshot.input.streetAddress}, {snapshot.input.city}, CA {snapshot.input.zipCode}.
        </div>
      ) : null}

      <div className="price-estimation-result-heading">
        <div className="price-property-heading">
          <span aria-hidden="true"><Building2 size={20} /></span>
          <div>
            <p className="section-label">Subject property</p>
            <h2 id="price-estimation-result-title">{result.subject.formattedAddress}</h2>
          </div>
        </div>
        <span className={`price-confidence confidence-${result.recommendation.confidence}`}>
          Confidence: {capitalize(result.recommendation.confidence)}
        </span>
      </div>

      <dl className="price-subject-facts">
        <Fact label="Property type" value={result.subject.propertyType} />
        <Fact label="Beds / baths" value={`${displayValue(result.subject.bedrooms)} / ${displayValue(result.subject.bathrooms)}`} />
        <Fact label="Living area" value={formatArea(result.subject.squareFootage)} />
        <Fact label="Lot size" value={formatArea(result.subject.lotSize)} />
        <Fact label="Year built" value={displayValue(result.subject.yearBuilt)} />
      </dl>

      <div className="price-recommendation-panel">
        <div>
          <span>{recommendationLabel}</span>
          <strong>{formatMoney(result.recommendation.recommendedPrice)}</strong>
        </div>
        <dl>
          <Fact label={rangeLabel} value={`${formatMoney(result.recommendation.rangeLow)} – ${formatMoney(result.recommendation.rangeHigh)}`} />
          <Fact label="Comparable-sales anchor" value={formatMoney(result.recommendation.marketValueAnchor)} />
          <Fact label="Data as of" value={formatTimestamp(result.recommendation.dataAsOf)} />
        </dl>
      </div>

      {result.strategy.enhancementUnavailable ? (
        <div className="price-fallback-notice" role="status">
          <CheckCircle2 aria-hidden="true" size={18} />
          <div>
            <strong>Valuation completed with deterministic guidance</strong>
            <span>AI narrative enhancement was unavailable; the verified price calculation is unchanged.</span>
          </div>
        </div>
      ) : null}

      <ResultSection icon={<Lightbulb size={19} />} title="Why this price">
        <div className="price-reasons">
          {result.reasons.map((reason) => (
            <article key={`${reason.title}-${reason.evidenceIds.join("-")}`}>
              <h4>{reason.title}</h4>
              <p>{reason.detail}</p>
            </article>
          ))}
        </div>
      </ResultSection>

      <ResultSection icon={<Scale size={19} />} title="Recommended strategy">
        <p className="price-strategy-summary">{result.strategy.summary}</p>
        <div className="price-scenarios">
          {result.scenarios.map((scenario, index) => (
            <article key={scenario.kind} className={scenario.kind === "recommended" || scenario.kind === "balanced" ? "is-recommended" : ""}>
              <div>
                <span>{scenario.label}</span>
                <strong>{formatMoney(scenario.price)}</strong>
              </div>
              <p>{scenario.tradeoff}</p>
              <small>{result.strategy.steps[index]?.guidance}</small>
            </article>
          ))}
        </div>
      </ResultSection>

      <ResultSection icon={<Building2 size={19} />} title="Comparable recorded sales">
        <div className="price-comparables-scroll" tabIndex={0} aria-label="Scrollable comparable sales table">
          <table className="price-comparables-table">
            <caption>Selected recorded sales used in this recommendation</caption>
            <thead>
              <tr>
                <th scope="col">Property</th>
                <th scope="col">Recorded sale</th>
                <th scope="col">Sale date</th>
                <th scope="col">Beds / baths</th>
                <th scope="col">Living area</th>
                <th scope="col">Price / sq ft</th>
                <th scope="col">Distance</th>
                <th scope="col">Similarity</th>
              </tr>
            </thead>
            <tbody>
              {result.comparables.map((comparable) => (
                <tr key={comparable.evidenceId}>
                  <td>
                    <strong>{comparable.formattedAddress}</strong>
                    <span>{comparable.propertyType} · Built {displayValue(comparable.yearBuilt)} · Lot {formatArea(comparable.lotSize)}</span>
                  </td>
                  <td>{formatMoney(comparable.salePrice)}</td>
                  <td>{formatDate(comparable.saleDate)}</td>
                  <td>{displayValue(comparable.bedrooms)} / {displayValue(comparable.bathrooms)}</td>
                  <td>{formatArea(comparable.squareFootage)}</td>
                  <td>{comparable.pricePerSquareFoot === null ? "Not available" : detailedMoneyFormatter.format(comparable.pricePerSquareFoot)}</td>
                  <td>{numberFormatter.format(comparable.distanceMiles)} mi</td>
                  <td>{Math.round(comparable.similarityScore * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ResultSection>

      <ResultSection icon={<Clock3 size={19} />} title="Market context and freshness">
        <div className="price-context-grid">
          <ContextCard title="Recorded sales" copy={`${result.comparables.length} selected sales; dates shown in the table.`} />
          <ContextCard
            title="AVM calibration"
            copy={result.context.avm === null
              ? "Not available for this analysis."
              : `${result.context.avm.label}: ${formatMoney(result.context.avm.estimate)} (${formatMoney(result.context.avm.rangeLow)} – ${formatMoney(result.context.avm.rangeHigh)}), retrieved ${formatTimestamp(result.context.avm.retrievedAt)}.`}
          />
          <ContextCard
            title="ZIP listing market"
            copy={result.context.market === null
              ? "Not available for this analysis."
              : marketContextCopy(result.context.market)}
          />
          <ContextCard
            title="Observable listing signals"
            copy={result.context.listingSignals === null
              ? "No verified subject-listing signal was available."
              : listingSignalCopy(result.context.listingSignals, result.recommendation.dataAsOf)}
          />
        </div>
      </ResultSection>

      <ResultSection icon={<AlertCircle size={19} />} title="Limitations">
        {result.limitations.length === 0 ? (
          <p className="price-no-limitations">No additional data limitation was reported.</p>
        ) : (
          <ul className="price-limitations">
            {result.limitations.map((limitation) => (
              <li key={limitation.code}>{limitation.message}</li>
            ))}
          </ul>
        )}
        <div className="price-decision-disclosure">
          <Sparkles aria-hidden="true" size={17} />
          This is a decision aid, not an appraisal or guarantee of sale price. Confirm property condition, renovations, and current local conditions before acting.
        </div>
      </ResultSection>
    </section>
  );
}

function ResultSection({
  icon,
  title,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="price-result-section">
      <div className="price-result-section-heading">
        <span aria-hidden="true">{icon}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ContextCard({ title, copy }: { readonly title: string; readonly copy: string }) {
  return (
    <article>
      <h4>{title}</h4>
      <p>{copy}</p>
    </article>
  );
}

function validateForm(form: FormValues): {
  readonly input: Omit<PriceEstimationInput, "mode"> | null;
  readonly errors: FieldErrors;
} {
  try {
    const address = normalizePriceDecisionAddress(form);
    return {
      input: {
        streetAddress: address.streetAddress,
        city: address.city,
        zipCode: address.zipCode,
      },
      errors: {},
    };
  } catch (error) {
    const field =
      error instanceof InvalidPriceDecisionAddressError && error.field !== "address"
        ? error.field
        : firstInvalidField(form);
    return { input: null, errors: { [field]: fieldErrorMessage(field) } };
  }
}

function firstInvalidField(form: FormValues): FormField {
  if (form.streetAddress.trim().length === 0) return "streetAddress";
  if (form.city.trim().length === 0) return "city";
  return "zipCode";
}

function fieldErrorMessage(field: FormField): string {
  if (field === "streetAddress") return "Enter a street number and street name without the city, state, or ZIP.";
  if (field === "city") return "Enter a California city name without the state or ZIP.";
  return "Enter a five-digit ZIP code.";
}

function formMatchesInput(form: FormValues, input: PriceEstimationInput): boolean {
  try {
    const address = normalizePriceDecisionAddress(form);
    return (
      address.streetAddress === input.streetAddress &&
      address.city === input.city &&
      address.zipCode === input.zipCode
    );
  } catch {
    return false;
  }
}

function failureCopy(code: PriceEstimationFailureCode): { title: string; message: string } {
  switch (code) {
    case "invalid-request":
      return { title: "Address request was not accepted", message: "Review the property address and try again." };
    case "property-not-found":
      return { title: "Property not found", message: "Check the address and ZIP code, then try again." };
    case "insufficient-evidence":
      return { title: "Not enough valuation evidence", message: "The available recorded sales cannot support a reliable recommendation for this property." };
    case "in-progress":
      return { title: "Another estimate is still running", message: "Wait for the active estimate to finish, then retry this request." };
    case "rate-limited":
      return { title: "Estimate limit reached", message: "Too many estimates were requested recently. Try again after the request window resets." };
    case "evidence-unavailable":
      return { title: "Property evidence unavailable", message: "Required market evidence could not be verified. Try again later." };
    case "service-unavailable":
      return { title: "Price Estimation unavailable", message: "The pricing service is not currently configured or available." };
    case "timed-out":
      return { title: "Price Estimation timed out", message: "The evidence request took too long. Retry when the provider is responsive." };
    case "unexpected":
      return { title: "Price Estimation could not be completed", message: "The response could not be verified. Try again without changing the address." };
  }
}

function marketContextCopy(market: NonNullable<PriceEstimationResult["context"]["market"]>): string {
  const parts = [
    market.medianListPrice === null ? null : `median list price ${formatMoney(market.medianListPrice)}`,
    market.medianPricePerSquareFoot === null ? null : `median ${formatMoney(market.medianPricePerSquareFoot)}/sq ft`,
    market.medianDaysOnMarket === null ? null : `median ${numberFormatter.format(market.medianDaysOnMarket)} days on market`,
    market.totalListings === null ? null : `${numberFormatter.format(market.totalListings)} total listings`,
    market.newListings === null ? null : `${numberFormatter.format(market.newListings)} new listings`,
  ].filter((value): value is string => value !== null);
  return `ZIP ${market.zipCode}: ${parts.join(", ")}. Updated ${formatDate(market.lastUpdatedDate)}.`;
}

function listingSignalCopy(
  signals: NonNullable<PriceEstimationResult["context"]["listingSignals"]>,
  dataAsOf: string,
): string {
  const price = signals.currentListPrice === null ? "list price unavailable" : `current list price ${formatMoney(signals.currentListPrice)}`;
  const days = signals.daysOnMarket === null ? "days on market unavailable" : `${signals.daysOnMarket} days on market`;
  return `${price}; ${days}; ${signals.priceReductionCount} verified price reduction${signals.priceReductionCount === 1 ? "" : "s"} (${signals.totalReductionPercent}% cumulative). Observable flexibility: ${capitalize(signals.flexibilitySignal)}. This is an inference from listing activity, evaluated ${formatTimestamp(dataAsOf)}.`;
}

function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}

function formatArea(value: number | null): string {
  return value === null ? "Not available" : `${numberFormatter.format(value)} sq ft`;
}

function displayValue(value: number | null): string {
  return value === null ? "Not available" : numberFormatter.format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
