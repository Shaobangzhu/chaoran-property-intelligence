import { GetObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { S3ShowingListDownloadLinks } from "./s3ShowingListDownloadLinks.js";

const bucketName = "cpi-showing-list-artifacts-111111111111";
const now = new Date("2026-08-24T15:00:00.000Z");

describe("S3ShowingListDownloadLinks", () => {
  it("presigns only the stable current PDF for a bounded duration", async () => {
    const commands: GetObjectCommand[] = [];
    const expiries: number[] = [];
    const links = new S3ShowingListDownloadLinks({
      bucketName,
      now: () => now,
      presign: vi.fn(async (command, expiresInSeconds) => {
        commands.push(command);
        expiries.push(expiresInSeconds);
        return "https://signed.example/showing-lists/current.pdf?signature=secret";
      }),
    });

    await expect(
      links.createCurrentDownloadLink({ expiresInSeconds: 900 }),
    ).resolves.toEqual({
      url: "https://signed.example/showing-lists/current.pdf?signature=secret",
      expiresAt: "2026-08-24T15:15:00.000Z",
    });
    expect(expiries).toEqual([900]);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(GetObjectCommand);
    expect(commands[0]?.input).toEqual({
      Bucket: bucketName,
      Key: "showing-lists/current.pdf",
      ResponseContentDisposition:
        'attachment; filename="showing-list-draft.pdf"',
      ResponseContentType: "application/pdf",
    });
  });

  it.each([59, 901, 1.5])(
    "rejects an invalid expiry of %s seconds before signing",
    async (expiresInSeconds) => {
      const presign = vi.fn(async () => "https://signed.example/current.pdf");
      const links = new S3ShowingListDownloadLinks({ bucketName, presign });

      await expect(
        links.createCurrentDownloadLink({ expiresInSeconds }),
      ).rejects.toThrow("Showing List download link expiry was invalid");
      expect(presign).not.toHaveBeenCalled();
    },
  );

  it("maps signer errors without exposing a URL", async () => {
    const links = new S3ShowingListDownloadLinks({
      bucketName,
      presign: vi.fn(async () => {
        throw new Error("credential detail");
      }),
    });

    await expect(
      links.createCurrentDownloadLink({ expiresInSeconds: 900 }),
    ).rejects.toThrow("Showing List download link was unavailable");
  });

  it.each([
    "http://signed.example/current.pdf",
    "https://signed.example/current.pdf#fragment",
    "not-a-url",
  ])("rejects unsafe signer output %s", async (url) => {
    const links = new S3ShowingListDownloadLinks({
      bucketName,
      presign: vi.fn(async () => url),
    });

    await expect(
      links.createCurrentDownloadLink({ expiresInSeconds: 900 }),
    ).rejects.toThrow("Showing List download link was unavailable");
  });
});
