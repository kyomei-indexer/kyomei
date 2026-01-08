/**
 * Custom GraphQL schema extensions for the Uniswap V2 indexer
 *
 * This file shows how to add custom queries and types
 * beyond the auto-generated ones from database tables
 */

// ============================================================================
// Database Types - Match schema.ts
// ============================================================================

/**
 * Pair row from database
 */
interface PairRow {
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
}

/**
 * Swap row from database
 */
interface SwapRow {
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
}

/**
 * Token price row from TimescaleDB hypertable
 */
interface TokenPriceRow {
  fetched_at: Date;
  token_address: string;
  symbol: string;
  price_usd: string;
  price_eth: string;
  volume_24h: string | null;
  market_cap: string | null;
  change_24h: number | null;
  block_number: bigint;
}

/**
 * Time bucket aggregation result
 */
interface PriceBucketRow {
  bucket: Date;
  token_address: string;
  symbol: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  avg_price: number;
  data_points: number;
}

/**
 * OHLC result from TimescaleDB
 */
interface OHLCRow {
  bucket: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

// ============================================================================
// GraphQL Types
// ============================================================================

/**
 * Token info for GraphQL
 */
interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: bigint;
}

/**
 * Pair stats for GraphQL
 */
interface PairStats {
  pairAddress: string;
  token0: TokenInfo;
  token1: TokenInfo;
  reserve0: bigint;
  reserve1: bigint;
  totalSwaps: number;
  volumeUsd24h: number;
  tvlUsd: number;
  apy: number | null;
}

/**
 * Global stats for GraphQL
 */
interface GlobalStats {
  totalPairs: number;
  totalSwaps: number;
  totalVolumeUsd: number;
  totalTvlUsd: number;
  lastUpdatedBlock: bigint;
}

/**
 * Token price for GraphQL
 */
interface TokenPrice {
  address: string;
  symbol: string;
  priceUsd: number;
  priceEth: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  fetchedAt: string;
}

/**
 * Price point for GraphQL
 */
interface PricePoint {
  timestamp: string;
  priceUsd: number;
  priceEth: number;
}

/**
 * OHLC candle for GraphQL
 */
interface OHLCCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/**
 * Price chart for GraphQL
 */
interface PriceChart {
  token: TokenInfo;
  prices: PricePoint[];
  ohlc: OHLCCandle[];
  high24h: number;
  low24h: number;
  change24h: number;
}

// ============================================================================
// Database Context Interface
// ============================================================================

/**
 * Database operations interface for resolvers
 */
interface ResolverDbContext {
  find: <T>(table: string) => {
    where: (condition: Record<string, unknown>) => Promise<T | T[] | null>;
    many: () => Promise<T[]>;
  };
  /**
   * Execute raw SQL for TimescaleDB queries
   */
  executeRaw: <T>(sql: string) => Promise<T[]>;
}

/**
 * Resolver context
 */
interface ResolverContext {
  db: ResolverDbContext;
  /** Schema name for crons tables (e.g., kyomei_crons_v1) */
  cronsSchema: string;
}

// ============================================================================
// GraphQL Schema Definition
// ============================================================================

