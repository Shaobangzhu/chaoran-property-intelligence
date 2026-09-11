import {
  SendMessageCommand,
  type SendMessageCommandOutput,
} from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";

import {
  SqsListingRefreshDispatcher,
  type SqsSendMessageClient,
} from "./sqsListingRefreshDispatcher.js";

const runId = "0198c7d2-7668-7775-b0fc-b789690a6013";

describe("SqsListingRefreshDispatcher", () => {
  it("sends only an opaque run identity and bounded routing metadata", async () => {
    const client = new RecordingSqsClient();
    const dispatcher = new SqsListingRefreshDispatcher(
      {
        queueUrl:
          "https://sqs.us-west-2.amazonaws.com/111111111111/cpi-dev-listing-refresh",
        region: "us-west-2",
        stage: "dev",
      },
      client,
    );

    await dispatcher.dispatch(runId);

    const command = client.commands[0];
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command?.input).toEqual({
      MessageBody: JSON.stringify({
        runId,
        schemaVersion: 1,
        stage: "dev",
      }),
      QueueUrl:
        "https://sqs.us-west-2.amazonaws.com/111111111111/cpi-dev-listing-refresh",
    });
    expect(Object.keys(JSON.parse(command!.input.MessageBody!))).toEqual([
      "runId",
      "schemaVersion",
      "stage",
    ]);
  });

  it("rejects a non-opaque run identity before contacting SQS", async () => {
    const client = new RecordingSqsClient();
    const dispatcher = new SqsListingRefreshDispatcher(
      {
        queueUrl:
          "https://sqs.us-west-2.amazonaws.com/111111111111/cpi-listing-refresh",
        region: "us-west-2",
        stage: "production",
      },
      client,
    );

    await expect(dispatcher.dispatch("criteria=corona")).rejects.toThrow(
      "Invalid listing refresh run ID",
    );
    expect(client.commands).toHaveLength(0);
  });

  it("does not expose provider details when SQS rejects a send", async () => {
    const dispatcher = new SqsListingRefreshDispatcher(
      {
        queueUrl:
          "https://sqs.us-west-2.amazonaws.com/111111111111/cpi-dev-listing-refresh",
        region: "us-west-2",
        stage: "dev",
      },
      new RecordingSqsClient(new Error("private provider response")),
    );

    await expect(dispatcher.dispatch(runId)).rejects.toThrow(
      "Listing refresh dispatch failed",
    );
  });
});

class RecordingSqsClient implements SqsSendMessageClient {
  readonly commands: SendMessageCommand[] = [];

  constructor(private readonly error: Error | null = null) {}

  async send(command: SendMessageCommand): Promise<SendMessageCommandOutput> {
    this.commands.push(command);
    if (this.error !== null) throw this.error;
    return { $metadata: {}, MessageId: "message-id" };
  }
}
