import {
  AlertCircle,
  Building2,
  ClipboardList,
  ListFilter,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
} from "lucide-react";
import {
  type ComponentType,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  ListingsScreen,
  type ListingsLoader,
  type ListingsMapViewProps,
  type ManualListingArchiver,
} from "./ListingsScreen.js";
import type {
  ManualListingCreator,
  ManualListingUpdater,
} from "./ManualListingForm.js";
import {
  SessionAuthenticationRequiredError,
  archiveManualListing,
  createManualListing,
  fetchListings,
  updateManualListing,
} from "./listingsApi.js";
import {
  ShowingListScreen,
  type CurrentShowingListDownloader,
  type CurrentShowingListLoader,
  type CurrentShowingListReviewer,
  type CurrentShowingListSaver,
} from "./ShowingListScreen.js";
import {
  downloadCurrentShowingList,
  fetchCurrentShowingList,
  markCurrentShowingListReviewed,
  saveCurrentShowingList,
} from "./showingListApi.js";
import {
  SearchCriteriaScreen,
  type ListingSearchCriteriaLoader,
  type ListingSearchCriteriaSaver,
} from "./SearchCriteriaScreen.js";
import {
  fetchListingSearchCriteria,
  updateListingSearchCriteria,
} from "./listingSearchCriteriaApi.js";
import {
  InvalidCredentialsError,
  LoginRateLimitedError,
  type AuthenticatedUser,
  type SessionClient,
  sessionClient as defaultSessionClient,
} from "./sessionApi.js";

const defaultLoadListings: ListingsLoader = (signal) =>
  fetchListings({ signal });
const defaultCreateListing: ManualListingCreator = (draft) =>
  createManualListing(draft);
const defaultUpdateListing: ManualListingUpdater = (listingId, patch) =>
  updateManualListing(listingId, patch);
const defaultArchiveListing: ManualListingArchiver = (listingId) =>
  archiveManualListing(listingId);
const defaultLoadCurrentShowingList: CurrentShowingListLoader = (signal) =>
  fetchCurrentShowingList({ signal });
const defaultSaveCurrentShowingList: CurrentShowingListSaver = (input) =>
  saveCurrentShowingList(input);
const defaultReviewCurrentShowingList: CurrentShowingListReviewer = (input) =>
  markCurrentShowingListReviewed(input);
const defaultDownloadCurrentShowingList: CurrentShowingListDownloader = () =>
  downloadCurrentShowingList();
const defaultLoadListingSearchCriteria: ListingSearchCriteriaLoader = (signal) =>
  fetchListingSearchCriteria({ signal });
const defaultSaveListingSearchCriteria: ListingSearchCriteriaSaver = (input) =>
  updateListingSearchCriteria(input);

type AppState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "authenticated"; user: AuthenticatedUser; logoutError: boolean }
  | { status: "error" };

interface AppProps {
  archiveListing?: ManualListingArchiver;
  createListing?: ManualListingCreator;
  downloadShowingList?: CurrentShowingListDownloader;
  loadCurrentShowingList?: CurrentShowingListLoader;
  loadSearchCriteria?: ListingSearchCriteriaLoader;
  markShowingListReviewed?: CurrentShowingListReviewer;
  sessionClient?: SessionClient;
  loadListings?: ListingsLoader;
  mapView?: ComponentType<ListingsMapViewProps>;
  saveShowingList?: CurrentShowingListSaver;
  saveSearchCriteria?: ListingSearchCriteriaSaver;
  updateListing?: ManualListingUpdater;
}

