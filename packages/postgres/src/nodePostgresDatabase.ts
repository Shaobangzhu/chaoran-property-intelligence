import type {
  SqlConnection,
  SqlDatabase,
  SqlQueryResult,
} from "./sqlDatabase.js";

interface PgQueryResultLike {
  rows: unknown[];
}

interface PgQueryableLike {
  query(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<PgQueryResultLike>;
}

interface PgClientLike extends PgQueryableLike {
  release(): void;
}

export interface PgPoolLike extends PgQueryableLike {
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

export class NodePostgresDatabase implements SqlDatabase {
  constructor(private readonly pool: PgPoolLike) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    const result = await this.pool.query(text, parameters);
    return { rows: result.rows };
  }

  async transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
