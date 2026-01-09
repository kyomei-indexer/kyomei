import { integer, bigint, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { syncSchema } from './rawEvents.ts';

/**
 * Worker checkpoints table
 * Tracks per-worker sync progress for parallel historical sync
 */
export const workerCheckpoints = syncSchema.table(
  'worker_checkpoints',
  {
    chainId: integer('chain_id').notNull(),
    workerId: integer('worker_id').notNull(),
    /** Start block of this worker's assigned range */
    rangeStart: bigint('range_start', { mode: 'bigint' }).notNull(),
    /** End block of this worker's assigned range */
    rangeEnd: bigint('range_end', { mode: 'bigint' }).notNull(),
    /** Current progress block within the range */
    currentBlock: bigint('current_block', { mode: 'bigint' }).notNull(),
    /** Whether this worker has completed its range */
    isComplete: integer('is_complete').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId, t.workerId] }),
  })
);

export type WorkerCheckpoint = typeof workerCheckpoints.$inferSelect;
export type NewWorkerCheckpoint = typeof workerCheckpoints.$inferInsert;
