export interface SqlQueryResult {
  rows: readonly unknown[];
}

export interface SqlConnection {
  query(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult>;
}

export interface SqlDatabase extends SqlConnection {
  transaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}
