import type { Database } from '../connection.js';
import { sql } from 'drizzle-orm';

/**
 * Migration: Create app schema tables
 */
export async function up(db: Database): Promise<void> {
  // Create process_checkpoints table
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_app.process_checkpoints (
      chain_id INTEGER NOT NULL,
      handler_name VARCHAR(255) NOT NULL DEFAULT 'default',
      block_number BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chain_id, handler_name)
    );

    CREATE INDEX IF NOT EXISTS idx_process_checkpoints_chain
    ON kyomei_app.process_checkpoints (chain_id);
  `));
}

export async function down(db: Database): Promise<void> {
  await db.execute(sql.raw(`
    DROP TABLE IF EXISTS kyomei_app.process_checkpoints;
  `));
}

export const migration = { up, down };
