import { createRequire } from "node:module";
import type PdfKitModule from "pdfkit";

import {
  InvalidShowingListArtifactInputError,
  SHOWING_LIST_ARTIFACT,
  SHOWING_LIST_ARTIFACT_LIMITS,
  ShowingListArtifactRenderingError,
  safeParseGeneratedShowingList,
  safeParseShowingListGenerationInput,
  type GeneratedShowingList,
  type RenderedShowingListArtifact,
  type ShowingListArtifactRendererPort,
  type ShowingListArtifactRenderInput,
  type ShowingListGenerationPreferences,
  type ShowingListPropertyContext,
} from "@chaoran-property-intelligence/application";

type PdfKitDocument = typeof PdfKitModule;
type PdfDocumentConstructor = new (
  options?: PdfKitDocument["options"],
) => PdfKitDocument;

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as PdfDocumentConstructor;

const layout = Object.freeze({
  margin: 54,
  footerY: 758,
  contentWidth: 504,
});

const color = Object.freeze({
  accent: "#17776B",
  accentSoft: "#E9F5F2",
  ink: "#172126",
  muted: "#56646C",
  line: "#D8E0E3",
  warning: "#9A5B13",
  warningSoft: "#FFF4E3",
});

export interface PdfKitShowingListArtifactRendererOptions {
  compress?: boolean;
  maximumBytes?: number;
}

interface PreparedShowingListArtifact {
  generationId: string;
  generatedAt: Date;
  preferences: ShowingListGenerationPreferences;
  draft: GeneratedShowingList;
  stops: PreparedShowingListStop[];
}

interface PreparedShowingListStop {
  listing: ShowingListPropertyContext;
  generated: GeneratedShowingList["stops"][number];
}

export class PdfKitShowingListArtifactRenderer
  implements ShowingListArtifactRendererPort
{
  private readonly compress: boolean;
  private readonly maximumBytes: number;

  constructor(options: PdfKitShowingListArtifactRendererOptions = {}) {
    this.compress = options.compress ?? true;
    this.maximumBytes =
      options.maximumBytes ?? SHOWING_LIST_ARTIFACT_LIMITS.maximumBytes;

    if (
      !Number.isInteger(this.maximumBytes) ||
      this.maximumBytes < 1 ||
      this.maximumBytes > SHOWING_LIST_ARTIFACT_LIMITS.maximumBytes
    ) {
      throw new RangeError("PDF artifact byte limit was invalid");
    }
  }

  async render(
    input: ShowingListArtifactRenderInput,
  ): Promise<RenderedShowingListArtifact> {
    const prepared = prepareShowingListArtifact(input);

    try {
      const document = new PDFDocument({
        autoFirstPage: false,
        bufferPages: true,
        compress: this.compress,
        displayTitle: true,
        info: {
          Author: "Chaoran Property Intelligence",
          CreationDate: prepared.generatedAt,
          Creator: "Chaoran Property Intelligence",
          Keywords: "showing list, real estate, unreviewed draft",
          ModDate: prepared.generatedAt,
          Subject: "Unreviewed Showing List draft",
          Title: toPdfText(prepared.draft.title),
        },
        margins: {
          top: layout.margin,
          right: layout.margin,
          bottom: layout.margin,
          left: layout.margin,
        },
        pdfVersion: "1.7",
        size: "LETTER",
      });
      const completedBytes = collectDocumentBytes(
        document,
        this.maximumBytes,
      );

      renderPreparedArtifact(document, prepared);
      document.end();

      return {
        bytes: await completedBytes,
        mediaType: SHOWING_LIST_ARTIFACT.mediaType,
        fileName: SHOWING_LIST_ARTIFACT.fileName,
      };
    } catch (error) {
      if (error instanceof ShowingListArtifactRenderingError) {
        throw error;
      }
      throw new ShowingListArtifactRenderingError();
    }
  }
}