export const customSchema = `
  # Custom types for Uniswap V2 analytics

  type TokenInfo {
    address: String!
    symbol: String!
    name: String!
    decimals: Int!
    totalSupply: BigInt!
  }

  type PairStats {
    pairAddress: String!
    token0: TokenInfo!
    token1: TokenInfo!
    reserve0: BigInt!
    reserve1: BigInt!
    totalSwaps: Int!
    volumeUsd24h: Float!
    tvlUsd: Float!
    apy: Float
  }

  type GlobalStats {
    totalPairs: Int!
    totalSwaps: Int!
    totalVolumeUsd: Float!
    totalTvlUsd: Float!
    lastUpdatedBlock: BigInt!
  }

  type PricePoint {
    timestamp: String!
    priceUsd: Float!
    priceEth: Float!
  }

  type OHLCCandle {
    timestamp: String!
    open: Float!
    high: Float!
    low: Float!
    close: Float!
    volume: Float
  }

  type TokenPrice {
    address: String!
    symbol: String!
    priceUsd: Float!
    priceEth: Float!
    change24h: Float!
    volume24h: Float!
    marketCap: Float!
    fetchedAt: String!
  }

  type PriceChart {
    token: TokenInfo!
    prices: [PricePoint!]!
    ohlc: [OHLCCandle!]!
    high24h: Float!
    low24h: Float!
    change24h: Float!
  }

  type PriceHistoryStats {
    tokenAddress: String!
    symbol: String!
    avgPrice: Float!
    minPrice: Float!
    maxPrice: Float!
    priceChange: Float!
    dataPoints: Int!
  }

  # Available time intervals for price queries
  enum PriceInterval {
    ONE_MINUTE
    FIVE_MINUTES
    FIFTEEN_MINUTES
    THIRTY_MINUTES
    ONE_HOUR
    FOUR_HOURS
    ONE_DAY
    ONE_WEEK
  }

  # Extend the Query type with custom resolvers
  extend type Query {
    # Get stats for a specific pair
    pairStats(pairAddress: String!): PairStats

    # Get global protocol statistics
    globalStats: GlobalStats!

    # Get top pairs by volume
    topPairs(limit: Int, orderBy: String): [PairStats!]!

    # Get current prices for tracked tokens
    tokenPrices: [TokenPrice!]!

    # Get latest price for a specific token
    tokenPrice(tokenAddress: String!): TokenPrice

    # Get price chart with OHLC data (TimescaleDB query)
    priceChart(
      tokenAddress: String!
      interval: PriceInterval
      limit: Int
    ): PriceChart

    # Get price history with time bucket aggregation
    priceHistory(
      tokenAddress: String!
      interval: PriceInterval!
      startTime: String
      endTime: String
      limit: Int
    ): [OHLCCandle!]!

    # Get price statistics for a time range
    priceStats(
      tokenAddress: String
      startTime: String!
      endTime: String!
    ): [PriceHistoryStats!]!

    # Search pairs by token
    searchPairs(token: String!, limit: Int): [PairStats!]!
  }

  # Subscriptions for real-time updates
  type Subscription {
    # New swap events
    newSwap(pairAddress: String): SwapEvent!

    # Price updates
    priceUpdate(tokenAddress: String): TokenPrice!

    # New pair created
    newPair: PairStats!
  }

  type SwapEvent {
    pairAddress: String!
    sender: String!
    amount0In: BigInt!
    amount1In: BigInt!
    amount0Out: BigInt!
    amount1Out: BigInt!
    to: String!
    blockNumber: BigInt!
    txHash: String!
    timestamp: BigInt!
  }
`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create token info from pair row
 */
function createTokenInfo(
  address: string,
  symbol: string | null,
  decimals: number | null
): TokenInfo {
  return {
    address,
    symbol: symbol ?? "UNKNOWN",
    name: symbol ?? "Unknown Token",
    decimals: decimals ?? 18,
    totalSupply: BigInt(0),
  };
}

/**
 * Create pair stats from pair row
 */
function createPairStats(pair: PairRow, swapCount: number = 0): PairStats {
  return {
    pairAddress: pair.address,
    token0: createTokenInfo(
      pair.token0,
      pair.token0Symbol,
      pair.token0Decimals
    ),
    token1: createTokenInfo(
      pair.token1,
      pair.token1Symbol,
      pair.token1Decimals
    ),
    reserve0: BigInt(pair.reserve0),
    reserve1: BigInt(pair.reserve1),
    totalSwaps: swapCount,
    volumeUsd24h: 0,
    tvlUsd: 0,
    apy: null,
  };
}

/**
 * Map GraphQL interval enum to PostgreSQL interval
 */
function mapInterval(interval: string): string {
  const intervals: Record<string, string> = {
    ONE_MINUTE: "1 minute",
    FIVE_MINUTES: "5 minutes",
    FIFTEEN_MINUTES: "15 minutes",
    THIRTY_MINUTES: "30 minutes",
    ONE_HOUR: "1 hour",
    FOUR_HOURS: "4 hours",
    ONE_DAY: "1 day",
    ONE_WEEK: "1 week",
  };
  return intervals[interval] ?? "1 hour";
}

// ============================================================================
// Custom Resolvers
// ============================================================================

