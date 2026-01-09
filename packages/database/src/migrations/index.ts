import type { Database } from '../connection.ts';
import { sql } from 'drizzle-orm';

// Import migrations
import * as m0001 from './0001_init_schemas.ts';
import * as m0002 from './0002_create_sync_tables.ts';
import * as m0003 from './0003_create_app_tables.ts';
import * as m0004 from './0004_create_crons_tables.ts';

/**
 * Migration definition
 */
interface Migration {
  version: number;
  name: string;
  up: (db: Database) => Promise<void>;
  down: (db: Database) => Promise<void>;
}

/**
 * All migrations in order
 */
export const migrations: Migration[] = [
  { version: 1, name: '0001_init_schemas', ...m0001.migration },
  { version: 2, name: '0002_create_sync_tables', ...m0002.migration },
  { version: 3, name: '0003_create_app_tables', ...m0003.migration },
  { version: 4, name: '0004_create_crons_tables', ...m0004.migration },
];

/**
 * Migration runner
 */
export class MigrationRunner {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Initialize migrations table
   */
  async init(): Promise<void> {
    await this.db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS public.kyomei_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `));
  }

  /**
   * Get applied migration versions
   */
  async getAppliedVersions(): Promise<number[]> {
    const result = await this.db.execute(sql.raw(`
      SELECT version FROM public.kyomei_migrations ORDER BY version;
    `));
    return (result as any[]).map((row) => row.version);
  }

  /**
   * Run pending migrations
   */
  async up(): Promise<string[]> {
    await this.init();
    const applied = await this.getAppliedVersions();
    const pending = migrations.filter((m) => !applied.includes(m.version));
    const results: string[] = [];

    for (const migration of pending) {
      console.log(`Running migration: ${migration.name}`);
      await migration.up(this.db);
      await this.db.execute(sql.raw(`
        INSERT INTO public.kyomei_migrations (version, name)
        VALUES (${migration.version}, '${migration.name}');
      `));
      results.push(migration.name);
    }

    return results;
  }

  /**
   * Rollback last migration
   */
  async down(): Promise<string | null> {
    await this.init();
    const applied = await this.getAppliedVersions();

    if (applied.length === 0) {
      return null;
    }

    const lastVersion = Math.max(...applied);
    const migration = migrations.find((m) => m.version === lastVersion);

    if (!migration) {
      throw new Error(`Migration version ${lastVersion} not found`);
    }

    console.log(`Rolling back migration: ${migration.name}`);
    await migration.down(this.db);
    await this.db.execute(sql.raw(`
      DELETE FROM public.kyomei_migrations WHERE version = ${lastVersion};
    `));

    return migration.name;
  }

  /**
   * Reset all migrations
   */
  async reset(): Promise<void> {
    const applied = await this.getAppliedVersions();

    // Rollback in reverse order
    for (const version of [...applied].reverse()) {
      const migration = migrations.find((m) => m.version === version);
      if (migration) {
        console.log(`Rolling back: ${migration.name}`);
        await migration.down(this.db);
      }
    }

    await this.db.execute(sql.raw(`
      DELETE FROM public.kyomei_migrations;
    `));
  }

  /**
   * Get migration status
   */
  async status(): Promise<Array<{
    version: number;
    name: string;
    applied: boolean;
    appliedAt?: Date;
  }>> {
    await this.init();
    const result = await this.db.execute(sql.raw(`
      SELECT version, name, applied_at FROM public.kyomei_migrations ORDER BY version;
    `));
    const appliedMap = new Map((result as any[]).map((row) => [row.version, row]));

    return migrations.map((m) => ({
      version: m.version,
      name: m.name,
      applied: appliedMap.has(m.version),
      appliedAt: appliedMap.get(m.version)?.applied_at,
    }));
  }
}
