import { integer, bigint, varchar, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { syncSchema } from './rawEvents.ts';

/**
 * Factory children table
 * Stores dynamically discovered child contracts
 */
export const factoryChildren = syncSchema.table(
  'factory_children',
  {
    chainId: integer('chain_id').notNull(),
    factoryAddress: varchar('factory_address', { length: 42 }).notNull(),
    childAddress: varchar('child_address', { length: 42 }).notNull(),
    contractName: varchar('contract_name', { length: 255 }).notNull(),
    createdAtBlock: bigint('created_at_block', { mode: 'bigint' }).notNull(),
    createdAtTxHash: varchar('created_at_tx_hash', { length: 66 }).notNull(),
    createdAtLogIndex: integer('created_at_log_index').notNull(),
    metadata: text('metadata'), // JSON-encoded event parameters
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId, t.childAddress] }),
    factoryIdx: index('idx_factory_children_factory').on(t.chainId, t.factoryAddress),
    contractNameIdx: index('idx_factory_children_contract').on(t.chainId, t.contractName),
    createdBlockIdx: index('idx_factory_children_block').on(t.chainId, t.createdAtBlock),
  })
);

export type FactoryChild = typeof factoryChildren.$inferSelect;
export type NewFactoryChild = typeof factoryChildren.$inferInsert;
