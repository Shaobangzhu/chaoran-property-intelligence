import { describe, expect, it } from "vitest";

import {
  InvalidShowingListArtifactInputError,
  ShowingListArtifactRenderingError,
  type GeneratedShowingList,
  type ShowingListArtifactRenderInput,
  type ShowingListPropertyContext,
} from "@chaoran-property-intelligence/application";

import { PdfKitShowingListArtifactRenderer } from "./pdfKitShowingListArtifactRenderer.js";

const generationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const firstListingId = "11111111-1111-4111-8111-111111111111";
const secondListingId = "22222222-2222-4222-8222-222222222222";

type MutableShowingListArtifactRenderInput = Omit<
  ShowingListArtifactRenderInput,
  "listings" | "draft"
> & {
  listings: ShowingListPropertyContext[];
  draft: GeneratedShowingList;
};

describe("PdfKitShowingListArtifactRenderer", () => {
  it("renders the fixed PDF artifact contract", async () => {
    const renderer = new PdfKitShowingListArtifactRenderer({ compress: false });

    const artifact = await renderer.render(createInput());

    expect(artifact.fileName).toBe("showing-list-draft.pdf");
    expect(artifact.mediaType).toBe("application/pdf");
    expect(artifact.bytes.byteLength).toBeGreaterThan(1_000);
    expect(Buffer.from(artifact.bytes).subarray(0, 8).toString("ascii")).toBe(
      "%PDF-1.7",
    );
  });

  it("combines authoritative facts with bounded generated content", async () => {
    const renderer = new PdfKitShowingListArtifactRenderer({ compress: false });

    const artifact = await renderer.render(createInput());
    const pdf = Buffer.from(artifact.bytes).toString("latin1");
    const text = extractPdfText(pdf);

    expect(text).toContain("Saturday Showing List");
    expect(text).toContain("123 Main St, Eastvale, CA 92880");
    expect(text).toContain("$825,000");
    expect(text).toContain("IG26000001");
    expect(text).toContain("Close to the first appointment");
    expect(text).toContain("Licensed-agent review required");
    expect(text).toContain("Please review these options");
    expect(text).toContain("UNREVIEWED DRAFT");
    expect(text).not.toContain("Internal agent note that must stay private");
  });

  it("renders stops in proposed order rather than input order", async () => {
    const renderer = new PdfKitShowingListArtifactRenderer({ compress: false });
    const input = createInput();
    input.draft.stops = [
      createStop(secondListingId, 1),
      createStop(firstListingId, 2),
    ];

    const artifact = await renderer.render(input);
    const pdf = Buffer.from(artifact.bytes).toString("latin1");
    const text = extractPdfText(pdf);

    expect(text.indexOf("456 Oak Ave, Chino, CA 91710")).toBeLessThan(
      text.indexOf("123 Main St, Eastvale, CA 92880"),
    );
  });

  it("produces deterministic bytes for identical input", async () => {
    const renderer = new PdfKitShowingListArtifactRenderer();

    const first = await renderer.render(createInput());
    const second = await renderer.render(createInput());

    expect(first.bytes).toEqual(second.bytes);
  });

  it("paginates the maximum bounded draft and adds every footer", async () => {
    const renderer = new PdfKitShowingListArtifactRenderer({ compress: false });
    const input = createMaximumInput();

    const artifact = await renderer.render(input);
    const pdf = Buffer.from(artifact.bytes).toString("latin1");
    const text = extractPdfText(pdf);
    const pageCount = [...pdf.matchAll(/\/Type \/Page\b/g)].length;

    expect(pageCount).toBeGreaterThan(2);
    expect(text).toContain(`Page 1 of ${pageCount}`);
    expect(text).toContain(`Page ${pageCount} of ${pageCount}`);
    for (const listing of input.listings) {
      expect(text).toContain(listing.formattedAddress);
    }
  });

  it("replaces unsupported glyphs instead of failing the PDF stream", async () => {
    const renderer = new PdfKitShowingListArtifactRenderer({ compress: false });
    const input = createInput();
    input.draft.title = "Showing route - client review";
    input.draft.summary = "Cafe, smart quotes, and unsupported glyphs: \u4f60\u597d";

    const artifact = await renderer.render(input);
    const pdf = Buffer.from(artifact.bytes).toString("latin1");
    const text = extractPdfText(pdf);

    expect(text).toContain("Showing route - client review");
    expect(text).toContain("Cafe, smart quotes, and unsupported glyphs: ??");
  });

  it.each([
    [
      "an invalid generation ID",
      () => createInput({ generationId: "not-a-uuid" }),
    ],
    [
      "an invalid timestamp",
      () => createInput({ generatedAt: "2026-08-20" }),
    ],
    [
      "an impossible timestamp",
      () => createInput({ generatedAt: "2026-02-30T17:30:00.000Z" }),
    ],
    [
      "a non-object payload",
      () => null as unknown as MutableShowingListArtifactRenderInput,
    ],
    [
      "a malformed authoritative listing",
      () => {
        const input = createInput();
        input.listings[0] = { ...input.listings[0]!, price: Number.NaN };
        return input;
      },
    ],
    [
      "a generated listing outside the authoritative selection",
      () => {
        const input = createInput();
        input.draft.stops[0] = createStop(
          "33333333-3333-4333-8333-333333333333",
          1,
        );
        return input;
      },
    ],
    [
      "an invalid generated draft",
      () => {
        const input = createInput();
        input.draft.title = " ";
        return input;
      },
    ],
  ])("rejects %s", async (_label, createInvalidInput) => {
    const renderer = new PdfKitShowingListArtifactRenderer();

    await expect(renderer.render(createInvalidInput())).rejects.toBeInstanceOf(
      InvalidShowingListArtifactInputError,
    );
  });

  it("fails closed when the artifact exceeds its byte limit", async () => {
    const renderer = new PdfKitShowingListArtifactRenderer({ maximumBytes: 64 });

    await expect(renderer.render(createInput())).rejects.toBeInstanceOf(
      ShowingListArtifactRenderingError,
    );
  });

  it.each([0, 1.5, 5 * 1_024 * 1_024 + 1])(
    "rejects invalid byte limit %s",
    (maximumBytes) => {
      expect(
        () => new PdfKitShowingListArtifactRenderer({ maximumBytes }),
      ).toThrow(RangeError);
    },
  );
});

