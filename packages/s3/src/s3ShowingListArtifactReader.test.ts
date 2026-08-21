import { GetObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import {
  SHOWING_LIST_CURRENT_ARTIFACT_KEY,
  ShowingListArtifactChangedError,
  ShowingListArtifactReaderInvalidResponseError,
  ShowingListArtifactReaderUnavailableError,
} from "@chaoran-property-intelligence/application";
import { describe, expect, it } from "vitest";

import {
  S3ShowingListArtifactReader,
  type S3GetObjectClient,
} from "./s3ShowingListArtifactReader.js";

describe("S3ShowingListArtifactReader", () => {
  it("reads the stable object with expected-owner and ETag protection", async () => {
    const client = new RecordingGetObjectClient(createResponse());
    const reader = createReader(client);

    await expect(
      reader.readCurrentArtifact({
        etag: '"artifact-etag"',
        key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      }),
    ).resolves.toEqual({
      bytes: new Uint8Array([37, 80, 68, 70]),
      fileName: "showing-list-draft.pdf",
      mediaType: "application/pdf",
    });

    const command = client.commands[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command?.input).toEqual({
      Bucket: "cpi-private-artifacts",
      ExpectedBucketOwner: "191227990660",
      IfMatch: '"artifact-etag"',
      Key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
    });
  });

  it("maps a failed ETag precondition to a changed error", async () => {
    const client = new RecordingGetObjectClient(
      Promise.reject({ name: "PreconditionFailed" }),
    );

    await expect(
      createReader(client).readCurrentArtifact({
        etag: '"artifact-etag"',
        key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      }),
    ).rejects.toThrow(ShowingListArtifactChangedError);
  });

  it("maps provider and body-stream failures to unavailable", async () => {
    const providerClient = new RecordingGetObjectClient(
      Promise.reject(new Error("private provider details")),
    );
    await expect(
      createReader(providerClient).readCurrentArtifact({
        etag: '"artifact-etag"',
        key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      }),
    ).rejects.toThrow(ShowingListArtifactReaderUnavailableError);

    const bodyClient = new RecordingGetObjectClient(
      createResponse({
        Body: {
          async transformToByteArray() {
            throw new Error("stream failed");
          },
        } as never,
      }),
    );
    await expect(
      createReader(bodyClient).readCurrentArtifact({
        etag: '"artifact-etag"',
        key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      }),
    ).rejects.toThrow(ShowingListArtifactReaderUnavailableError);
  });

  it.each([
    { ETag: '"different"' },
    { VersionId: "unexpected-version" },
    { ContentType: "text/plain" },
    { ContentLength: 0 },
    { ContentLength: 6 * 1_024 * 1_024 },
    { Body: undefined },
  ])("rejects malformed metadata: %o", async (override) => {
    const client = new RecordingGetObjectClient(
      createResponse(override as unknown as Partial<GetObjectCommandOutput>),
    );

    await expect(
      createReader(client).readCurrentArtifact({
        etag: '"artifact-etag"',
        key: SHOWING_LIST_CURRENT_ARTIFACT_KEY,
      }),
    ).rejects.toThrow(ShowingListArtifactReaderInvalidResponseError);
  });
});

class RecordingGetObjectClient implements S3GetObjectClient {
  readonly commands: GetObjectCommand[] = [];

  constructor(
    private readonly response:
      | GetObjectCommandOutput
      | Promise<GetObjectCommandOutput>,
  ) {}

  async send(command: GetObjectCommand): Promise<GetObjectCommandOutput> {
    this.commands.push(command);
    return this.response;
  }
}

function createReader(client: S3GetObjectClient) {
  return new S3ShowingListArtifactReader({
    bucketName: "cpi-private-artifacts",
    client,
    expectedBucketOwner: "191227990660",
  });
}

function createResponse(
  overrides: Partial<GetObjectCommandOutput> = {},
): GetObjectCommandOutput {
  return {
    $metadata: {},
    Body: {
      async transformToByteArray() {
        return new Uint8Array([37, 80, 68, 70]);
      },
    } as never,
    ContentLength: 4,
    ContentType: "application/pdf",
    ETag: '"artifact-etag"',
    ...overrides,
  };
}
