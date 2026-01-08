import { createConnection, MigrationRunner, type Database } from '@kyomei/database';
import type postgres from 'postgres';

/**
 * Test database wrapper
 */
export class TestDatabase {
  readonly db: Database;
  readonly client: postgres.Sql;

  constructor(db: Database, client: postgres.Sql) {
    this.db = db;
    this.client = client;
  }

  /**
   * Run all migrations
   */
  async migrate(): Promise<void> {
    const runner = new MigrationRunner(this.db);
    await runner.up();
  }

  /**
   * Reset database (drop and recreate)
   */
  async reset(): Promise<void> {
    const runner = new MigrationRunner(this.db);
    await runner.reset();
    await runner.up();
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    await this.client.end();
  }
}

/**
 * Create a test database connection
 */
export async function createTestDatabase(connectionString?: string): Promise<TestDatabase> {
  const connString =
    connectionString ??
    process.env.TEST_DATABASE_URL ??
    'postgresql://kyomei_test:kyomei_test@localhost:5433/kyomei_test';

  const { db, client } = createConnection({
    connectionString: connString,
    maxConnections: 5,
  });

  const testDb = new TestDatabase(db, client);
  await testDb.migrate();

  return testDb;
}