export function App({
  archiveListing = defaultArchiveListing,
  createListing = defaultCreateListing,
  downloadShowingList = defaultDownloadCurrentShowingList,
  loadCurrentShowingList = defaultLoadCurrentShowingList,
  loadSearchCriteria = defaultLoadListingSearchCriteria,
  markShowingListReviewed = defaultReviewCurrentShowingList,
  sessionClient = defaultSessionClient,
  loadListings = defaultLoadListings,
  mapView,
  saveShowingList = defaultSaveCurrentShowingList,
  saveSearchCriteria = defaultSaveListingSearchCriteria,
  updateListing = defaultUpdateListing,
}: AppProps = {}): React.JSX.Element {
  const [state, setState] = useState<AppState>({ status: "checking" });
  const [sessionRequest, setSessionRequest] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<
    "listings" | "search-criteria" | "showing-list"
  >("listings");

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "checking" });

    void sessionClient.getCurrentUser(controller.signal).then(
      (user) => {
        if (!controller.signal.aborted) {
          setState(
            user === null
              ? { status: "signed-out" }
              : { logoutError: false, status: "authenticated", user },
          );
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      },
    );

    return () => controller.abort();
  }, [sessionClient, sessionRequest]);

  const protectedListingsLoader = useCallback<ListingsLoader>(
    async (signal) => {
      try {
        return await loadListings(signal);
      } catch (error) {
        if (error instanceof SessionAuthenticationRequiredError) {
          setState({ status: "signed-out" });
        }
        throw error;
      }
    },
    [loadListings],
  );

  const protectedListingCreator = useCallback<ManualListingCreator>(
    async (draft) => {
      try {
        return await createListing(draft);
      } catch (error) {
        if (error instanceof SessionAuthenticationRequiredError) {
          setState({ status: "signed-out" });
        }
        throw error;
      }
    },
    [createListing],
  );

  const protectedListingUpdater = useCallback<ManualListingUpdater>(
    async (listingId, patch) => {
      try {
        return await updateListing(listingId, patch);
      } catch (error) {
        if (error instanceof SessionAuthenticationRequiredError) {
          setState({ status: "signed-out" });
        }
        throw error;
      }
    },
    [updateListing],
  );

  const protectedListingArchiver = useCallback<ManualListingArchiver>(
    async (listingId) => {
      try {
        await archiveListing(listingId);
      } catch (error) {
        if (error instanceof SessionAuthenticationRequiredError) {
          setState({ status: "signed-out" });
        }
        throw error;
      }
    },
    [archiveListing],
  );

  const protectedShowingListLoader = useCallback<CurrentShowingListLoader>(
    async (signal) => {
      try {
        return await loadCurrentShowingList(signal);
      } catch (error) {
        if (error instanceof SessionAuthenticationRequiredError) {
          setState({ status: "signed-out" });
        }
        throw error;
      }
    },
    [loadCurrentShowingList],
  );

  const protectedShowingListSaver = useCallback<CurrentShowingListSaver>(
    async (input) => {
      try {
        return await saveShowingList(input);
      } catch (error) {
        if (error instanceof SessionAuthenticationRequiredError) {
          setState({ status: "signed-out" });
        }
        throw error;
      }
    },
    [saveShowingList],
  );

  const protectedShowingListReviewer =
    useCallback<CurrentShowingListReviewer>(
      async (input) => {
        try {
          return await markShowingListReviewed(input);
        } catch (error) {
          if (error instanceof SessionAuthenticationRequiredError) {
            setState({ status: "signed-out" });
          }
          throw error;
        }
      },
      [markShowingListReviewed],
    );

  const protectedShowingListDownloader =
    useCallback<CurrentShowingListDownloader>(async () => {
      try {
        return await downloadShowingList();
      } catch (error) {
        if (error instanceof SessionAuthenticationRequiredError) {
          setState({ status: "signed-out" });
        }
        throw error;
      }
    }, [downloadShowingList]);

  const protectedSearchCriteriaLoader =
    useCallback<ListingSearchCriteriaLoader>(
      async (signal) => {
        try {
          return await loadSearchCriteria(signal);
        } catch (error) {
          if (error instanceof SessionAuthenticationRequiredError) {
            setState({ status: "signed-out" });
          }
          throw error;
        }
      },
      [loadSearchCriteria],
    );

  const protectedSearchCriteriaSaver =
    useCallback<ListingSearchCriteriaSaver>(
      async (input) => {
        try {
          return await saveSearchCriteria(input);
        } catch (error) {
          if (error instanceof SessionAuthenticationRequiredError) {
            setState({ status: "signed-out" });
          }
          throw error;
        }
      },
      [saveSearchCriteria],
    );

  const handleLogout = async (): Promise<void> => {
    if (state.status !== "authenticated" || isSigningOut) {
      return;
    }

    const { user } = state;
    setIsSigningOut(true);
    setState({ logoutError: false, status: "authenticated", user });
    try {
      await sessionClient.logout();
      setState({ status: "signed-out" });
    } catch {
      setState({ logoutError: true, status: "authenticated", user });
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Chaoran Property Intelligence">
          <span className="brand-mark" aria-hidden="true">
            CPI
          </span>
          <span className="brand-name">Chaoran Property Intelligence</span>
        </a>
        {state.status === "authenticated" ? (
          <div className="session-controls">
            <span className="session-email">{state.user.email}</span>
            <button
              className="session-button"
              type="button"
              aria-label={isSigningOut ? "Signing out" : "Sign out"}
              disabled={isSigningOut}
              onClick={() => void handleLogout()}
            >
              {isSigningOut ? (
                <LoaderCircle className="spin" aria-hidden="true" size={16} />
              ) : (
                <LogOut aria-hidden="true" size={16} />
              )}
              <span className="session-button-label">
                {isSigningOut ? "Signing out" : "Sign out"}
              </span>
            </button>
          </div>
        ) : (
          <span className="snapshot-indicator">Private workspace</span>
        )}
      </header>
      {state.status === "checking" ? <SessionChecking /> : null}
      {state.status === "error" ? (
        <SessionError
          onRetry={() => setSessionRequest((request) => request + 1)}
        />
      ) : null}
      {state.status === "signed-out" ? (
        <LoginForm
          sessionClient={sessionClient}
          onAuthenticated={(user) =>
            setState({ logoutError: false, status: "authenticated", user })
          }
        />
      ) : null}
      {state.status === "authenticated" ? (
        <>
          {state.logoutError ? (
            <div className="session-notice" role="alert">
              <AlertCircle aria-hidden="true" size={17} />
              Sign out failed. Your workspace remains open.
            </div>
          ) : null}
          <nav className="workspace-tabs" aria-label="Workspace">
            <button
              type="button"
              aria-current={activeWorkspace === "listings" ? "page" : undefined}
              onClick={() => setActiveWorkspace("listings")}
            >
              <Building2 aria-hidden="true" size={17} />
              Listings
            </button>
            <button
              type="button"
              aria-current={
                activeWorkspace === "showing-list" ? "page" : undefined
              }
              onClick={() => setActiveWorkspace("showing-list")}
            >
              <ClipboardList aria-hidden="true" size={17} />
              Showing List
            </button>
            <button
              type="button"
              aria-current={
                activeWorkspace === "search-criteria" ? "page" : undefined
              }
              onClick={() => setActiveWorkspace("search-criteria")}
            >
              <ListFilter aria-hidden="true" size={17} />
              Search Criteria
            </button>
          </nav>
          {activeWorkspace === "listings" ? (
            <ListingsScreen
              archiveListing={protectedListingArchiver}
              createListing={protectedListingCreator}
              loadListings={protectedListingsLoader}
              {...(mapView === undefined ? {} : { mapView })}
              updateListing={protectedListingUpdater}
            />
          ) : null}
          {activeWorkspace === "showing-list" ? (
            <ShowingListScreen
              downloadArtifact={protectedShowingListDownloader}
              loadCurrent={protectedShowingListLoader}
              loadListings={protectedListingsLoader}
              markReviewed={protectedShowingListReviewer}
              saveDraft={protectedShowingListSaver}
            />
          ) : null}
          {activeWorkspace === "search-criteria" ? (
            <SearchCriteriaScreen
              loadCriteria={protectedSearchCriteriaLoader}
              saveCriteria={protectedSearchCriteriaSaver}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function SessionChecking(): React.JSX.Element {
  return (
    <main className="auth-shell">
      <div className="session-state" role="status" aria-label="Checking session">
        <LoaderCircle className="spin" aria-hidden="true" size={25} />
        <span>Checking session</span>
      </div>
    </main>
  );
}

function SessionError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <main className="auth-shell">
      <section className="session-state session-error" role="alert">
        <AlertCircle aria-hidden="true" size={28} />
        <h1>Session unavailable</h1>
        <p>The private workspace could not be reached.</p>
        <button className="retry-button" type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" size={16} />
          Retry
        </button>
      </section>
    </main>
  );
}

type LoginState =
  | "idle"
  | "submitting"
  | "invalid"
  | "rate-limited"
  | "unavailable";

function LoginForm({
  sessionClient,
  onAuthenticated,
}: {
  sessionClient: SessionClient;
  onAuthenticated: (user: AuthenticatedUser) => void;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginState, setLoginState] = useState<LoginState>("idle");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginState === "submitting") {
      return;
    }

    setLoginState("submitting");
    try {
      const user = await sessionClient.login({ email, password });
      onAuthenticated(user);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        setLoginState("invalid");
      } else if (error instanceof LoginRateLimitedError) {
        setLoginState("rate-limited");
      } else {
        setLoginState("unavailable");
      }
    }
  };

  const errorMessage = getLoginErrorMessage(loginState);

  return (
    <main className="auth-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-heading">
          <span className="login-icon" aria-hidden="true">
            <LogIn size={19} />
          </span>
          <div>
            <p className="section-label">Administrator access</p>
            <h1 id="login-title">Sign in</h1>
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            disabled={loginState === "submitting"}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
            disabled={loginState === "submitting"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="login-feedback" aria-live="polite">
            {errorMessage === null ? null : (
              <p role="alert">{errorMessage}</p>
            )}
          </div>
          <button
            className="login-button"
            type="submit"
            disabled={loginState === "submitting"}
          >
            {loginState === "submitting" ? (
              <LoaderCircle className="spin" aria-hidden="true" size={17} />
            ) : (
              <LogIn aria-hidden="true" size={17} />
            )}
            {loginState === "submitting" ? "Signing in" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}

function getLoginErrorMessage(state: LoginState): string | null {
  switch (state) {
    case "invalid":
      return "Email or password is incorrect.";
    case "rate-limited":
      return "Too many sign-in attempts. Try again shortly.";
    case "unavailable":
      return "Sign in is unavailable. Try again.";
    case "idle":
    case "submitting":
      return null;
  }
}