function prepareShowingListArtifact(
  input: ShowingListArtifactRenderInput,
): PreparedShowingListArtifact {
  if (!isRecord(input) || !isUuid(input.generationId)) {
    throw new InvalidShowingListArtifactInputError();
  }

  const generatedAt = parseTimestamp(input.generatedAt);
  if (!Array.isArray(input.listings)) {
    throw new InvalidShowingListArtifactInputError();
  }
  const listings: unknown[] = [...input.listings];
  if (
    listings.length < 1 ||
    listings.length > 10 ||
    !listings.every(isValidListing)
  ) {
    throw new InvalidShowingListArtifactInputError();
  }

  const listingIds = listings.map((listing) => listing.id);
  const parsedRequest = safeParseShowingListGenerationInput({
    listingIds,
    preferences: input.preferences,
  });
  const parsedDraft = safeParseGeneratedShowingList(input.draft);
  if (!parsedRequest.success || !parsedDraft.success) {
    throw new InvalidShowingListArtifactInputError();
  }

  const listingsById = new Map(listings.map((listing) => [listing.id, listing]));
  if (
    parsedDraft.data.stops.length !== listingsById.size ||
    parsedDraft.data.stops.some(
      (stop) => !listingsById.has(stop.listingId),
    )
  ) {
    throw new InvalidShowingListArtifactInputError();
  }

  const stops = [...parsedDraft.data.stops]
    .sort((left, right) => left.proposedOrder - right.proposedOrder)
    .map((generated) => {
      const listing = listingsById.get(generated.listingId);
      if (listing === undefined) {
        throw new InvalidShowingListArtifactInputError();
      }
      return { listing, generated };
    });

  return {
    generationId: input.generationId,
    generatedAt,
    preferences: parsedRequest.data.preferences,
    draft: parsedDraft.data,
    stops,
  };
}

function renderPreparedArtifact(
  document: PdfKitDocument,
  artifact: PreparedShowingListArtifact,
): void {
  document.addPage();
  writeDocumentHeader(document, artifact);
  writeOverview(document, artifact.draft.summary);

  for (const stop of artifact.stops) {
    writeStop(document, stop);
  }

  writeClientMessage(document, artifact.draft.clientMessage);
  writeReviewWarnings(document, artifact.draft.reviewWarnings);
  writeReviewBoundary(document);
  addPageFooters(document);
}

function writeDocumentHeader(
  document: PdfKitDocument,
  artifact: PreparedShowingListArtifact,
): void {
  document
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(color.accent)
    .text("CHAORAN PROPERTY INTELLIGENCE", layout.margin, document.y, {
      characterSpacing: 0.6,
      width: layout.contentWidth,
    });
  document.moveDown(0.8);
  document
    .font("Helvetica-Bold")
    .fontSize(25)
    .fillColor(color.ink)
    .text(toPdfText(artifact.draft.title), layout.margin, document.y, {
      lineGap: 2,
      width: layout.contentWidth,
    });
  document.moveDown(0.55);

  const bannerY = document.y;
  document
    .save()
    .roundedRect(layout.margin, bannerY, layout.contentWidth, 30, 4)
    .fill(color.warningSoft)
    .restore();
  document
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(color.warning)
    .text("UNREVIEWED DRAFT - LICENSED-AGENT REVIEW REQUIRED", 68, bannerY + 9, {
      lineBreak: false,
      width: layout.contentWidth - 28,
    });
  document.y = bannerY + 44;

  writeMetadataPanel(document, artifact);
}

