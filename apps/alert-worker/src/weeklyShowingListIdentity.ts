import { createHash } from "node:crypto";

import type { ScheduledShowingListConfiguration } from "./showingListProductionConfig.js";

export function createWeeklyShowingListGenerationId(input: {
  now: Date;
  timeZone: string;
  generation: ScheduledShowingListConfiguration;
}): string {
  if (!Number.isFinite(input.now.getTime())) {
    throw new RangeError("Weekly Showing List clock was invalid");
  }

  const localWeekStartedOn = formatLocalWeekStart(input.now, input.timeZone);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        localWeekStartedOn,
        timeZone: input.timeZone,
        actorUserId: input.generation.actorUserId,
        request: input.generation.request,
      }),
    )
    .digest();

  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function formatLocalWeekStart(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(now);
  const year = readPart(parts, "year");
  const month = readPart(parts, "month");
  const day = readPart(parts, "day");
  const localDate = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - daysSinceMonday);
  return localDate.toISOString().slice(0, 10);
}

function readPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) {
    throw new RangeError("Weekly Showing List time zone was invalid");
  }
  return value;
}
