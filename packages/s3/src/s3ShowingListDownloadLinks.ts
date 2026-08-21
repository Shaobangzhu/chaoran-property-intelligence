import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  SHOWING_LIST_ARTIFACT,
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  SHOWING_LIST_DOWNLOAD_LINK_LIMITS,
  type ShowingListDownloadLink,
  type ShowingListDownloadLinkPort,
} from "@chaoran-property-intelligence/application";

export interface S3ShowingListDownloadLinksOptions {
  bucketName: string;
  client?: S3Client;
  now?: () => Date;
  presign?: (
    command: GetObjectCommand,
    expiresInSeconds: number,
  ) => Promise<string>;
}

export class S3ShowingListDownloadLinks
  implements ShowingListDownloadLinkPort
{
  private readonly bucketName: string;
  private readonly now: () => Date;
  private readonly presign: (
    command: GetObjectCommand,
    expiresInSeconds: number,
  ) => Promise<string>;

  constructor(options: S3ShowingListDownloadLinksOptions) {
    if (!isBucketName(options.bucketName)) {
      throw new RangeError("S3 Showing List artifact bucket name was invalid");
    }

    const client = options.client ?? new S3Client({});
    this.bucketName = options.bucketName;
    this.now = options.now ?? (() => new Date());
    this.presign =
      options.presign ??
      ((command, expiresInSeconds) =>
        getSignedUrl(client, command, { expiresIn: expiresInSeconds }));
  }

  async createCurrentDownloadLink(input: {
    expiresInSeconds: number;
  }): Promise<ShowingListDownloadLink> {
    if (
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds <
        SHOWING_LIST_DOWNLOAD_LINK_LIMITS.minimumExpiresInSeconds ||
      input.expiresInSeconds >
        SHOWING_LIST_DOWNLOAD_LINK_LIMITS.maximumExpiresInSeconds
    ) {
      throw new RangeError("Showing List download link expiry was invalid");
    }

    const now = this.now();
    if (!Number.isFinite(now.getTime())) {
      throw new RangeError("Showing List download link clock was invalid");
    }

    let url: string;
    try {
      url = await this.presign(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
          ResponseContentDisposition: `attachment; filename="${SHOWING_LIST_ARTIFACT.fileName}"`,
          ResponseContentType: SHOWING_LIST_ARTIFACT.mediaType,
        }),
        input.expiresInSeconds,
      );
    } catch {
      throw new Error("Showing List download link was unavailable");
    }

    if (!isValidPresignedUrl(url)) {
      throw new Error("Showing List download link was unavailable");
    }

    return {
      url,
      expiresAt: new Date(
        now.getTime() + input.expiresInSeconds * 1_000,
      ).toISOString(),
    };
  }
}

function isValidPresignedUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > SHOWING_LIST_DOWNLOAD_LINK_LIMITS.maximumUrlLength
  ) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hash.length === 0;
  } catch {
    return false;
  }
}

function isBucketName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) &&
    !value.includes("..") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
  );
}
