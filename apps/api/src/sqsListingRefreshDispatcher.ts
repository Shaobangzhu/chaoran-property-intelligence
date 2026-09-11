import {
  SendMessageCommand,
  SQSClient,
  type SendMessageCommandOutput,
} from "@aws-sdk/client-sqs";
import type { ListingRefreshDispatchPort } from "@chaoran-property-intelligence/application";

import type {
  ApplicationDeploymentStage,
  ListingRefreshDispatchConfig,
} from "./apiConfig.js";

const runIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface SqsSendMessageClient {
  send(command: SendMessageCommand): Promise<SendMessageCommandOutput>;
}

export class SqsListingRefreshDispatcher
  implements ListingRefreshDispatchPort
{
  private readonly client: SqsSendMessageClient;
  private readonly queueUrl: string;
  private readonly stage: ApplicationDeploymentStage;

  constructor(
    config: ListingRefreshDispatchConfig,
    client: SqsSendMessageClient = new SQSClient({ region: config.region }),
  ) {
    this.client = client;
    this.queueUrl = config.queueUrl;
    this.stage = config.stage;
  }

  async dispatch(runId: string): Promise<void> {
    if (!runIdPattern.test(runId)) {
      throw new Error("Invalid listing refresh run ID");
    }

    try {
      await this.client.send(
        new SendMessageCommand({
          MessageBody: JSON.stringify({
            runId,
            schemaVersion: 1,
            stage: this.stage,
          }),
          QueueUrl: this.queueUrl,
        }),
      );
    } catch (error) {
      throw new Error("Listing refresh dispatch failed", { cause: error });
    }
  }
}
