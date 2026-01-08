import { pgSchema, serial, integer, bigint, varchar, text, timestamp, boolean, index, primaryKey } from 'drizzle-orm/pg-core';

/**
 * kyomei_crons schema for cron job data
 */
export const cronsSchema = pgSchema('kyomei_crons');

/**
 * Cron jobs table
 * Stores cron job definitions and metadata
 */
export const cronJobs = cronsSchema.table(
  'cron_jobs',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull().unique(),
    chainId: integer('chain_id').notNull(),
    triggerType: varchar('trigger_type', { length: 20 }).notNull(), // 'block' | 'time'
    triggerConfig: text('trigger_config').notNull(), // JSON config
    handlerPath: varchar('handler_path', { length: 500 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chainIdx: index('idx_cron_jobs_chain').on(t.chainId),
    enabledIdx: index('idx_cron_jobs_enabled').on(t.enabled),
  })
);

/**
 * Cron executions table
 * Tracks cron job execution history
 */
export const cronExecutions = cronsSchema.table(
  'cron_executions',
  {
    id: serial('id').primaryKey(),
    cronJobId: integer('cron_job_id').notNull(),
    chainId: integer('chain_id').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }),
    status: varchar('status', { length: 20 }).notNull(), // 'running' | 'success' | 'failed'
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
  },
  (t) => ({
    cronJobIdx: index('idx_cron_executions_job').on(t.cronJobId),
    statusIdx: index('idx_cron_executions_status').on(t.status),
    startedIdx: index('idx_cron_executions_started').on(t.startedAt),
  })
);

/**
 * Cron checkpoints table
 * Tracks last execution point for block-based crons
 */
export const cronCheckpoints = cronsSchema.table(
  'cron_checkpoints',
  {
    cronJobId: integer('cron_job_id').notNull(),
    chainId: integer('chain_id').notNull(),
    lastBlockNumber: bigint('last_block_number', { mode: 'bigint' }).notNull(),
    lastExecutedAt: timestamp('last_executed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.cronJobId, t.chainId] }),
  })
);

export type CronJob = typeof cronJobs.$inferSelect;
export type NewCronJob = typeof cronJobs.$inferInsert;

export type CronExecution = typeof cronExecutions.$inferSelect;
export type NewCronExecution = typeof cronExecutions.$inferInsert;

export type CronCheckpoint = typeof cronCheckpoints.$inferSelect;
export type NewCronCheckpoint = typeof cronCheckpoints.$inferInsert;
