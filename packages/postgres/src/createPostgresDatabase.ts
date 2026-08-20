import pg, {
  type Pool as PgPool,
  type PoolClient as PgPoolClient,
  type PoolConfig,
} from "pg";

import {
  NodePostgresDatabase,
  type PgPoolLike,
} from "./nodePostgresDatabase.js";
import type { SqlDatabase } from "./sqlDatabase.js";

const { Pool } = pg;

export type PostgresConnectionConfig =
  | {
      kind: "connection-string";
      connectionString: string;
    }
  | {
      kind: "parameters";
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      ssl: true;
    };

export function createPostgresDatabase(
  connection: PostgresConnectionConfig,
): SqlDatabase {
  const pool = new Pool(createPoolConfig(connection));

  return new NodePostgresDatabase(new PgPoolAdapter(pool));
}

function createPoolConfig(connection: PostgresConnectionConfig): PoolConfig {
  const sharedConfig: PoolConfig = {
    max: 1,
    connectionTimeoutMillis: 60_000,
    application_name: "chaoran-property-alert-worker",
  };

  if (connection.kind === "connection-string") {
    return {
      ...sharedConfig,
      connectionString: connection.connectionString,
    };
  }

  return {
    ...sharedConfig,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: connection.ssl,
  };
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
