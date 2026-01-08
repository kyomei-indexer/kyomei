import { pgSchema, integer, bigint, varchar, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

/**
 * kyomei_app schema for application data
 */
export const appSchema = pgSchema('kyomei_app');

/**
 * Process checkpoints table
 * Tracks handler execution progress per chain and handler
 */
export const processCheckpoints = appSchema.table(
  'process_checkpoints',
  {
    chainId: integer('chain_id').notNull(),
    handlerName: varchar('handler_name', { length: 255 }).notNull().default('default'),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId, t.handlerName] }),
    chainIdx: index('idx_process_checkpoints_chain').on(t.chainId),
  })
);

export type ProcessCheckpoint = typeof processCheckpoints.$inferSelect;
export type NewProcessCheckpoint = typeof processCheckpoints.$inferInsert;