function writeMetadataPanel(
  document: PdfKitDocument,
  artifact: PreparedShowingListArtifact,
): void {
  const rows = [
    ["Prepared", formatDateTime(artifact.generatedAt)],
    ["Showing date", formatOptionalDate(artifact.preferences.showingDate)],
    ["Client", artifact.preferences.clientDisplayName ?? "Not provided"],
    ["Properties", String(artifact.stops.length)],
    ["Draft reference", artifact.generationId],
  ] as const;
  const rowHeights = rows.map(([, value]) => {
    document.font("Helvetica").fontSize(9);
    return Math.max(
      14,
      document.heightOfString(toPdfText(value), {
        lineGap: 1,
        width: layout.contentWidth - 132,
      }),
    );
  });
  const panelHeight =
    22 + rowHeights.reduce((total, rowHeight) => total + rowHeight, 0);
  const panelY = document.y;

  document
    .save()
    .roundedRect(layout.margin, panelY, layout.contentWidth, panelHeight, 4)
    .fill(color.accentSoft)
    .restore();

  let rowY = panelY + 12;
  rows.forEach(([label, value], index) => {
    document
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(color.accent)
      .text(label, layout.margin + 14, rowY, {
        lineBreak: false,
        width: 96,
      });
    document
      .font("Helvetica")
      .fontSize(9)
      .fillColor(color.ink)
      .text(toPdfText(value), layout.margin + 112, rowY, {
        lineGap: 1,
        width: layout.contentWidth - 126,
      });
    rowY += rowHeights[index] ?? 14;
  });

  document.y = panelY + panelHeight + 22;
}

function writeOverview(document: PdfKitDocument, summary: string): void {
  writeSectionHeading(document, "Plan overview");
  writeBody(document, summary);
  document.moveDown(0.9);
}

function writeStop(
  document: PdfKitDocument,
  stop: PreparedShowingListStop,
): void {
  ensureSpace(document, 128);
  writeDivider(document);
  document.moveDown(0.7);
  document
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(color.accent)
    .text(`STOP ${stop.generated.proposedOrder}`, layout.margin, document.y, {
      characterSpacing: 0.5,
      width: layout.contentWidth,
    });
  document.moveDown(0.25);
  document
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor(color.ink)
    .text(toPdfText(stop.listing.formattedAddress), layout.margin, document.y, {
      lineGap: 2,
      width: layout.contentWidth,
    });
  document.moveDown(0.35);
  document
    .font("Helvetica")
    .fontSize(9)
    .fillColor(color.muted)
    .text(formatPropertyFacts(stop.listing), layout.margin, document.y, {
      lineGap: 2,
      width: layout.contentWidth,
    });
  document.moveDown(0.25);
  document
    .font("Helvetica")
    .fontSize(9)
    .fillColor(color.muted)
    .text(formatMlsFacts(stop.listing), layout.margin, document.y, {
      lineGap: 2,
      width: layout.contentWidth,
    });
  document.moveDown(0.65);

  writeLabeledParagraph(document, "Why this order", stop.generated.orderReason);
  writeBulletSection(document, "Highlights", stop.generated.highlights);
  writeBulletSection(
    document,
    "Considerations",
    stop.generated.considerations,
  );
  document.moveDown(0.7);
}

function writeClientMessage(
  document: PdfKitDocument,
  clientMessage: string,
): void {
  ensureSpace(document, 100);
  writeSectionHeading(document, "Draft client message");
  const message = toPdfText(clientMessage);
  document.font("Helvetica").fontSize(10);
  const messageHeight = document.heightOfString(message, {
    lineGap: 3,
    width: layout.contentWidth - 30,
  });
  const startY = document.y;
  document
    .save()
    .rect(layout.margin, startY, 3, messageHeight + 16)
    .fill(color.accent)
    .restore();
  document
    .fillColor(color.ink)
    .text(message, layout.margin + 16, startY + 7, {
      lineGap: 3,
      width: layout.contentWidth - 30,
    });
  document.y = Math.max(document.y, startY + messageHeight + 22);
}

function writeReviewWarnings(
  document: PdfKitDocument,
  warnings: readonly string[],
): void {
  ensureSpace(document, 72);
  writeSectionHeading(document, "Review warnings");
  if (warnings.length === 0) {
    writeBody(document, "No additional generated warnings were provided.");
    return;
  }

  for (const warning of warnings) {
    writeBullet(document, warning, color.warning);
  }
}

