import type { Database } from '../connection.js';
import { sql } from 'drizzle-orm';

/**
 * Migration: Initialize schemas
 * Creates the required PostgreSQL schemas for Kyomei
 */
export async function up(db: Database): Promise<void> {
  // Create TimescaleDB extension if not exists
  await db.execute(sql.raw(`
    CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
  `));

  // Create schemas
  await db.execute(sql.raw(`
    CREATE SCHEMA IF NOT EXISTS kyomei_sync;
    CREATE SCHEMA IF NOT EXISTS kyomei_app;
    CREATE SCHEMA IF NOT EXISTS kyomei_crons;
  `));
}

export async function down(db: Database): Promise<void> {
  await db.execute(sql.raw(`
    DROP SCHEMA IF EXISTS kyomei_crons CASCADE;
    DROP SCHEMA IF EXISTS kyomei_app CASCADE;
    DROP SCHEMA IF EXISTS kyomei_sync CASCADE;
  `));
}

export const migration = { up, down };
