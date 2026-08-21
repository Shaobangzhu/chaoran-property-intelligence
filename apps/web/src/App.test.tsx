// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import type { ListingsMapViewProps } from "./ListingsScreen.js";
import { eastvaleListing } from "./listingFixtures.js";
import { SessionAuthenticationRequiredError } from "./listingsApi.js";
import {
  InvalidCredentialsError,
  LoginRateLimitedError,
  type AuthenticatedUser,
  type SessionClient,
} from "./sessionApi.js";

afterEach(cleanup);

describe("App authentication boundary", () => {
  it("checks the session before mounting protected content", () => {
    const loadListings = vi.fn(async () => [eastvaleListing]);
    render(
      <App
        loadListings={loadListings}
        mapView={PassiveMap}
        sessionClient={sessionClient({
          getCurrentUser: () => new Promise(() => {}),
        })}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Checking session" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    expect(loadListings).not.toHaveBeenCalled();
  });

  it("renders a password-manager-compatible login when signed out", async () => {
    render(
      <App
        mapView={PassiveMap}
        sessionClient={sessionClient({ getCurrentUser: async () => null })}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("mounts listings only after a successful session bootstrap", async () => {
    const loadListings = vi.fn(async () => [eastvaleListing]);
    render(
      <App
        loadListings={loadListings}
        mapView={PassiveMap}
        sessionClient={sessionClient()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: eastvaleListing.addressLine1 }),
    ).toBeInTheDocument();
    expect(screen.getByText(authenticatedUser.email)).toBeInTheDocument();
    expect(loadListings).toHaveBeenCalledTimes(1);
  });

  it("switches to the protected Showing List workspace", async () => {
    const user = userEvent.setup();
    const loadCurrentShowingList = vi.fn(async () => null);
    render(
      <App
        loadCurrentShowingList={loadCurrentShowingList}
        loadListings={async () => []}
        mapView={PassiveMap}
        sessionClient={sessionClient()}
      />,
    );

    await screen.findByRole("heading", { name: "No stored listings" });
    await user.click(screen.getByRole("button", { name: "Showing List" }));

    expect(
      await screen.findByRole("heading", { name: "No current Showing List" }),
    ).toBeInTheDocument();
    expect(loadCurrentShowingList).toHaveBeenCalledTimes(1);
  });

  it("recovers when the initial session check fails", async () => {
    const user = userEvent.setup();
    const getCurrentUser = vi
      .fn<SessionClient["getCurrentUser"]>()
      .mockRejectedValueOnce(new Error("private upstream detail"))
      .mockResolvedValueOnce(null);
    render(
      <App
        mapView={PassiveMap}
        sessionClient={sessionClient({ getCurrentUser })}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Session unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/private upstream detail/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it("submits login and shows a generic credential failure", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn<SessionClient["login"]>()
      .mockRejectedValue(new InvalidCredentialsError());
    render(
      <App
        mapView={PassiveMap}
        sessionClient={sessionClient({ getCurrentUser: async () => null, login })}
      />,
    );

    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "not-the-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Email or password is incorrect."),
    ).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "not-the-password",
    });
  });

  it("keeps the login form stable while credentials are submitting", async () => {
    const user = userEvent.setup();
    let resolveLogin: ((user: AuthenticatedUser) => void) | undefined;
    const login = vi.fn(
      () =>
        new Promise<AuthenticatedUser>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    render(
      <App
        loadListings={async () => []}
        mapView={PassiveMap}
        sessionClient={sessionClient({ getCurrentUser: async () => null, login })}
      />,
    );

    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("button", { name: "Signing in" })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();

    resolveLogin?.(authenticatedUser);
    expect(
      await screen.findByRole("heading", { name: "No stored listings" }),
    ).toBeInTheDocument();
  });

  it("shows a bounded rate-limit state", async () => {
    const user = userEvent.setup();
    render(
      <App
        mapView={PassiveMap}
        sessionClient={sessionClient({
          getCurrentUser: async () => null,
          login: async () => {
            throw new LoginRateLimitedError();
          },
        })}
      />,
    );

    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "not-the-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Too many sign-in attempts. Try again shortly."),
    ).toBeInTheDocument();
  });

  it("signs in and signs out through the session client", async () => {
    const user = userEvent.setup();
    const login = vi.fn(async () => authenticatedUser);
    const logout = vi.fn(async () => undefined);
    render(
      <App
        loadListings={async () => []}
        mapView={PassiveMap}
        sessionClient={sessionClient({
          getCurrentUser: async () => null,
          login,
          logout,
        })}
      />,
    );

    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("heading", { name: "No stored listings" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("keeps the workspace mounted when logout fails", async () => {
    const user = userEvent.setup();
    render(
      <App
        loadListings={async () => []}
        mapView={PassiveMap}
        sessionClient={sessionClient({
          logout: async () => {
            throw new Error("private upstream detail");
          },
        })}
      />,
    );

    await screen.findByRole("heading", { name: "No stored listings" });
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByText("Sign out failed. Your workspace remains open."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No stored listings" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/private upstream detail/)).not.toBeInTheDocument();
  });

  it("returns to login when the listings session expires", async () => {
    render(
      <App
        loadListings={async () => {
          throw new SessionAuthenticationRequiredError();
        }}
        mapView={PassiveMap}
        sessionClient={sessionClient()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Listings unavailable" }),
    ).not.toBeInTheDocument();
  });

  it("returns to login when the Showing List session expires", async () => {
    const user = userEvent.setup();
    render(
      <App
        loadCurrentShowingList={async () => {
          throw new SessionAuthenticationRequiredError();
        }}
        loadListings={async () => []}
        mapView={PassiveMap}
        sessionClient={sessionClient()}
      />,
    );

    await screen.findByRole("heading", { name: "No stored listings" });
    await user.click(screen.getByRole("button", { name: "Showing List" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("returns to login when the manual-create session expires", async () => {
    const user = userEvent.setup();
    render(
      <App
        createListing={async () => {
          throw new SessionAuthenticationRequiredError();
        }}
        loadListings={async () => []}
        mapView={DraftMap}
        sessionClient={sessionClient()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Add listing" }));
    await user.type(screen.getByLabelText("Address line 1"), "456 Client Way");
    await user.type(screen.getByLabelText("City"), "Corona");
    await user.type(screen.getByLabelText("ZIP code"), "92879");
    await user.click(screen.getByRole("button", { name: "Map" }));
    await user.click(screen.getByRole("button", { name: "Place marker" }));
    await user.click(screen.getByRole("button", { name: "Confirm marker" }));
    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByRole("button", { name: "Save listing" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("returns to login when the manual-update session expires", async () => {
    const user = userEvent.setup();
    render(
      <App
        loadListings={async () => [manualListing]}
        mapView={PassiveMap}
        sessionClient={sessionClient()}
        updateListing={async () => {
          throw new SessionAuthenticationRequiredError();
        }}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(manualListing.addressLine1),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Edit listing" }));
    await user.clear(screen.getByLabelText("City"));
    await user.type(screen.getByLabelText("City"), "Norco");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("returns to login when the manual-archive session expires", async () => {
    const user = userEvent.setup();
    render(
      <App
        archiveListing={async () => {
          throw new SessionAuthenticationRequiredError();
        }}
        loadListings={async () => [manualListing]}
        mapView={PassiveMap}
        sessionClient={sessionClient()}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: new RegExp(manualListing.addressLine1),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Archive listing" }));
    await user.click(screen.getByRole("button", { name: "Confirm archive" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });
});

const authenticatedUser: AuthenticatedUser = {
  id: "0198c7d2-7668-7775-b0fc-b789690a60c1",
  email: "admin@example.com",
  role: "admin",
};

const manualListing = {
  ...eastvaleListing,
  id: "0198c7d2-7668-7775-b0fc-b789690a60d2",
  source: "manual" as const,
  sourceListingId: null,
};

function sessionClient(overrides: Partial<SessionClient> = {}): SessionClient {
  return {
    getCurrentUser: async () => authenticatedUser,
    login: async () => authenticatedUser,
    logout: async () => undefined,
    ...overrides,
  };
}

function PassiveMap(_props: ListingsMapViewProps): React.JSX.Element {
  return <div aria-label="Listings map" />;
}

function DraftMap({ draftMarker }: ListingsMapViewProps): React.JSX.Element {
  return (
    <div aria-label="Listings map">
      <button
        type="button"
        onClick={() =>
          draftMarker?.onCoordinatesChange({
            latitude: 33.8753,
            longitude: -117.5664,
          })
        }
      >
        Place marker
      </button>
      <button type="button" onClick={draftMarker?.onConfirm}>
        Confirm marker
      </button>
    </div>
  );
}
