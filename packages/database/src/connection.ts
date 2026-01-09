import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as syncSchema from './schemas/sync/index.ts';
import * as appSchema from './schemas/app/index.ts';
import * as cronsSchema from './schemas/crons/index.ts';

/**
 * Combined schema for type safety
 */
export const schema = {
  ...syncSchema,
  ...appSchema,
  ...cronsSchema,
};

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;

/**
 * Database connection options
 */
export interface ConnectionOptions {
  connectionString: string;
  maxConnections?: number;
  idleTimeout?: number;
  connectTimeout?: number;
}

/**
 * Create a database connection
 */
export function createConnection(options: ConnectionOptions): {
  db: Database;
  client: postgres.Sql;
} {
  const client = postgres(options.connectionString, {
    max: options.maxConnections ?? 10,
    idle_timeout: options.idleTimeout ?? 20,
    connect_timeout: options.connectTimeout ?? 30,
    prepare: false, // Required for some edge cases
  });

  const db = drizzle(client, { schema });

  return { db, client };
}

/**
 * Close database connection
 */
export async function closeConnection(client: postgres.Sql): Promise<void> {
  await client.end();
}

/**
 * Test database connection
 */
export async function testConnection(db: Database): Promise<boolean> {
  try {
    await db.execute(sql.raw('SELECT 1'));
    return true;
  } catch {
    return false;
  }
}
