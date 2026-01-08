/**
 * Application Schema Definition
 *
 * Define your application tables here using Drizzle ORM.
 * This follows the Ponder pattern where all tables are defined
 * in a single schema.ts file at the project root.
 *
 * The schema version is appended to the schema name:
 * - kyomei_app_v1, kyomei_app_v2, etc.
 *
 * When you change the schema:
 * 1. Update the schema version in kyomei.config.ts
 * 2. Run `kyomei migrate` to apply migrations
 */

import {
  pgTable,
  varchar,
  bigint,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
// PgTableWithColumns and TableConfig types available from drizzle-orm/pg-core if needed

// TimescaleDB table definition type
// This will be imported from @kyomei/database once built
interface TimescaleTableDef {
  name: string;
  schema: string;
  columns: Record<
    string,
    {
      type: string;
      length?: number;
      precision?: number;
      scale?: number;
      notNull?: boolean;
      primaryKey?: boolean;
      default?: unknown;
    }
  >;
  indexes?: Array<{
    name: string;
    columns: string[];
    unique?: boolean;
  }>;
  hypertable: {
    timeColumn: string;
    chunkInterval?: string;
    spaceColumn?: string;
    spacePartitions?: number;
    compression?: {
      enabled: boolean;
      segmentBy: string[];
      orderBy: string[];
      after?: string;
    };
    retention?: {
      dropAfter: string;
    };
  };
}

// ============================================================================
// APP SCHEMA TABLES
// ============================================================================

/**
 * Create schema with version suffix
 * The actual schema name will be set at runtime based on config
 */
export function createAppSchema(version: string) {
  const schemaName = `kyomei_app_${version}`;

  // ============================================
  // PAIRS TABLE
  // Tracks all Uniswap V2 pairs created by factory
  // ============================================
  const pairs = pgTable(
    "pairs",
    {
      // Primary key - pair contract address
      address: varchar("address", { length: 42 }).primaryKey(),

      // Token addresses
      token0: varchar("token0", { length: 42 }).notNull(),
      token1: varchar("token1", { length: 42 }).notNull(),

      // Token metadata (fetched via RPC)
      token0Symbol: varchar("token0_symbol", { length: 32 }),
      token0Decimals: integer("token0_decimals"),
      token1Symbol: varchar("token1_symbol", { length: 32 }),
      token1Decimals: integer("token1_decimals"),

      // Current reserves
      reserve0: numeric("reserve0", { precision: 78, scale: 0 })
        .notNull()
        .default("0"),
      reserve1: numeric("reserve1", { precision: 78, scale: 0 })
        .notNull()
        .default("0"),

      // Timestamps
      createdAtBlock: bigint("created_at_block", { mode: "bigint" }).notNull(),
      createdAtTimestamp: bigint("created_at_timestamp", {
        mode: "bigint",
      }).notNull(),
      lastSyncBlock: bigint("last_sync_block", { mode: "bigint" }),
      lastSyncTimestamp: bigint("last_sync_timestamp", { mode: "bigint" }),
    },
    (t: Record<string, unknown>) => ({
      token0Idx: index("idx_pairs_token0").on(t.token0 as never),
      token1Idx: index("idx_pairs_token1").on(t.token1 as never),
    })
  );

  // ============================================
  // SWAPS TABLE
  // Records all swap events
  // ============================================
  const swaps = pgTable(
    "swaps",
    {
      // Composite ID: txHash-logIndex
      id: varchar("id", { length: 80 }).primaryKey(),

      // References
      pairAddress: varchar("pair_address", { length: 42 }).notNull(),

      // Addresses
      sender: varchar("sender", { length: 42 }).notNull(),
      recipient: varchar("recipient", { length: 42 }).notNull(),

      // Amounts
      amount0In: numeric("amount0_in", { precision: 78, scale: 0 }).notNull(),
      amount1In: numeric("amount1_in", { precision: 78, scale: 0 }).notNull(),
      amount0Out: numeric("amount0_out", { precision: 78, scale: 0 }).notNull(),
      amount1Out: numeric("amount1_out", { precision: 78, scale: 0 }).notNull(),

      // USD values (calculated using price oracle)
      amountUsd: numeric("amount_usd", { precision: 30, scale: 2 }),

      // Block info
      blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
      blockTimestamp: bigint("block_timestamp", { mode: "bigint" }).notNull(),
      txHash: varchar("tx_hash", { length: 66 }).notNull(),
      logIndex: integer("log_index").notNull(),
    },
    (t: Record<string, unknown>) => ({
      pairIdx: index("idx_swaps_pair").on(t.pairAddress as never),
      blockIdx: index("idx_swaps_block").on(t.blockNumber as never),
      timestampIdx: index("idx_swaps_timestamp").on(t.blockTimestamp as never),
    })
  );

  // ============================================
  // LIQUIDITY EVENTS TABLE
  // Tracks mints and burns
  // ============================================
  const liquidityEvents = pgTable(
    "liquidity_events",
    {
      id: varchar("id", { length: 80 }).primaryKey(),

      // Event type
      type: varchar("type", { length: 10 }).notNull(), // 'mint' | 'burn'

      // References
      pairAddress: varchar("pair_address", { length: 42 }).notNull(),

      // Addresses
      sender: varchar("sender", { length: 42 }).notNull(),
      recipient: varchar("recipient", { length: 42 }),

      // Amounts
      amount0: numeric("amount0", { precision: 78, scale: 0 }).notNull(),
      amount1: numeric("amount1", { precision: 78, scale: 0 }).notNull(),
      liquidity: numeric("liquidity", { precision: 78, scale: 0 }),

      // Block info
      blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
      blockTimestamp: bigint("block_timestamp", { mode: "bigint" }).notNull(),
      txHash: varchar("tx_hash", { length: 66 }).notNull(),
      logIndex: integer("log_index").notNull(),
    },
    (t: Record<string, unknown>) => ({
      pairIdx: index("idx_liquidity_pair").on(t.pairAddress as never),
      typeIdx: index("idx_liquidity_type").on(t.type as never),
    })
  );

  // ============================================
  // DAILY PAIR STATS
  // Aggregated daily statistics per pair
  // ============================================
  const dailyPairStats = pgTable(
    "daily_pair_stats",
    {
      // Composite key: pair-dayId
      id: varchar("id", { length: 60 }).primaryKey(),

      pairAddress: varchar("pair_address", { length: 42 }).notNull(),
      dayId: integer("day_id").notNull(), // Unix day (timestamp / 86400)

      // Volume
      volume0: numeric("volume0", { precision: 78, scale: 0 })
        .notNull()
        .default("0"),
      volume1: numeric("volume1", { precision: 78, scale: 0 })
        .notNull()
        .default("0"),
      volumeUsd: numeric("volume_usd", { precision: 30, scale: 2 })
        .notNull()
        .default("0"),

      // Counts
      swapCount: integer("swap_count").notNull().default(0),
      mintCount: integer("mint_count").notNull().default(0),
      burnCount: integer("burn_count").notNull().default(0),

      // Reserves at end of day
      reserve0: numeric("reserve0", { precision: 78, scale: 0 }),
      reserve1: numeric("reserve1", { precision: 78, scale: 0 }),

      // TVL
      tvlUsd: numeric("tvl_usd", { precision: 30, scale: 2 }),
    },
    (t: Record<string, unknown>) => ({
      pairDayIdx: uniqueIndex("idx_daily_stats_pair_day").on(
        t.pairAddress as never,
        t.dayId as never
      ),
      dayIdx: index("idx_daily_stats_day").on(t.dayId as never),
    })
  );

  // ============================================
  // BLOCK SNAPSHOTS
  // Periodic block data snapshots
  // ============================================
  const blockSnapshots = pgTable(
    "block_snapshots",
    {
      id: varchar("id", { length: 20 }).primaryKey(),

      blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
      blockHash: varchar("block_hash", { length: 66 }).notNull(),
      blockTimestamp: bigint("block_timestamp", { mode: "bigint" }).notNull(),

      // Gas metrics
      gasUsed: numeric("gas_used", { precision: 30, scale: 0 }).notNull(),
      gasLimit: numeric("gas_limit", { precision: 30, scale: 0 }).notNull(),
      baseFeePerGas: numeric("base_fee_per_gas", { precision: 30, scale: 0 }),

      // Metadata
      snapshotAt: timestamp("snapshot_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (t: Record<string, unknown>) => ({
      blockIdx: uniqueIndex("idx_snapshots_block").on(t.blockNumber as never),
    })
  );

  return {
    schemaName,
    tables: {
      pairs,
      swaps,
      liquidityEvents,
      dailyPairStats,
      blockSnapshots,
    },
  };
}

// ============================================================================
// CRONS SCHEMA TABLES
// ============================================================================

/**
 * Create crons schema with version
 */
export function createCronsSchema(version: string) {
  const schemaName = `kyomei_crons_${version}`;

  // ============================================
  // HOURLY STATS
  // Protocol-wide hourly statistics
  // ============================================
  const hourlyStats = pgTable(
    "hourly_stats",
    {
      id: varchar("id", { length: 20 }).primaryKey(),

      hourId: integer("hour_id").notNull().unique(),
      blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
      calculatedAt: timestamp("calculated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),

      // Stats
      totalSwaps: integer("total_swaps").notNull().default(0),
      totalVolumeUsd: numeric("total_volume_usd", {
        precision: 30,
        scale: 2,
      }).default("0"),
      activePairs: integer("active_pairs").notNull().default(0),
    },
    (t: Record<string, unknown>) => ({
      hourIdx: index("idx_hourly_hour").on(t.hourId as never),
    })
  );

  return {
    schemaName,
    tables: {
      hourlyStats,
    },
  };
}

// ============================================================================
// TIMESCALEDB HYPERTABLE DEFINITIONS
// For time-series data like prices
// ============================================================================

/**
 * Token prices hypertable definition
 * Uses TimescaleDB for efficient time-series queries
 */
export const tokenPricesHypertable: TimescaleTableDef = {
  name: "token_prices",
  schema: "kyomei_crons_v1", // Will be updated based on version
  columns: {
    // Time column - required for hypertable
    fetched_at: {
      type: "timestamptz",
      notNull: true,
    },
    // Token identification
    token_address: {
      type: "varchar",
      length: 42,
      notNull: true,
    },
    symbol: {
      type: "varchar",
      length: 20,
      notNull: true,
    },
    // Price data
    price_usd: {
      type: "numeric",
      precision: 30,
      scale: 18,
      notNull: true,
    },
    price_eth: {
      type: "numeric",
      precision: 30,
      scale: 18,
      notNull: true,
    },
    // Market data
    volume_24h: {
      type: "numeric",
      precision: 30,
      scale: 2,
      default: "0",
    },
    market_cap: {
      type: "numeric",
      precision: 30,
      scale: 2,
      default: "0",
    },
    change_24h: {
      type: "real",
      default: 0,
    },
    // Block reference
    block_number: {
      type: "bigint",
      notNull: true,
    },
  },
  indexes: [
    { name: "idx_token_prices_token", columns: ["token_address"] },
    { name: "idx_token_prices_symbol", columns: ["symbol"] },
    { name: "idx_token_prices_fetched", columns: ["fetched_at"] },
  ],
  hypertable: {
    timeColumn: "fetched_at",
    chunkInterval: "1 day",
    compression: {
      enabled: true,
      segmentBy: ["token_address"],
      orderBy: ["fetched_at DESC"],
      after: "7 days",
    },
    retention: {
      dropAfter: "90 days",
    },
  },
};

/**
 * Price snapshots hypertable definition
 * Aggregate price data
 */
export const priceSnapshotsHypertable: TimescaleTableDef = {
  name: "price_snapshots",
  schema: "kyomei_crons_v1",
  columns: {
    snapshot_time: {
      type: "timestamptz",
      notNull: true,
    },
    block_number: {
      type: "bigint",
      notNull: true,
    },
    eth_price_usd: {
      type: "numeric",
      precision: 30,
      scale: 2,
      notNull: true,
    },
    total_tokens_tracked: {
      type: "integer",
      notNull: true,
    },
    avg_change_24h: {
      type: "real",
    },
  },
  indexes: [{ name: "idx_price_snapshots_time", columns: ["snapshot_time"] }],
  hypertable: {
    timeColumn: "snapshot_time",
    chunkInterval: "1 day",
    compression: {
      enabled: true,
      segmentBy: [],
      orderBy: ["snapshot_time DESC"],
      after: "7 days",
    },
    retention: {
      dropAfter: "365 days",
    },
  },
};

/**
 * Get hypertable definition with updated schema name
 */
export function getTokenPricesHypertable(version: string): TimescaleTableDef {
  return {
    ...tokenPricesHypertable,
    schema: `kyomei_crons_${version}`,
  };
}

export function getPriceSnapshotsHypertable(
  version: string
): TimescaleTableDef {
  return {
    ...priceSnapshotsHypertable,
    schema: `kyomei_crons_${version}`,
  };
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type AppSchema = ReturnType<typeof createAppSchema>;
export type CronsSchema = ReturnType<typeof createCronsSchema>;

// Inferred types from tables
export type Pair = {
  address: string;
  token0: string;
  token1: string;
  token0Symbol: string | null;
  token0Decimals: number | null;
  token1Symbol: string | null;
  token1Decimals: number | null;
  reserve0: string;
  reserve1: string;
  createdAtBlock: bigint;
  createdAtTimestamp: bigint;
  lastSyncBlock: bigint | null;
  lastSyncTimestamp: bigint | null;
};

export type Swap = {
  id: string;
  pairAddress: string;
  sender: string;
  recipient: string;
  amount0In: string;
  amount1In: string;
  amount0Out: string;
  amount1Out: string;
  amountUsd: string | null;
  blockNumber: bigint;
  blockTimestamp: bigint;
  txHash: string;
  logIndex: number;
};

export type LiquidityEvent = {
  id: string;
  type: string;
  pairAddress: string;
  sender: string;
  recipient: string | null;
  amount0: string;
  amount1: string;
  liquidity: string | null;
  blockNumber: bigint;
  blockTimestamp: bigint;
  txHash: string;
  logIndex: number;
};

export type DailyPairStats = {
  id: string;
  pairAddress: string;
  dayId: number;
  volume0: string;
  volume1: string;
  volumeUsd: string;
  swapCount: number;
  mintCount: number;
  burnCount: number;
  reserve0: string | null;
  reserve1: string | null;
  tvlUsd: string | null;
};

export type TokenPrice = {
  fetchedAt: Date;
  tokenAddress: string;
  symbol: string;
  priceUsd: string;
  priceEth: string;
  volume24h: string | null;
  marketCap: string | null;
  change24h: number | null;
  blockNumber: bigint;
};

export type PriceSnapshot = {
  snapshotTime: Date;
  blockNumber: bigint;
  ethPriceUsd: string;
  totalTokensTracked: number;
  avgChange24h: number | null;
};
