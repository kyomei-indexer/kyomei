import { pgSchema, integer, bigint, varchar, text, index, primaryKey } from 'drizzle-orm/pg-core';

/**
 * kyomei_sync schema for raw indexed data
 */
export const syncSchema = pgSchema('kyomei_sync');

/**
 * Raw events table
 * Stores all indexed events in append-only format
 * Optimized for TimescaleDB hypertables
 */
export const rawEvents = syncSchema.table(
  'raw_events',
  {
    // Composite key components
    chainId: integer('chain_id').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    txIndex: integer('tx_index').notNull(),
    logIndex: integer('log_index').notNull(),

    // Block data
    blockHash: varchar('block_hash', { length: 66 }).notNull(),
    blockTimestamp: bigint('block_timestamp', { mode: 'bigint' }).notNull(),

    // Transaction data
    txHash: varchar('tx_hash', { length: 66 }).notNull(),

    // Log data
    address: varchar('address', { length: 42 }).notNull(),
    topic0: varchar('topic0', { length: 66 }),
    topic1: varchar('topic1', { length: 66 }),
    topic2: varchar('topic2', { length: 66 }),
    topic3: varchar('topic3', { length: 66 }),
    data: text('data').notNull(),
  },
  (t) => ({
    // Primary key for uniqueness and ordering
    pk: primaryKey({ columns: [t.chainId, t.blockNumber, t.txIndex, t.logIndex] }),
    // Index for filtering by contract address and event signature
    addressTopicIdx: index('idx_raw_events_address_topic').on(
      t.chainId,
      t.address,
      t.topic0,
      t.blockNumber
    ),
    // Index for time-based queries (TimescaleDB optimization)
    blockTimestampIdx: index('idx_raw_events_block_timestamp').on(
      t.chainId,
      t.blockTimestamp
    ),
  })
);

export type RawEvent = typeof rawEvents.$inferSelect;
export type NewRawEvent = typeof rawEvents.$inferInsert;
