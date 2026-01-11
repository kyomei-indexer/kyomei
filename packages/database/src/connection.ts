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
 * Parse connection string to extract host/port for error messages
 */
function parseConnectionInfo(connectionString: string): {
  host: string;
  port: string;
  database: string;
  user: string;
} {
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname || 'localhost',
      port: url.port || '5432',
      database: url.pathname.slice(1) || 'unknown',
      user: url.username || 'unknown',
    };
  } catch {
    return { host: 'unknown', port: '5432', database: 'unknown', user: 'unknown' };
  }
}

/**
 * Database connection error with helpful context
 */
export class DatabaseConnectionError extends Error {
  constructor(
    message: string,
    public readonly host: string,
    public readonly port: string,
    public readonly database: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'DatabaseConnectionError';
  }
}

/**
 * Create a database connection
 */
export function createConnection(options: ConnectionOptions): {
  db: Database;
  client: postgres.Sql;
} {
  const client = postgres(options.connectionString, {
    max: options.maxConnections ?? 100,  // Increased from 10 to 100 for parallel workers + handlers
    idle_timeout: options.idleTimeout ?? 20,
    connect_timeout: options.connectTimeout ?? 30,
    prepare: false, // Required for some edge cases
    onnotice: () => {}, // Suppress notice messages
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
 * Test database connection with detailed error reporting
 */
export async function testConnection(
  db: Database,
  connectionString?: string
): Promise<{ success: boolean; error?: string; details?: string }> {
  const info = connectionString 
    ? parseConnectionInfo(connectionString)
    : { host: 'unknown', port: '5432', database: 'unknown', user: 'unknown' };

  try {
    await db.execute(sql.raw('SELECT 1'));
    return { success: true };
  } catch (err) {
    const error = err as Error & { code?: string };
    
    // Provide helpful error messages based on error type
    if (error.code === 'ECONNREFUSED') {
      return {
        success: false,
        error: `Connection refused to ${info.host}:${info.port}`,
        details: `Database server is not running or not accepting connections.\n` +
          `  → Check if PostgreSQL is running: docker ps | grep postgres\n` +
          `  → Start with: pnpm db:up\n` +
          `  → Or check DATABASE_URL environment variable`,
      };
    }
    
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      return {
        success: false,
        error: `Cannot resolve hostname: ${info.host}`,
        details: `DNS lookup failed. Check your DATABASE_URL hostname.`,
      };
    }
    
    if (error.code === '28P01' || error.message?.includes('password')) {
      return {
        success: false,
        error: `Authentication failed for user "${info.user}"`,
        details: `Check your database credentials in DATABASE_URL.`,
      };
    }
    
    if (error.code === '3D000') {
      return {
        success: false,
        error: `Database "${info.database}" does not exist`,
        details: `Create the database or check DATABASE_URL.`,
      };
    }
    
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      return {
        success: false,
        error: `Connection timeout to ${info.host}:${info.port}`,
        details: `Database server is not responding. Check network/firewall settings.`,
      };
    }
    
    // Generic error
    return {
      success: false,
      error: error.message || 'Unknown database error',
      details: error.code ? `Error code: ${error.code}` : undefined,
    };
  }
}

/**
 * Simple connection test (returns boolean for backward compatibility)
 */
export async function isConnected(db: Database): Promise<boolean> {
  const result = await testConnection(db);
  return result.success;
}