function createInput(
  overrides: Partial<MutableShowingListArtifactRenderInput> = {},
): MutableShowingListArtifactRenderInput {
  return {
    generationId,
    generatedAt: "2026-08-20T17:30:00.000Z",
    listings: [
      createListing(firstListingId, "123 Main St, Eastvale, CA 92880"),
      createListing(secondListingId, "456 Oak Ave, Chino, CA 91710", {
        price: 775_000,
        mlsNumber: "TR26000002",
      }),
    ],
    preferences: {
      clientDisplayName: "A. Buyer",
      showingDate: "2026-08-22",
      agentInstructions: "Internal agent note that must stay private",
    },
    draft: {
      title: "Saturday Showing List",
      summary: "A review draft for two selected properties.",
      stops: [
        createStop(firstListingId, 1),
        createStop(secondListingId, 2),
      ],
      clientMessage: "Please review these options before the showing.",
      reviewWarnings: ["Licensed-agent review required before client use."],
    },
    ...overrides,
  };
}

function createListing(
  id: string,
  formattedAddress: string,
  overrides: Partial<ShowingListPropertyContext> = {},
): ShowingListPropertyContext {
  return {
    id,
    formattedAddress,
    latitude: 33.9525,
    longitude: -117.5848,
    propertyType: "Single Family",
    bedrooms: 4,
    bathrooms: 2.5,
    price: 825_000,
    status: "Active",
    listedDate: "2026-08-19",
    mlsName: "CRMLS",
    mlsNumber: "IG26000001",
    ...overrides,
  };
}

function createStop(
  listingId: string,
  proposedOrder: number,
): GeneratedShowingList["stops"][number] {
  return {
    listingId,
    proposedOrder,
    orderReason: "Close to the first appointment and easy to review.",
    highlights: ["Updated kitchen", "Flexible living area"],
    considerations: ["Verify availability before scheduling"],
  };
}

function createMaximumInput(): ReturnType<typeof createInput> {
  const listingIds = Array.from(
    { length: 10 },
    (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const input = createInput();
  input.listings = listingIds.map((id, index) =>
    createListing(id, `${100 + index} Maximum Content Avenue, Eastvale, CA 92880`),
  );
  input.draft = {
    title: "Maximum bounded Showing List draft",
    summary: boundedText("Detailed plan overview. ", 1_200),
    stops: listingIds.map((id, index) => ({
      listingId: id,
      proposedOrder: index + 1,
      orderReason: boundedText("Proposed route reason. ", 400),
      highlights: Array.from({ length: 4 }, () =>
        boundedText("Generated property highlight. ", 240),
      ),
      considerations: Array.from({ length: 4 }, () =>
        boundedText("Generated review consideration. ", 240),
      ),
    })),
    clientMessage: boundedText("Draft client message. ", 2_000),
    reviewWarnings: Array.from({ length: 6 }, () =>
      boundedText("Generated review warning. ", 240),
    ),
  };
  return input;
}

function boundedText(fragment: string, length: number): string {
  return fragment.repeat(Math.ceil(length / fragment.length)).slice(0, length);
}

function extractPdfText(pdf: string): string {
  return [...pdf.matchAll(/\[((?:.|\n)*?)\]\s*TJ/g)]
    .map((textOperation) =>
      [...(textOperation[1] ?? "").matchAll(/<([0-9a-f]+)>/giu)]
        .map((hexChunk) =>
          Buffer.from(hexChunk[1] ?? "", "hex").toString("latin1"),
        )
        .join(""),
    )
    .join("\n");
}
