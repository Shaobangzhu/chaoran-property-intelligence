import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Clipboard,
  Download,
  FileText,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ListingsLoader } from "./ListingsScreen.js";
import type { ListingSummary } from "./listingsApi.js";
import {
  ShowingListChangedError,
  type CurrentShowingList,
  type ReviewShowingListInput,
  type SaveShowingListInput,
  type ShowingListArtifactDownload,
  type ShowingListDraft,
} from "./showingListApi.js";

export type CurrentShowingListLoader = (
  signal: AbortSignal,
) => Promise<CurrentShowingList | null>;
export type CurrentShowingListSaver = (
  input: SaveShowingListInput,
) => Promise<CurrentShowingList>;
export type CurrentShowingListReviewer = (
  input: ReviewShowingListInput,
) => Promise<CurrentShowingList>;
export type CurrentShowingListDownloader = () => Promise<ShowingListArtifactDownload>;

interface ShowingListScreenProps {
  copyText?: (value: string) => Promise<void>;
  downloadArtifact: CurrentShowingListDownloader;
  loadCurrent: CurrentShowingListLoader;
  loadListings: ListingsLoader;
  markReviewed: CurrentShowingListReviewer;
  saveDraft: CurrentShowingListSaver;
  saveFile?: (download: ShowingListArtifactDownload) => void;
}

type ScreenState =
  | { status: "loading" }
  | {
      status: "ready";
      current: CurrentShowingList | null;
      draft: ShowingListDraft | null;
      listings: ListingSummary[];
    }
  | { status: "error" };

type Operation = "idle" | "saving" | "reviewing" | "copying" | "downloading";

