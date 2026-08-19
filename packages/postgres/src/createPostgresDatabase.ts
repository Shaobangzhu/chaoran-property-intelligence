import pg, {
  type Pool as PgPool,
  type PoolClient as PgPoolClient,
} from "pg";

import {
  NodePostgresDatabase,
  type PgPoolLike,
} from "./nodePostgresDatabase.js";
import type { SqlDatabase } from "./sqlDatabase.js";

const { Pool } = pg;

export function createPostgresDatabase(
  connectionString: string,
): SqlDatabase {
  const pool = new Pool({
    connectionString,
    max: 1,
  });

  return new NodePostgresDatabase(new PgPoolAdapter(pool));
}

class PgPoolAdapter implements PgPoolLike {
  constructor(private readonly pool: PgPool) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<{ rows: unknown[] }> {
    const result = await this.pool.query(text, [...parameters]);
    return { rows: result.rows };
  }

  async connect(): Promise<PgClientAdapter> {
    return new PgClientAdapter(await this.pool.connect());
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class PgClientAdapter {
  constructor(private readonly client: PgPoolClient) {}

  async query(
    text: string,
    parameters: readonly unknown[] = [],
  ): Promise<{ rows: unknown[] }> {
    const result = await this.client.query(text, [...parameters]);
    return { rows: result.rows };
  }

  release(): void {
    this.client.release();
  }
}
