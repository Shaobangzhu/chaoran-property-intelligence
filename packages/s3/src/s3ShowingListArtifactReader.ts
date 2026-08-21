import {
  GetObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  SHOWING_LIST_ARTIFACT,
  SHOWING_LIST_ARTIFACT_LIMITS,
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  ShowingListArtifactChangedError,
  ShowingListArtifactReaderInvalidResponseError,
  ShowingListArtifactReaderUnavailableError,
  type RenderedShowingListArtifact,
  type ShowingListArtifactReaderPort,
  type StoredShowingListArtifact,
} from "@chaoran-property-intelligence/application";

export interface S3GetObjectClient {
  send(command: GetObjectCommand): Promise<GetObjectCommandOutput>;
}

export interface S3ShowingListArtifactReaderOptions {
  bucketName: string;
  expectedBucketOwner: string;
  client?: S3GetObjectClient;
}

export class S3ShowingListArtifactReader
  implements ShowingListArtifactReaderPort
{
  private readonly bucketName: string;
  private readonly expectedBucketOwner: string;
  private readonly client: S3GetObjectClient;

  constructor(options: S3ShowingListArtifactReaderOptions) {
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

  async readCurrentArtifact(
    expected: StoredShowingListArtifact,
  ): Promise<RenderedShowingListArtifact> {
    if (!isExpectedArtifact(expected)) {
      throw new ShowingListArtifactReaderInvalidResponseError();
    }

    let response: GetObjectCommandOutput;
    try {
      response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          ExpectedBucketOwner: this.expectedBucketOwner,
          IfMatch: expected.etag,
          Key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
        }),
      );
    } catch (error) {
      if (isPreconditionFailure(error)) {
        throw new ShowingListArtifactChangedError();
      }
      throw new ShowingListArtifactReaderUnavailableError();
    }

    if (
      response.ETag !== expected.etag ||
      response.VersionId !== undefined ||
      response.ContentType !== SHOWING_LIST_ARTIFACT.mediaType ||
      response.ContentLength === undefined ||
      !Number.isSafeInteger(response.ContentLength) ||
      response.ContentLength < 1 ||
      response.ContentLength > SHOWING_LIST_ARTIFACT_LIMITS.maximumBytes ||
      response.Body === undefined
    ) {
      throw new ShowingListArtifactReaderInvalidResponseError();
    }

    let bytes: Uint8Array;
    try {
      bytes = await response.Body.transformToByteArray();
    } catch {
      throw new ShowingListArtifactReaderUnavailableError();
    }
    if (
      bytes.byteLength !== response.ContentLength ||
      bytes.byteLength < 1 ||
      bytes.byteLength > SHOWING_LIST_ARTIFACT_LIMITS.maximumBytes
    ) {
      throw new ShowingListArtifactReaderInvalidResponseError();
    }

    return {
      bytes: new Uint8Array(bytes),
      fileName: SHOWING_LIST_ARTIFACT.fileName,
      mediaType: SHOWING_LIST_ARTIFACT.mediaType,
    };
  }
}

function isExpectedArtifact(value: unknown): value is StoredShowingListArtifact {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    (value as StoredShowingListArtifact).key ===
      SHOWING_LIST_CURRENT_ARTIFACT_KEY &&
    typeof (value as StoredShowingListArtifact).etag === "string" &&
    (value as StoredShowingListArtifact).etag.length <= 256 &&
    /\S/u.test((value as StoredShowingListArtifact).etag)
  );
}

function isPreconditionFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    record.name === "PreconditionFailed" ||
    record.$metadata?.httpStatusCode === 412
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
