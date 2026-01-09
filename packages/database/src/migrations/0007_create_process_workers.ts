import type { Database } from "../connection.ts";
import { sql } from "drizzle-orm";

/**
 * Migration: Create process_workers table for handler execution tracking
 */
export async function up(db: Database): Promise<void> {
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_app.process_workers (
      chain_id INTEGER NOT NULL PRIMARY KEY,
      range_start BIGINT NOT NULL,
      range_end BIGINT,
      current_block BIGINT NOT NULL,
      events_processed BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_process_workers_status
    ON kyomei_app.process_workers (status);
  `)
  );
}

export async function down(db: Database): Promise<void> {
  await db.execute(
    sql.raw(`
    DROP TABLE IF EXISTS kyomei_app.process_workers;
  `)
  );
}

export const migration = { up, down };