function writeReviewBoundary(document: PdfKitDocument): void {
  ensureSpace(document, 72);
  const notice =
    "This document is an unreviewed working draft. Verify property availability, MLS status, price, showing instructions, route, and all client-facing language before use. It does not provide legal, valuation, school-boundary, safety, wildfire, or Fair Housing advice.";
  const panelY = document.y + 4;
  document
    .save()
    .roundedRect(layout.margin, panelY, layout.contentWidth, 68, 4)
    .fill(color.warningSoft)
    .restore();
  const noticeY = panelY + 10;
  document
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(color.warning)
    .text("REVIEW BOUNDARY", layout.margin + 14, noticeY, {
      width: layout.contentWidth - 28,
    });
  document
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(color.ink)
    .text(notice, layout.margin + 14, noticeY + 16, {
      lineGap: 2,
      width: layout.contentWidth - 28,
    });
  document.y = panelY + 76;
}

function writeSectionHeading(
  document: PdfKitDocument,
  heading: string,
): void {
  ensureSpace(document, 44);
  document
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(color.ink)
    .text(toPdfText(heading), layout.margin, document.y, {
      width: layout.contentWidth,
    });
  document.moveDown(0.45);
}

function writeLabeledParagraph(
  document: PdfKitDocument,
  label: string,
  value: string,
): void {
  ensureSpace(document, 46);
  document
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(color.muted)
    .text(toPdfText(label).toUpperCase(), layout.margin, document.y, {
      width: layout.contentWidth,
    });
  document.moveDown(0.2);
  writeBody(document, value);
  document.moveDown(0.45);
}

function writeBulletSection(
  document: PdfKitDocument,
  label: string,
  values: readonly string[],
): void {
  ensureSpace(document, 40);
  document
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(color.muted)
    .text(toPdfText(label).toUpperCase(), layout.margin, document.y, {
      width: layout.contentWidth,
    });
  document.moveDown(0.2);

  if (values.length === 0) {
    writeBody(document, "None provided.");
  } else {
    for (const value of values) {
      writeBullet(document, value, color.ink);
    }
  }
  document.moveDown(0.35);
}

function writeBullet(
  document: PdfKitDocument,
  value: string,
  textColor: string,
): void {
  ensureSpace(document, 28);
  document
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor(textColor)
    .text(`- ${toPdfText(value)}`, layout.margin + 8, document.y, {
      indent: 8,
      lineGap: 2,
      width: layout.contentWidth - 8,
    });
  document.moveDown(0.18);
}

function writeBody(document: PdfKitDocument, value: string): void {
  document
    .font("Helvetica")
    .fontSize(10)
    .fillColor(color.ink)
    .text(toPdfText(value), layout.margin, document.y, {
      lineGap: 3,
      width: layout.contentWidth,
    });
}

function writeDivider(document: PdfKitDocument): void {
  document
    .save()
    .lineWidth(0.8)
    .strokeColor(color.line)
    .moveTo(layout.margin, document.y)
    .lineTo(layout.margin + layout.contentWidth, document.y)
    .stroke()
    .restore();
}

function addPageFooters(document: PdfKitDocument): void {
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    const bottomMargin = document.page.margins.bottom;
    document.page.margins.bottom = 0;
    document
      .save()
      .lineWidth(0.6)
      .strokeColor(color.line)
      .moveTo(layout.margin, layout.footerY - 8)
      .lineTo(layout.margin + layout.contentWidth, layout.footerY - 8)
      .stroke()
      .restore();
    document
      .font("Helvetica")
      .fontSize(8)
      .fillColor(color.muted)
      .text(
        "Chaoran Property Intelligence | Unreviewed draft",
        layout.margin,
        layout.footerY,
        {
          lineBreak: false,
          width: layout.contentWidth - 90,
        },
      );
    document.text(
      `Page ${index - range.start + 1} of ${range.count}`,
      layout.margin + layout.contentWidth - 90,
      layout.footerY,
      {
        align: "right",
        lineBreak: false,
        width: 90,
      },
    );
    document.page.margins.bottom = bottomMargin;
  }
}