export function ShowingListScreen({
  copyText = copyToClipboard,
  downloadArtifact,
  loadCurrent,
  loadListings,
  markReviewed,
  saveDraft,
  saveFile = saveBrowserFile,
}: ShowingListScreenProps): React.JSX.Element {
  const [requestNumber, setRequestNumber] = useState(0);
  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [operation, setOperation] = useState<Operation>("idle");
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error" | "conflict";
    message: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    setFeedback(null);
    void Promise.all([
      loadCurrent(controller.signal),
      loadListings(controller.signal),
    ]).then(
      ([current, listings]) => {
        if (!controller.signal.aborted) {
          setState({
            current,
            draft: current === null ? null : cloneDraft(current.draft),
            listings,
            status: "ready",
          });
        }
      },
      () => {
        if (!controller.signal.aborted) setState({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [loadCurrent, loadListings, requestNumber]);

  const listingById = useMemo(
    () =>
      new Map(
        state.status === "ready"
          ? state.listings.map((listing) => [listing.id, listing])
          : [],
      ),
    [state],
  );
  const isDirty =
    state.status === "ready" &&
    state.current !== null &&
    state.draft !== null &&
    JSON.stringify(state.current.draft) !== JSON.stringify(state.draft);
  const isBusy = operation !== "idle";

  const replaceDraft = (draft: ShowingListDraft): void => {
    setState((current) =>
      current.status === "ready" ? { ...current, draft } : current,
    );
    setFeedback(null);
  };

  const handleSave = async (): Promise<void> => {
    if (
      state.status !== "ready" ||
      state.current === null ||
      state.draft === null ||
      isBusy
    ) return;
    setOperation("saving");
    setFeedback(null);
    try {
      const current = await saveDraft({
        draft: state.draft,
        expectedUpdatedAt: state.current.updatedAt,
        generationId: state.current.generationId,
      });
      setState({
        ...state,
        current,
        draft: cloneDraft(current.draft),
      });
      setFeedback({ kind: "success", message: "Draft saved." });
    } catch (error) {
      setFeedback(
        error instanceof ShowingListChangedError
          ? {
              kind: "conflict",
              message: "A newer draft is available. Reload before editing.",
            }
          : { kind: "error", message: "Draft could not be saved." },
      );
    } finally {
      setOperation("idle");
    }
  };

  const handleReview = async (): Promise<void> => {
    if (
      state.status !== "ready" ||
      state.current === null ||
      isDirty ||
      isBusy
    ) return;
    setOperation("reviewing");
    setFeedback(null);
    try {
      const current = await markReviewed({
        expectedUpdatedAt: state.current.updatedAt,
        generationId: state.current.generationId,
      });
      setState({ ...state, current, draft: cloneDraft(current.draft) });
      setFeedback({ kind: "success", message: "Draft marked reviewed." });
    } catch (error) {
      setFeedback(
        error instanceof ShowingListChangedError
          ? {
              kind: "conflict",
              message: "A newer draft is available. Reload before reviewing.",
            }
          : { kind: "error", message: "Review status could not be updated." },
      );
    } finally {
      setOperation("idle");
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (state.status !== "ready" || state.draft === null || isBusy) return;
    setOperation("copying");
    setFeedback(null);
    try {
      await copyText(formatDraftForCopy(state.draft, listingById));
      setFeedback({ kind: "success", message: "Draft copied." });
    } catch {
      setFeedback({ kind: "error", message: "Draft could not be copied." });
    } finally {
      setOperation("idle");
    }
  };

  const handleDownload = async (): Promise<void> => {
    if (state.status !== "ready" || state.current === null || isBusy) return;
    setOperation("downloading");
    setFeedback(null);
    try {
      saveFile(await downloadArtifact());
      setFeedback({ kind: "success", message: "PDF download started." });
    } catch (error) {
      setFeedback(
        error instanceof ShowingListChangedError
          ? {
              kind: "conflict",
              message: "The generated PDF changed. Reload before downloading.",
            }
          : { kind: "error", message: "PDF download is unavailable." },
      );
    } finally {
      setOperation("idle");
    }
  };

  return (
    <main className="workspace showing-list-workspace">
      <section className="workspace-heading" aria-labelledby="showing-list-title">
        <div>
          <p className="section-label">Agent review workspace</p>
          <h1 id="showing-list-title">Showing List</h1>
          <p className="workspace-description">
            Review the current weekly draft before using it with a client.
          </p>
        </div>
        {state.status === "ready" && state.current !== null ? (
          <div className="showing-list-statuses" aria-label="Draft status">
            <span className={`review-status status-${state.current.status}`}>
              {state.current.status === "reviewed" ? "Reviewed" : "Draft"}
            </span>
            {isDirty ? <span className="unsaved-status">Unsaved changes</span> : null}
          </div>
        ) : null}
      </section>

      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? (
        <ErrorState onRetry={() => setRequestNumber((value) => value + 1)} />
      ) : null}
      {state.status === "ready" && state.current === null ? <EmptyState /> : null}
      {state.status === "ready" && state.current !== null && state.draft !== null ? (
        <>
          <div className="showing-list-command-bar">
            <div className="showing-list-meta">
              <span>{formatShowingDate(state.current.preferences.showingDate)}</span>
              <span>{state.current.preferences.clientDisplayName ?? "Client not named"}</span>
              <span>{formatGeneratedAt(state.current.generatedAt)}</span>
            </div>
            <div className="showing-list-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isBusy}
                onClick={() => void handleCopy()}
              >
                <Clipboard aria-hidden="true" size={16} />
                Copy
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={isBusy}
                onClick={() => void handleDownload()}
              >
                {operation === "downloading" ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={16} />
                ) : (
                  <Download aria-hidden="true" size={16} />
                )}
                PDF snapshot
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={isBusy || !isDirty}
                onClick={() => void handleSave()}
              >
                {operation === "saving" ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={16} />
                ) : (
                  <Save aria-hidden="true" size={16} />
                )}
                Save draft
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={
                  isBusy || isDirty || state.current.status === "reviewed"
                }
                onClick={() => void handleReview()}
              >
                {operation === "reviewing" ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={16} />
                ) : (
                  <Check aria-hidden="true" size={16} />
                )}
                Mark reviewed
              </button>
            </div>
          </div>

          <p className="snapshot-boundary">
            <FileText aria-hidden="true" size={16} />
            The PDF is the generated snapshot for this weekly draft. Saved text edits do not rewrite it.
          </p>

          {feedback === null ? null : (
            <div className={`showing-list-feedback feedback-${feedback.kind}`} role={feedback.kind === "success" ? "status" : "alert"}>
              {feedback.kind === "success" ? (
                <Check aria-hidden="true" size={16} />
              ) : (
                <AlertCircle aria-hidden="true" size={16} />
              )}
              <span>{feedback.message}</span>
              {feedback.kind === "conflict" ? (
                <button
                  type="button"
                  className="feedback-reload"
                  onClick={() => setRequestNumber((value) => value + 1)}
                >
                  <RefreshCw aria-hidden="true" size={15} />
                  Reload
                </button>
              ) : null}
            </div>
          )}

          <section className="showing-list-editor" aria-label="Showing List editor">
            <div className="showing-list-copy-fields">
              <EditorField label="Title" htmlFor="showing-list-draft-title">
                <input
                  id="showing-list-draft-title"
                  maxLength={120}
                  required
                  value={state.draft.title}
                  onChange={(event) =>
                    replaceDraft({ ...state.draft!, title: event.target.value })
                  }
                />
              </EditorField>
              <EditorField label="Summary" htmlFor="showing-list-summary">
                <textarea
                  id="showing-list-summary"
                  maxLength={1200}
                  required
                  value={state.draft.summary}
                  onChange={(event) =>
                    replaceDraft({ ...state.draft!, summary: event.target.value })
                  }
                />
              </EditorField>
              <EditorField label="Client message" htmlFor="showing-list-client-message">
                <textarea
                  id="showing-list-client-message"
                  maxLength={2000}
                  required
                  value={state.draft.clientMessage}
                  onChange={(event) =>
                    replaceDraft({ ...state.draft!, clientMessage: event.target.value })
                  }
                />
              </EditorField>
              {state.draft.reviewWarnings.length > 0 ? (
                <div className="review-warning-band">
                  <AlertCircle aria-hidden="true" size={18} />
                  <div>
                    <strong>Review warnings</strong>
                    <ul>
                      {state.draft.reviewWarnings.map((warning, index) => (
                        <li key={`${index}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="showing-stop-list">
              {state.draft.stops.map((stop, index) => {
                const listing = listingById.get(stop.listingId);
                return (
                  <article className="showing-stop" key={stop.listingId}>
                    <header className="showing-stop-heading">
                      <span className="stop-number">{index + 1}</span>
                      <div>
                        <h2>{listing?.addressLine1 ?? "Listing unavailable"}</h2>
                        <p>{listing?.formattedAddress ?? stop.listingId}</p>
                      </div>
                      <div className="stop-order-actions">
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`Move ${listing?.addressLine1 ?? `stop ${index + 1}`} up`}
                          title="Move up"
                          disabled={index === 0 || isBusy}
                          onClick={() => replaceDraft(moveStop(state.draft!, index, index - 1))}
                        >
                          <ArrowUp aria-hidden="true" size={17} />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`Move ${listing?.addressLine1 ?? `stop ${index + 1}`} down`}
                          title="Move down"
                          disabled={index === state.draft!.stops.length - 1 || isBusy}
                          onClick={() => replaceDraft(moveStop(state.draft!, index, index + 1))}
                        >
                          <ArrowDown aria-hidden="true" size={17} />
                        </button>
                      </div>
                    </header>
                    <div className="showing-stop-fields">
                      <EditorField label="Order rationale" htmlFor={`order-reason-${stop.listingId}`}>
                        <textarea
                          id={`order-reason-${stop.listingId}`}
                          maxLength={400}
                          required
                          value={stop.orderReason}
                          onChange={(event) =>
                            replaceDraft(updateStop(state.draft!, index, { orderReason: event.target.value }))
                          }
                        />
                      </EditorField>
                      <EditorField label="Highlights, one per line" htmlFor={`highlights-${stop.listingId}`}>
                        <textarea
                          id={`highlights-${stop.listingId}`}
                          value={stop.highlights.join("\n")}
                          onChange={(event) =>
                            replaceDraft(updateStop(state.draft!, index, { highlights: lines(event.target.value, 4) }))
                          }
                        />
                      </EditorField>
                      <EditorField label="Considerations, one per line" htmlFor={`considerations-${stop.listingId}`}>
                        <textarea
                          id={`considerations-${stop.listingId}`}
                          value={stop.considerations.join("\n")}
                          onChange={(event) =>
                            replaceDraft(updateStop(state.draft!, index, { considerations: lines(event.target.value, 4) }))
                          }
                        />
                      </EditorField>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function EditorField({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}): React.JSX.Element {
  return (
    <div className="showing-editor-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="message-state read-state" role="status">
      <LoaderCircle className="spin" aria-hidden="true" size={25} />
      <h2>Loading current draft</h2>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="message-state error-state read-state" role="alert">
      <AlertCircle aria-hidden="true" size={28} />
      <h2>Showing List unavailable</h2>
      <p>The current review workspace could not be loaded.</p>
      <button className="retry-button" type="button" onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={16} />
        Retry
      </button>
    </div>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="message-state read-state">
      <Inbox aria-hidden="true" size={30} />
      <h2>No current Showing List</h2>
      <p>The weekly publishing job has not created a draft yet.</p>
    </div>
  );
}

function cloneDraft(draft: ShowingListDraft): ShowingListDraft {
  return {
    ...draft,
    reviewWarnings: [...draft.reviewWarnings],
    stops: draft.stops.map((stop) => ({
      ...stop,
      considerations: [...stop.considerations],
      highlights: [...stop.highlights],
    })),
  };
}

function updateStop(
  draft: ShowingListDraft,
  index: number,
  patch: Partial<ShowingListDraft["stops"][number]>,
): ShowingListDraft {
  return {
    ...draft,
    stops: draft.stops.map((stop, currentIndex) =>
      currentIndex === index ? { ...stop, ...patch } : stop,
    ),
  };
}

function moveStop(
  draft: ShowingListDraft,
  from: number,
  to: number,
): ShowingListDraft {
  const stops = draft.stops.map((stop) => ({ ...stop }));
  const [moved] = stops.splice(from, 1);
  if (moved === undefined) return draft;
  stops.splice(to, 0, moved);
  return {
    ...draft,
    stops: stops.map((stop, index) => ({ ...stop, proposedOrder: index + 1 })),
  };
}

function lines(value: string, maximum: number): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, maximum);
}

function formatDraftForCopy(
  draft: ShowingListDraft,
  listings: ReadonlyMap<string, ListingSummary>,
): string {
  const sections = draft.stops.map((stop, index) => {
    const listing = listings.get(stop.listingId);
    return [
      `${index + 1}. ${listing?.formattedAddress ?? stop.listingId}`,
      stop.orderReason,
      ...stop.highlights.map((item) => `Highlight: ${item}`),
      ...stop.considerations.map((item) => `Consideration: ${item}`),
    ].join("\n");
  });
  return [
    draft.title,
    draft.summary,
    ...sections,
    "Client message",
    draft.clientMessage,
  ].join("\n\n");
}

function formatShowingDate(value: string | null): string {
  return value === null ? "Showing date not set" : `Showing ${value}`;
}

function formatGeneratedAt(value: string): string {
  return `Generated ${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))}`;
}

async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function saveBrowserFile(download: ShowingListArtifactDownload): void {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
