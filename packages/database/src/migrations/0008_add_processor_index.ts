import { sql } from 'drizzle-orm';
import type { Database } from '../connection.ts';

/**
 * Migration 0008: Add index for processor range queries
 * Adds missing index on (chain_id, block_number) for faster processor queries
 */

export async function up(db: Database): Promise<void> {
  // Add index for processor range queries on raw_events
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_raw_events_chain_block
    ON kyomei_sync.raw_events (chain_id, block_number)
  `);
}

export async function down(db: Database): Promise<void> {
  // Drop the index
  await db.execute(sql`
    DROP INDEX IF EXISTS kyomei_sync.idx_raw_events_chain_block
  `);
}

export const migration = { up, down };