function ensureSpace(document: PdfKitDocument, requiredHeight: number): void {
  const contentBottom = document.page.height - document.page.margins.bottom;
  if (document.y + requiredHeight > contentBottom) {
    document.addPage();
  }
}

function formatPropertyFacts(listing: ShowingListPropertyContext): string {
  return [
    `Price: ${listing.price === null ? "Not provided" : formatUsd(listing.price)}`,
    `Beds: ${formatOptionalNumber(listing.bedrooms)}`,
    `Baths: ${formatOptionalNumber(listing.bathrooms)}`,
    `Type: ${toPdfText(listing.propertyType ?? "Not provided")}`,
    `Status: ${toPdfText(listing.status)}`,
  ].join("  |  ");
}

function formatMlsFacts(listing: ShowingListPropertyContext): string {
  const mlsIdentity = [listing.mlsName, listing.mlsNumber]
    .filter((value): value is string => value !== null)
    .map(toPdfText)
    .join(" / ");
  return [
    `Listed: ${formatOptionalDate(listing.listedDate)}`,
    `MLS: ${mlsIdentity.length === 0 ? "Not provided" : mlsIdentity}`,
  ].join("  |  ");
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatOptionalNumber(value: number | null): string {
  return value === null
    ? "Not provided"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatOptionalDate(value: string | null): string {
  if (value === null) {
    return "Not provided";
  }
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
    year: "numeric",
  }).format(value);
}

function parseTimestamp(value: unknown): Date {
  if (typeof value !== "string") {
    throw new InvalidShowingListArtifactInputError();
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (match === null) {
    throw new InvalidShowingListArtifactInputError();
  }

  const datePart = `${match[1]}-${match[2]}-${match[3]}`;
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  if (
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== datePart ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new InvalidShowingListArtifactInputError();
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new InvalidShowingListArtifactInputError();
  }
  return date;
}

function isValidListing(value: unknown): value is ShowingListPropertyContext {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isUuid(value.id) &&
    isBoundedText(value.formattedAddress, 500) &&
    isCoordinate(value.latitude, -90, 90) &&
    isCoordinate(value.longitude, -180, 180) &&
    isOptionalBoundedText(value.propertyType, 100) &&
    isOptionalNumber(value.bedrooms, 0, 100) &&
    isOptionalNumber(value.bathrooms, 0, 100) &&
    isOptionalNumber(value.price, 0, 2_147_483_647) &&
    isBoundedText(value.status, 100) &&
    isOptionalDate(value.listedDate) &&
    isOptionalBoundedText(value.mlsName, 100) &&
    isOptionalBoundedText(value.mlsNumber, 100)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    /\S/u.test(value)
  );
}

function isOptionalBoundedText(
  value: unknown,
  maximumLength: number,
): value is string | null {
  return value === null || isBoundedText(value, maximumLength);
}

function isCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isOptionalNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number | null {
  return value === null || isCoordinate(value, minimum, maximum);
}

function isOptionalDate(value: unknown): value is string | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toPdfText(value: string): string {
  return value
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/gu, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/gu, '"')
    .replace(/\u2026/gu, "...")
    .replace(/\u00A0/gu, " ")
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/gu, "?");
}

function collectDocumentBytes(
  document: PdfKitDocument,
  maximumBytes: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    document.on("data", (chunk: Buffer | Uint8Array) => {
      const buffer = Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes <= maximumBytes) {
        chunks.push(buffer);
      }
    });
    document.once("error", () => {
      reject(new ShowingListArtifactRenderingError());
    });
    document.once("end", () => {
      if (totalBytes < 1 || totalBytes > maximumBytes) {
        reject(new ShowingListArtifactRenderingError());
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks, totalBytes)));
    });
  });
}
