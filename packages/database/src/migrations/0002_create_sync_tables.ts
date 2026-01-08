import type { Database } from '../connection.js';
import { sql } from 'drizzle-orm';
import { createHypertable, enableCompression } from '../timescale/hypertable.js';

/**
 * Migration: Create sync schema tables
 */
export async function up(db: Database): Promise<void> {
  // Create raw_events table
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_sync.raw_events (
      chain_id INTEGER NOT NULL,
      block_number BIGINT NOT NULL,
      tx_index INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      block_hash VARCHAR(66) NOT NULL,
      block_timestamp BIGINT NOT NULL,
      tx_hash VARCHAR(66) NOT NULL,
      address VARCHAR(42) NOT NULL,
      topic0 VARCHAR(66),
      topic1 VARCHAR(66),
      topic2 VARCHAR(66),
      topic3 VARCHAR(66),
      data TEXT NOT NULL,
      PRIMARY KEY (chain_id, block_number, tx_index, log_index)
    );
  `));

  // Create indexes
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_raw_events_address_topic
    ON kyomei_sync.raw_events (chain_id, address, topic0, block_number);
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_raw_events_block_timestamp
    ON kyomei_sync.raw_events (chain_id, block_timestamp);
  `));

  // Convert to hypertable
  try {
    await createHypertable(db, 'kyomei_sync', 'raw_events', 'block_number', {
      ifNotExists: true,
      chunkTimeInterval: '100000', // ~100k blocks per chunk
      partitioningColumn: 'chain_id',
      numberOfPartitions: 4,
    });

    // Enable compression
    await enableCompression(
      db,
      'kyomei_sync',
      'raw_events',
      ['chain_id', 'address'],
      ['block_number DESC', 'tx_index', 'log_index'],
      { compressAfter: '7 days' }
    );
  } catch (error) {
    // Hypertable may already exist
    console.warn('Hypertable setup warning:', error);
  }

  // Create sync_checkpoints table
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_sync.sync_checkpoints (
      chain_id INTEGER PRIMARY KEY,
      block_number BIGINT NOT NULL,
      block_hash VARCHAR(66) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `));

  // Create factory_children table
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_sync.factory_children (
      chain_id INTEGER NOT NULL,
      factory_address VARCHAR(42) NOT NULL,
      child_address VARCHAR(42) NOT NULL,
      contract_name VARCHAR(255) NOT NULL,
      created_at_block BIGINT NOT NULL,
      created_at_tx_hash VARCHAR(66) NOT NULL,
      created_at_log_index INTEGER NOT NULL,
      metadata TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chain_id, child_address)
    );

    CREATE INDEX IF NOT EXISTS idx_factory_children_factory
    ON kyomei_sync.factory_children (chain_id, factory_address);

    CREATE INDEX IF NOT EXISTS idx_factory_children_contract
    ON kyomei_sync.factory_children (chain_id, contract_name);

    CREATE INDEX IF NOT EXISTS idx_factory_children_block
    ON kyomei_sync.factory_children (chain_id, created_at_block);
  `));

  // Create rpc_cache table
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS kyomei_sync.rpc_cache (
      chain_id INTEGER NOT NULL,
      block_number BIGINT NOT NULL,
      method VARCHAR(100) NOT NULL,
      request_hash VARCHAR(64) NOT NULL,
      params TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chain_id, block_number, request_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_rpc_cache_method
    ON kyomei_sync.rpc_cache (chain_id, method);

    CREATE INDEX IF NOT EXISTS idx_rpc_cache_block
    ON kyomei_sync.rpc_cache (chain_id, block_number);
  `));
}

export async function down(db: Database): Promise<void> {
  await db.execute(sql.raw(`
    DROP TABLE IF EXISTS kyomei_sync.rpc_cache;
    DROP TABLE IF EXISTS kyomei_sync.factory_children;
    DROP TABLE IF EXISTS kyomei_sync.sync_checkpoints;
    DROP TABLE IF EXISTS kyomei_sync.raw_events;
  `));
}

export const migration = { up, down };
