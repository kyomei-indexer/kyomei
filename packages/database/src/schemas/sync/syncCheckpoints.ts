import { integer, bigint, varchar, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { syncSchema } from './rawEvents.js';

/**
 * Sync checkpoints table
 * Tracks ingestion progress per chain
 */
export const syncCheckpoints = syncSchema.table(
  'sync_checkpoints',
  {
    chainId: integer('chain_id').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    blockHash: varchar('block_hash', { length: 66 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId] }),
  })
);

export type SyncCheckpoint = typeof syncCheckpoints.$inferSelect;
export type NewSyncCheckpoint = typeof syncCheckpoints.$inferInsert;
