import { integer, bigint, varchar, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { syncSchema } from './rawEvents.ts';

/**
 * Sync status for workers
 */
export type SyncStatus = 'historical' | 'live';

/**
 * Sync workers table
 * Unified table tracking all sync workers (historical and live)
 * Replaces both sync_checkpoints and worker_checkpoints
 */
export const syncWorkers = syncSchema.table(
  'sync_workers',
  {
    /** Chain ID this worker is syncing */
    chainId: integer('chain_id').notNull(),
    /** Worker ID (0 for live worker, 1+ for historical workers) */
    workerId: integer('worker_id').notNull(),
    /** Start block of this worker's assigned range */
    rangeStart: bigint('range_start', { mode: 'bigint' }).notNull(),
    /** End block of this worker's assigned range (NULL for live sync) */
    rangeEnd: bigint('range_end', { mode: 'bigint' }),
    /** Current progress block (last synced block) */
    currentBlock: bigint('current_block', { mode: 'bigint' }).notNull(),
    /** Sync status: 'historical' (fixed range) or 'live' (following chain head) */
    status: varchar('status', { length: 20 }).notNull().$type<SyncStatus>(),
    /** When this worker was created */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** When this worker was last updated */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId, t.workerId] }),
  })
);

export type SyncWorkerRow = typeof syncWorkers.$inferSelect;
export type NewSyncWorkerRow = typeof syncWorkers.$inferInsert;
