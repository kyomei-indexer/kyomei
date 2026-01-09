import type { Database } from "../connection.ts";
import { sql } from "drizzle-orm";

/**
 * Migration: Create unified sync_workers table
 * Consolidates sync_checkpoints and worker_checkpoints into a single table
 */
export async function up(db: Database): Promise<void> {
  // Create the new unified sync_workers table
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_sync.sync_workers (
      chain_id INTEGER NOT NULL,
      worker_id INTEGER NOT NULL,
      range_start BIGINT NOT NULL,
      range_end BIGINT,
      current_block BIGINT NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chain_id, worker_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sync_workers_chain
    ON kyomei_sync.sync_workers (chain_id);

    CREATE INDEX IF NOT EXISTS idx_sync_workers_status
    ON kyomei_sync.sync_workers (chain_id, status);
  `)
  );

  // Migrate data from worker_checkpoints (historical workers)
  await db.execute(
    sql.raw(`
    INSERT INTO kyomei_sync.sync_workers (
      chain_id,
      worker_id,
      range_start,
      range_end,
      current_block,
      status,
      created_at,
      updated_at
    )
    SELECT 
      chain_id,
      worker_id + 1,
      range_start,
      range_end,
      current_block,
      CASE WHEN is_complete = 1 THEN 'historical' ELSE 'historical' END,
      updated_at,
      updated_at
    FROM kyomei_sync.worker_checkpoints
    WHERE is_complete = 0
    ON CONFLICT (chain_id, worker_id) DO NOTHING;
  `)
  );

  // Migrate data from sync_checkpoints as live workers (worker_id = 0)
  // Only if there are no historical workers for that chain
  await db.execute(
    sql.raw(`
    INSERT INTO kyomei_sync.sync_workers (
      chain_id,
      worker_id,
      range_start,
      range_end,
      current_block,
      status,
      created_at,
      updated_at
    )
    SELECT 
      sc.chain_id,
      0,
      sc.block_number,
      NULL,
      sc.block_number,
      'live',
      sc.updated_at,
      sc.updated_at
    FROM kyomei_sync.sync_checkpoints sc
    WHERE NOT EXISTS (
      SELECT 1 FROM kyomei_sync.sync_workers sw 
      WHERE sw.chain_id = sc.chain_id
    )
    ON CONFLICT (chain_id, worker_id) DO NOTHING;
  `)
  );

  // Drop old tables
  await db.execute(
    sql.raw(`
    DROP TABLE IF EXISTS kyomei_sync.worker_checkpoints;
    DROP TABLE IF EXISTS kyomei_sync.sync_checkpoints;
  `)
  );
}

export async function down(db: Database): Promise<void> {
  // Recreate old tables
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_sync.sync_checkpoints (
      chain_id INTEGER NOT NULL PRIMARY KEY,
      block_number BIGINT NOT NULL,
      block_hash VARCHAR(66) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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
  `)
  );

  // Migrate live workers back to sync_checkpoints
  await db.execute(
    sql.raw(`
    INSERT INTO kyomei_sync.sync_checkpoints (
      chain_id,
      block_number,
      block_hash,
      updated_at
    )
    SELECT 
      chain_id,
      current_block,
      '0x',
      updated_at
    FROM kyomei_sync.sync_workers
    WHERE status = 'live'
    ON CONFLICT (chain_id) DO NOTHING;
  `)
  );

  // Migrate historical workers back to worker_checkpoints
  await db.execute(
    sql.raw(`
    INSERT INTO kyomei_sync.worker_checkpoints (
      chain_id,
      worker_id,
      range_start,
      range_end,
      current_block,
      is_complete,
      updated_at
    )
    SELECT 
      chain_id,
      worker_id - 1,
      range_start,
      COALESCE(range_end, current_block),
      current_block,
      0,
      updated_at
    FROM kyomei_sync.sync_workers
    WHERE status = 'historical'
    ON CONFLICT (chain_id, worker_id) DO NOTHING;
  `)
  );

  // Drop the new table
  await db.execute(
    sql.raw(`
    DROP TABLE IF EXISTS kyomei_sync.sync_workers;
  `)
  );
}

export const migration = { up, down };
