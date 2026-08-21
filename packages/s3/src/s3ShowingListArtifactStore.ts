import { createHash } from "node:crypto";

import {
  PutObjectCommand,
  S3Client,
  type PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  InvalidShowingListArtifactStoreInputError,
  SHOWING_LIST_ARTIFACT,
  SHOWING_LIST_ARTIFACT_LIMITS,
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  SHOWING_LIST_PERSISTENCE_LIMITS,
  ShowingListArtifactStoreInvalidResponseError,
  ShowingListArtifactStoreUnavailableError,
  type RenderedShowingListArtifact,
  type ShowingListArtifactStorePort,
  type StoredShowingListArtifact,
} from "@chaoran-property-intelligence/application";

const artifactObjectKeys = ["bytes", "fileName", "mediaType"] as const;

export interface S3PutObjectClient {
  send(command: PutObjectCommand): Promise<PutObjectCommandOutput>;
}

export interface S3ShowingListArtifactStoreOptions {
  bucketName: string;
  expectedBucketOwner: string;
  client?: S3PutObjectClient;
}

export class S3ShowingListArtifactStore
  implements ShowingListArtifactStorePort
{
  private readonly bucketName: string;
  private readonly expectedBucketOwner: string;
  private readonly client: S3PutObjectClient;

  constructor(options: S3ShowingListArtifactStoreOptions) {
    if (!isBucketName(options.bucketName)) {
      throw new RangeError("S3 Showing List artifact bucket name was invalid");
    }
    if (!/^\d{12}$/.test(options.expectedBucketOwner)) {
      throw new RangeError("S3 expected bucket owner was invalid");
    }

    this.bucketName = options.bucketName;
    this.expectedBucketOwner = options.expectedBucketOwner;
    this.client = options.client ?? new S3Client({});
  }

  async replaceCurrentArtifact(
    artifact: RenderedShowingListArtifact,
  ): Promise<StoredShowingListArtifact> {
    if (!isValidArtifact(artifact)) {
      throw new InvalidShowingListArtifactStoreInputError();
    }

    const body = Buffer.from(artifact.bytes);
    const checksumSha256 = createHash("sha256").update(body).digest("base64");

    let response: PutObjectCommandOutput;
    try {
      response = await this.client.send(
        new PutObjectCommand({
          Body: body,
          Bucket: this.bucketName,
          CacheControl: "no-store, max-age=0",
          ChecksumSHA256: checksumSha256,
          ContentDisposition: `attachment; filename="${SHOWING_LIST_ARTIFACT.fileName}"`,
          ContentLength: body.byteLength,
          ContentType: SHOWING_LIST_ARTIFACT.mediaType,
          ExpectedBucketOwner: this.expectedBucketOwner,
          Key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
          ServerSideEncryption: "AES256",
        }),
      );
    } catch {
      throw new ShowingListArtifactStoreUnavailableError();
    }

    if (
      !isBoundedEtag(response.ETag) ||
      response.VersionId !== undefined
    ) {
      throw new ShowingListArtifactStoreInvalidResponseError();
    }

    return {
      key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      etag: response.ETag,
    };
  }
}

function isValidArtifact(
  value: unknown,
): value is RenderedShowingListArtifact {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return (
    keys.length === artifactObjectKeys.length &&
    artifactObjectKeys.every((key, index) => keys[index] === key) &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength >= 1 &&
    value.bytes.byteLength <= SHOWING_LIST_ARTIFACT_LIMITS.maximumBytes &&
    value.fileName === SHOWING_LIST_ARTIFACT.fileName &&
    value.mediaType === SHOWING_LIST_ARTIFACT.mediaType
  );
}

function isBoundedEtag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= SHOWING_LIST_PERSISTENCE_LIMITS.artifactEtag &&
    /\S/u.test(value)
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
