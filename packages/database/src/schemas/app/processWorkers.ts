import { integer, bigint, varchar, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { appSchema } from './processCheckpoints.ts';

/**
 * Process status for workers
 */
export type ProcessStatus = 'processing' | 'live';

/**
 * Process workers table
 * Tracks handler execution progress per chain
 */
export const processWorkers = appSchema.table(
  'process_workers',
  {
    /** Chain ID this worker is processing */
    chainId: integer('chain_id').notNull(),
    /** Start block of the processing range */
    rangeStart: bigint('range_start', { mode: 'bigint' }).notNull(),
    /** End block of the processing range (NULL when live) */
    rangeEnd: bigint('range_end', { mode: 'bigint' }),
    /** Current progress block (last processed block) */
    currentBlock: bigint('current_block', { mode: 'bigint' }).notNull(),
    /** Total events processed */
    eventsProcessed: bigint('events_processed', { mode: 'bigint' }).notNull().default(0n),
    /** Process status: 'processing' (catching up) or 'live' (following sync) */
    status: varchar('status', { length: 20 }).notNull().$type<ProcessStatus>(),
    /** When this worker was created */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** When this worker was last updated */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId] }),
  })
);

export type ProcessWorkerRow = typeof processWorkers.$inferSelect;
export type NewProcessWorkerRow = typeof processWorkers.$inferInsert;
