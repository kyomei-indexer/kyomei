import type { Database } from '../connection.js';
import { sql } from 'drizzle-orm';

/**
 * Migration: Create crons schema tables
 */
export async function up(db: Database): Promise<void> {
  // Create cron_jobs table
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_crons.cron_jobs (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      chain_id INTEGER NOT NULL,
      trigger_type VARCHAR(20) NOT NULL,
      trigger_config TEXT NOT NULL,
      handler_path VARCHAR(500) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_cron_jobs_chain
    ON kyomei_crons.cron_jobs (chain_id);

    CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled
    ON kyomei_crons.cron_jobs (enabled);
  `));

  // Create cron_executions table
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_crons.cron_executions (
      id SERIAL PRIMARY KEY,
      cron_job_id INTEGER NOT NULL,
      chain_id INTEGER NOT NULL,
      block_number BIGINT,
      status VARCHAR(20) NOT NULL,
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_cron_executions_job
    ON kyomei_crons.cron_executions (cron_job_id);

    CREATE INDEX IF NOT EXISTS idx_cron_executions_status
    ON kyomei_crons.cron_executions (status);

    CREATE INDEX IF NOT EXISTS idx_cron_executions_started
    ON kyomei_crons.cron_executions (started_at);
  `));

  // Create cron_checkpoints table
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_crons.cron_checkpoints (
      cron_job_id INTEGER NOT NULL,
      chain_id INTEGER NOT NULL,
      last_block_number BIGINT NOT NULL,
      last_executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (cron_job_id, chain_id)
    );
  `));
}

export async function down(db: Database): Promise<void> {
  await db.execute(sql.raw(`
    DROP TABLE IF EXISTS kyomei_crons.cron_checkpoints;
    DROP TABLE IF EXISTS kyomei_crons.cron_executions;
    DROP TABLE IF EXISTS kyomei_crons.cron_jobs;
  `));
}

export const migration = { up, down };
