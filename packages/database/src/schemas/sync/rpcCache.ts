import { integer, bigint, varchar, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { syncSchema } from './rawEvents.js';

/**
 * RPC cache table
 * Stores RPC responses for deterministic replay
 */
export const rpcCache = syncSchema.table(
  'rpc_cache',
  {
    chainId: integer('chain_id').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    method: varchar('method', { length: 100 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    params: text('params').notNull(), // JSON-encoded parameters
    response: text('response').notNull(), // JSON-encoded response
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chainId, t.blockNumber, t.requestHash] }),
    methodIdx: index('idx_rpc_cache_method').on(t.chainId, t.method),
    blockIdx: index('idx_rpc_cache_block').on(t.chainId, t.blockNumber),
  })
);

export type RpcCacheEntry = typeof rpcCache.$inferSelect;
export type NewRpcCacheEntry = typeof rpcCache.$inferInsert;
