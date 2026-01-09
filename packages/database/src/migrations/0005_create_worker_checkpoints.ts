import type { Database } from "../connection.ts";
import { sql } from "drizzle-orm";

/**
 * Migration: Create worker checkpoints table for parallel sync resume
 */
export async function up(db: Database): Promise<void> {
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_sync.worker_checkpoints (
      chain_id INTEGER NOT NULL,
      worker_id INTEGER NOT NULL,
      range_start BIGINT NOT NULL,
      range_end BIGINT NOT NULL,
      current_block BIGINT NOT NULL,
      is_complete INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chain_id, worker_id)
    );

    CREATE INDEX IF NOT EXISTS idx_worker_checkpoints_chain
    ON kyomei_sync.worker_checkpoints (chain_id);
  `)
  );
}

export async function down(db: Database): Promise<void> {
  await db.execute(
    sql.raw(`
    DROP TABLE IF EXISTS kyomei_sync.worker_checkpoints;
  `)
  );
}

export const migration = { up, down };
