import { describe, expect, it } from "vitest";

import { NodePostgresDatabase } from "./nodePostgresDatabase.js";

describe("NodePostgresDatabase", () => {
  it("commits a successful transaction and releases its client", async () => {
    const pool = new FakePool();
    const database = new NodePostgresDatabase(pool);

    const result = await database.transaction(async (connection) => {
      await connection.query("INSERT INTO example VALUES ($1)", ["value"]);
      return "done";
    });

    expect(result).toBe("done");
    expect(pool.client.queries.map((query) => query.text)).toEqual([
      "BEGIN",
      "INSERT INTO example VALUES ($1)",
      "COMMIT",
    ]);
    expect(pool.client.releaseCount).toBe(1);
  });

  it("rolls back a failed transaction and releases its client", async () => {
    const pool = new FakePool();
    const database = new NodePostgresDatabase(pool);

    await expect(
      database.transaction(async () => {
        throw new Error("insert failed");
      }),
    ).rejects.toThrow("insert failed");

    expect(pool.client.queries.map((query) => query.text)).toEqual([
      "BEGIN",
      "ROLLBACK",
    ]);
    expect(pool.client.releaseCount).toBe(1);
  });
});

interface RecordedQuery {
  text: string;
  parameters: readonly unknown[];
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];
  releaseCount = 0;

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<{ rows: unknown[] }> {
    this.queries.push({ text, parameters });
    return { rows: [] };
  }

  release(): void {
    this.releaseCount += 1;
  }
}

class FakePool {
  readonly client = new FakeClient();

  async query(): Promise<{ rows: unknown[] }> {
    return { rows: [] };
  }

  async connect(): Promise<FakeClient> {
    return this.client;
  }

  async end(): Promise<void> {}
}
