import { createHash } from "node:crypto";

import {
  PutObjectCommand,
  type PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import {
  InvalidShowingListArtifactStoreInputError,
  SHOWING_LIST_ARTIFACT_LIMITS,
  ShowingListArtifactStoreInvalidResponseError,
  ShowingListArtifactStoreUnavailableError,
  type RenderedShowingListArtifact,
} from "@chaoran-property-intelligence/application";

import {
  S3ShowingListArtifactStore,
  type S3PutObjectClient,
} from "./s3ShowingListArtifactStore.js";

const bucketName = "cpi-showing-list-artifacts-111111111111";
const expectedBucketOwner = "111111111111";

describe("S3ShowingListArtifactStore", () => {
  it("replaces only the stable current PDF with bounded private metadata", async () => {
    const client = new RecordingS3Client({
      $metadata: {},
      ETag: '"first-etag"',
    });
    const store = createStore(client);
    const artifact = createArtifact();

    await expect(store.replaceCurrentArtifact(artifact)).resolves.toEqual({
      key: "showing-lists/current.pdf",
      etag: '"first-etag"',
    });

    expect(client.commands).toHaveLength(1);
    const command = client.commands[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command?.input).toEqual({
      Body: Buffer.from(artifact.bytes),
      Bucket: bucketName,
      CacheControl: "no-store, max-age=0",
      ChecksumSHA256: createHash("sha256")
        .update(artifact.bytes)
        .digest("base64"),
      ContentDisposition: 'attachment; filename="showing-list-draft.pdf"',
      ContentLength: artifact.bytes.byteLength,
      ContentType: "application/pdf",
      ExpectedBucketOwner: expectedBucketOwner,
      Key: "showing-lists/current.pdf",
      ServerSideEncryption: "AES256",
    });
    expect(command?.input).not.toHaveProperty("ACL");
    expect(command?.input).not.toHaveProperty("Metadata");
  });

  it("uses the same object key for every replacement", async () => {
    const client = new RecordingS3Client({
      $metadata: {},
      ETag: '"replacement-etag"',
    });
    const store = createStore(client);

    await store.replaceCurrentArtifact(createArtifact(new Uint8Array([1])));
    await store.replaceCurrentArtifact(createArtifact(new Uint8Array([2])));

    expect(client.commands.map((command) => command.input.Key)).toEqual([
      "showing-lists/current.pdf",
      "showing-lists/current.pdf",
    ]);
  });

  it.each([
    ["an empty artifact", createArtifact(new Uint8Array())],
    [
      "an oversized artifact",
      createArtifact(
        new Uint8Array(SHOWING_LIST_ARTIFACT_LIMITS.maximumBytes + 1),
      ),
    ],
    [
      "the wrong media type",
      { ...createArtifact(), mediaType: "text/plain" },
    ],
    [
      "the wrong filename",
      { ...createArtifact(), fileName: "history.pdf" },
    ],
    [
      "an unexpected field",
      { ...createArtifact(), generationId: "must-not-become-object-metadata" },
    ],
    ["a non-object payload", null],
  ])("rejects %s before calling S3", async (_label, artifact) => {
    const client = new RecordingS3Client({
      $metadata: {},
      ETag: '"unused"',
    });
    const store = createStore(client);

    await expect(
      store.replaceCurrentArtifact(
        artifact as unknown as RenderedShowingListArtifact,
      ),
    ).rejects.toBeInstanceOf(InvalidShowingListArtifactStoreInputError);
    expect(client.commands).toEqual([]);
  });

  it.each([
    ["a missing ETag", { $metadata: {} }],
    ["a blank ETag", { $metadata: {}, ETag: " " }],
    [
      "an oversized ETag",
      { $metadata: {}, ETag: `"${"x".repeat(256)}"` },
    ],
    [
      "an unexpected object version",
      { $metadata: {}, ETag: '"etag"', VersionId: "version-1" },
    ],
  ])("rejects %s from S3", async (_label, response) => {
    const store = createStore(new RecordingS3Client(response));

    await expect(
      store.replaceCurrentArtifact(createArtifact()),
    ).rejects.toBeInstanceOf(ShowingListArtifactStoreInvalidResponseError);
  });

  it("maps provider failures to one non-sensitive storage error", async () => {
    const client = new RecordingS3Client(
      new Error(`Access denied for ${bucketName}`),
    );
    const store = createStore(client);

    const error = await store
      .replaceCurrentArtifact(createArtifact())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ShowingListArtifactStoreUnavailableError);
    expect((error as Error).message).toBe(
      "Showing List artifact storage was unavailable",
    );
    expect((error as Error).message).not.toContain(bucketName);
  });

  it.each([
    ["AB", expectedBucketOwner],
    ["Bucket-With-Uppercase", expectedBucketOwner],
    ["192.168.0.1", expectedBucketOwner],
    [bucketName, "1111-1111-1111"],
    [bucketName, "not-an-account"],
  ])("rejects invalid configuration %s / %s", (bucket, owner) => {
    expect(
      () =>
        new S3ShowingListArtifactStore({
          bucketName: bucket,
          expectedBucketOwner: owner,
          client: new RecordingS3Client({ $metadata: {}, ETag: '"etag"' }),
        }),
    ).toThrow(RangeError);
  });
});

function createStore(client: S3PutObjectClient): S3ShowingListArtifactStore {
  return new S3ShowingListArtifactStore({
    bucketName,
    expectedBucketOwner,
    client,
  });
}

function createArtifact(
  bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]),
): RenderedShowingListArtifact {
  return {
    bytes,
    mediaType: "application/pdf",
    fileName: "showing-list-draft.pdf",
  };
}

class RecordingS3Client implements S3PutObjectClient {
  readonly commands: PutObjectCommand[] = [];

  constructor(
    private readonly result: PutObjectCommandOutput | Error,
  ) {}

  async send(command: PutObjectCommand): Promise<PutObjectCommandOutput> {
    this.commands.push(command);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}