export const customResolvers = {
  Query: {
    pairStats: async (
      _parent: unknown,
      args: { pairAddress: string },
      context: ResolverContext
    ): Promise<PairStats | null> => {
      const { db } = context;

      // Query pair data from database
      const pairResult = await db.find<PairRow>("pairs").where({
        address: args.pairAddress.toLowerCase(),
      });

      const pair = Array.isArray(pairResult) ? pairResult[0] : pairResult;
      if (!pair) return null;

      // Get swap count
      const swaps = await db.find<SwapRow>("swaps").where({
        pairAddress: args.pairAddress.toLowerCase(),
      });

      const swapCount = Array.isArray(swaps) ? swaps.length : swaps ? 1 : 0;

      return createPairStats(pair, swapCount);
    },

    globalStats: async (
      _parent: unknown,
      _args: Record<string, never>,
      context: ResolverContext
    ): Promise<GlobalStats> => {
      const { db } = context;

      const pairs = await db.find<PairRow>("pairs").many();
      const swaps = await db.find<SwapRow>("swaps").many();

      return {
        totalPairs: pairs.length,
        totalSwaps: swaps.length,
        totalVolumeUsd: 0,
        totalTvlUsd: 0,
        lastUpdatedBlock: BigInt(0),
      };
    },

    topPairs: async (
      _parent: unknown,
      args: { limit?: number; orderBy?: string },
      context: ResolverContext
    ): Promise<PairStats[]> => {
      const { db } = context;
      const pairs = await db.find<PairRow>("pairs").many();

      return pairs
        .slice(0, args.limit ?? 10)
        .map((pair) => createPairStats(pair));
    },

    tokenPrices: async (
      _parent: unknown,
      _args: Record<string, never>,
      context: ResolverContext
    ): Promise<TokenPrice[]> => {
      const { db, cronsSchema } = context;

      // Get latest prices using TimescaleDB last() function
      const query = `
        SELECT DISTINCT ON (token_address)
          fetched_at,
          token_address,
          symbol,
          price_usd,
          price_eth,
          volume_24h,
          market_cap,
          change_24h
        FROM ${cronsSchema}.token_prices
        ORDER BY token_address, fetched_at DESC
      `;

      const prices = await db.executeRaw<TokenPriceRow>(query);

      return prices.map((p) => ({
        address: p.token_address,
        symbol: p.symbol,
        priceUsd: Number.parseFloat(p.price_usd),
        priceEth: Number.parseFloat(p.price_eth),
        change24h: p.change_24h ?? 0,
        volume24h: Number.parseFloat(p.volume_24h ?? "0"),
        marketCap: Number.parseFloat(p.market_cap ?? "0"),
        fetchedAt: p.fetched_at.toISOString(),
      }));
    },

    tokenPrice: async (
      _parent: unknown,
      args: { tokenAddress: string },
      context: ResolverContext
    ): Promise<TokenPrice | null> => {
      const { db, cronsSchema } = context;

      // Get latest price for specific token using TimescaleDB
      const query = `
        SELECT
          fetched_at,
          token_address,
          symbol,
          price_usd,
          price_eth,
          volume_24h,
          market_cap,
          change_24h
        FROM ${cronsSchema}.token_prices
        WHERE token_address = '${args.tokenAddress.toLowerCase()}'
        ORDER BY fetched_at DESC
        LIMIT 1
      `;

      const prices = await db.executeRaw<TokenPriceRow>(query);

      if (prices.length === 0) return null;

      const p = prices[0];
      return {
        address: p.token_address,
        symbol: p.symbol,
        priceUsd: Number.parseFloat(p.price_usd),
        priceEth: Number.parseFloat(p.price_eth),
        change24h: p.change_24h ?? 0,
        volume24h: Number.parseFloat(p.volume_24h ?? "0"),
        marketCap: Number.parseFloat(p.market_cap ?? "0"),
        fetchedAt: p.fetched_at.toISOString(),
      };
    },

    priceChart: async (
      _parent: unknown,
      args: {
        tokenAddress: string;
        interval?: string;
        limit?: number;
      },
      context: ResolverContext
    ): Promise<PriceChart | null> => {
      const { db, cronsSchema } = context;

      const tokenAddress = args.tokenAddress.toLowerCase();
      const interval = mapInterval(args.interval ?? "ONE_HOUR");
      const limit = args.limit ?? 100;

      // Get OHLC data using TimescaleDB time_bucket and first/last functions
      const ohlcQuery = `
        SELECT
          time_bucket('${interval}', fetched_at) AS bucket,
          first(price_usd::numeric, fetched_at) AS open,
          MAX(price_usd::numeric) AS high,
          MIN(price_usd::numeric) AS low,
          last(price_usd::numeric, fetched_at) AS close
        FROM ${cronsSchema}.token_prices
        WHERE token_address = '${tokenAddress}'
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT ${limit}
      `;

      const ohlcData = await db.executeRaw<OHLCRow>(ohlcQuery);

      if (ohlcData.length === 0) return null;

      // Get raw price points
      const pricesQuery = `
        SELECT
          fetched_at,
          price_usd,
          price_eth,
          symbol
        FROM ${cronsSchema}.token_prices
        WHERE token_address = '${tokenAddress}'
        ORDER BY fetched_at DESC
        LIMIT ${limit}
      `;

      const pricesData = await db.executeRaw<{
        fetched_at: Date;
        price_usd: string;
        price_eth: string;
        symbol: string;
      }>(pricesQuery);

      // Calculate 24h stats
      const prices = ohlcData.map((o) => o.close);
      const high24h = Math.max(...prices);
      const low24h = Math.min(...prices);
      const change24h =
        ohlcData.length > 1
          ? ((ohlcData[0].close - ohlcData[ohlcData.length - 1].close) /
              ohlcData[ohlcData.length - 1].close) *
            100
          : 0;

      return {
        token: {
          address: tokenAddress,
          symbol: pricesData[0]?.symbol ?? "UNKNOWN",
          name: pricesData[0]?.symbol ?? "Unknown Token",
          decimals: 18,
          totalSupply: BigInt(0),
        },
        prices: pricesData.map((p) => ({
          timestamp: p.fetched_at.toISOString(),
          priceUsd: Number.parseFloat(p.price_usd),
          priceEth: Number.parseFloat(p.price_eth),
        })),
        ohlc: ohlcData.map((o) => ({
          timestamp: o.bucket.toISOString(),
          open: o.open,
          high: o.high,
          low: o.low,
          close: o.close,
          volume: o.volume ?? null,
        })),
        high24h,
        low24h,
        change24h,
      };
    },

    priceHistory: async (
      _parent: unknown,
      args: {
        tokenAddress: string;
        interval: string;
        startTime?: string;
        endTime?: string;
        limit?: number;
      },
      context: ResolverContext
    ): Promise<OHLCCandle[]> => {
      const { db, cronsSchema } = context;

      const tokenAddress = args.tokenAddress.toLowerCase();
      const interval = mapInterval(args.interval);
      const limit = args.limit ?? 500;

      // Build time filter
      let timeFilter = "";
      if (args.startTime) {
        timeFilter += ` AND fetched_at >= '${args.startTime}'`;
      }
      if (args.endTime) {
        timeFilter += ` AND fetched_at < '${args.endTime}'`;
      }

      // Get OHLC data using TimescaleDB
      const query = `
        SELECT
          time_bucket('${interval}', fetched_at) AS bucket,
          first(price_usd::numeric, fetched_at) AS open,
          MAX(price_usd::numeric) AS high,
          MIN(price_usd::numeric) AS low,
          last(price_usd::numeric, fetched_at) AS close
        FROM ${cronsSchema}.token_prices
        WHERE token_address = '${tokenAddress}'
        ${timeFilter}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT ${limit}
      `;

      const data = await db.executeRaw<OHLCRow>(query);

      return data.map((o) => ({
        timestamp: o.bucket.toISOString(),
        open: o.open,
        high: o.high,
        low: o.low,
        close: o.close,
        volume: o.volume ?? null,
      }));
    },

    priceStats: async (
      _parent: unknown,
      args: {
        tokenAddress?: string;
        startTime: string;
        endTime: string;
      },
      context: ResolverContext
    ): Promise<
      Array<{
        tokenAddress: string;
        symbol: string;
        avgPrice: number;
        minPrice: number;
        maxPrice: number;
        priceChange: number;
        dataPoints: number;
      }>
    > => {
      const { db, cronsSchema } = context;

      // Build token filter
      const tokenFilter = args.tokenAddress
        ? `AND token_address = '${args.tokenAddress.toLowerCase()}'`
        : "";

      // Get aggregated stats using TimescaleDB
      const query = `
        SELECT
          token_address,
          symbol,
          AVG(price_usd::numeric) AS avg_price,
          MIN(price_usd::numeric) AS min_price,
          MAX(price_usd::numeric) AS max_price,
          (last(price_usd::numeric, fetched_at) - first(price_usd::numeric, fetched_at)) / 
            NULLIF(first(price_usd::numeric, fetched_at), 0) * 100 AS price_change,
          COUNT(*) AS data_points
        FROM ${cronsSchema}.token_prices
        WHERE fetched_at >= '${args.startTime}'
          AND fetched_at < '${args.endTime}'
          ${tokenFilter}
        GROUP BY token_address, symbol
        ORDER BY avg_price DESC
      `;

      interface StatsRow {
        token_address: string;
        symbol: string;
        avg_price: number;
        min_price: number;
        max_price: number;
        price_change: number | null;
        data_points: string | number;
      }

      const data = await db.executeRaw<StatsRow>(query);

      return data.map((r) => ({
        tokenAddress: r.token_address,
        symbol: r.symbol,
        avgPrice: r.avg_price,
        minPrice: r.min_price,
        maxPrice: r.max_price,
        priceChange: r.price_change ?? 0,
        dataPoints: Number(r.data_points),
      }));
    },

    searchPairs: async (
      _parent: unknown,
      args: { token: string; limit?: number },
      context: ResolverContext
    ): Promise<PairStats[]> => {
      const { db } = context;
      const searchToken = args.token.toLowerCase();

      const pairs = await db.find<PairRow>("pairs").many();

      const matching = pairs
        .filter(
          (p) =>
            p.token0.toLowerCase().includes(searchToken) ||
            p.token1.toLowerCase().includes(searchToken) ||
            p.token0Symbol?.toLowerCase().includes(searchToken) ||
            p.token1Symbol?.toLowerCase().includes(searchToken)
        )
        .slice(0, args.limit ?? 10);

      return matching.map((pair) => createPairStats(pair));
    },
  },
};
