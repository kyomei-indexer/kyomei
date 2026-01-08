// Types will be imported from @kyomei/config after build
// For now, define them locally for type checking

interface QueryCondition {
  [key: string]: unknown;
}

interface DbContext {
  insert: (table: string) => {
    values: (
      data: Record<string, unknown> | Record<string, unknown>[]
    ) => Promise<void>;
  };
  find: <T>(table: string) => {
    where: (condition: QueryCondition) => Promise<T | null>;
    many: (condition?: QueryCondition) => Promise<T[]>;
  };
  /**
   * Execute raw SQL for TimescaleDB queries
   */
  executeRaw: <T>(sql: string) => Promise<T[]>;
}

interface RpcContext {
  readContract: <TResult = unknown>(params: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: unknown[];
  }) => Promise<TResult>;
  getBlock: (blockNumber?: bigint) => Promise<{
    number: bigint;
    hash: `0x${string}`;
    timestamp: bigint;
    gasUsed: bigint;
    gasLimit: bigint;
    baseFeePerGas?: bigint;
  }>;
}

interface CronHandlerContext {
  db: DbContext;
  rpc: RpcContext;
  blockNumber: bigint;
  timestamp: Date;
  cronName: string;
  chainId: number;
}

type CronHandler = (context: CronHandlerContext) => Promise<void> | void;

// ============================================================================
// Types
// ============================================================================

/**
 * Price data from external API
 */
interface PriceData {
  symbol: string;
  address: string;
  priceUsd: number;
  priceEth: number;
  volume24h: number;
  marketCap: number;
  change24h: number;
}

/**
 * CoinGecko API response item
 */
interface CoinGeckoItem {
  id: string;
  current_price: number;
  total_volume: number;
  market_cap: number;
  price_change_percentage_24h: number;
}

/**
 * Token price insert data - for TimescaleDB hypertable
 * Uses snake_case to match database columns
 */
interface TokenPriceInsert {
  fetched_at: Date;
  token_address: string;
  symbol: string;
  price_usd: string;
  price_eth: string;
  volume_24h: string;
  market_cap: string;
  change_24h: number;
  block_number: bigint;
}

/**
 * Price snapshot insert data - for TimescaleDB hypertable
 */
interface PriceSnapshotInsert {
  snapshot_time: Date;
  block_number: bigint;
  eth_price_usd: string;
  total_tokens_tracked: number;
  avg_change_24h: number;
}

// ============================================================================
// Token Configuration
// ============================================================================

/**
 * Token tracking configuration
 */
interface TokenConfig {
  address: string;
  coingeckoId: string;
}

/**
 * Common token addresses on Ethereum mainnet
 */
const TRACKED_TOKENS: Record<string, TokenConfig> = {
  WETH: {
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    coingeckoId: "weth",
  },
  USDC: {
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    coingeckoId: "usd-coin",
  },
  USDT: {
    address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    coingeckoId: "tether",
  },
  DAI: {
    address: "0x6b175474e89094c44da98b954eedeac495271d0f",
    coingeckoId: "dai",
  },
  WBTC: {
    address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    coingeckoId: "wrapped-bitcoin",
  },
  UNI: {
    address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    coingeckoId: "uniswap",
  },
  LINK: {
    address: "0x514910771af9ca656af840dff83e8264ecf986ca",
    coingeckoId: "chainlink",
  },
  AAVE: {
    address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    coingeckoId: "aave",
  },
};

// ============================================================================
// Handler
// ============================================================================

/**
 * Price Fetcher Cron Job
 *
 * Fetches token prices every 5 minutes from CoinGecko API
 * Stores historical price data in TimescaleDB hypertable for efficient time-series queries
 */
export const priceFetcher: CronHandler = async (context) => {
  const { db, blockNumber, cronName } = context;

  console.log(`[${cronName}] Fetching prices at block ${blockNumber}`);

  try {
    // Fetch prices from CoinGecko API
    const prices = await fetchPricesFromCoingecko();

    // Get current timestamp
    const fetchedAt = new Date();

    // Store each price in TimescaleDB hypertable
    for (const price of prices) {
      const priceData: TokenPriceInsert = {
        fetched_at: fetchedAt,
        token_address: price.address.toLowerCase(),
        symbol: price.symbol,
        price_usd: price.priceUsd.toString(),
        price_eth: price.priceEth.toString(),
        volume_24h: price.volume24h.toString(),
        market_cap: price.marketCap.toString(),
        change_24h: price.change24h,
        block_number: blockNumber,
      };

      await db
        .insert("token_prices")
        .values(priceData as unknown as Record<string, unknown>);
    }

    console.log(`[${cronName}] Stored ${prices.length} token prices`);

    // Calculate and store aggregate stats
    const ethPrice = prices.find((p) => p.symbol === "WETH")?.priceUsd ?? 0;
    const avgChange =
      prices.reduce((sum, p) => sum + p.change24h, 0) / prices.length;

    const snapshotData: PriceSnapshotInsert = {
      snapshot_time: fetchedAt,
      block_number: blockNumber,
      eth_price_usd: ethPrice.toString(),
      total_tokens_tracked: prices.length,
      avg_change_24h: avgChange,
    };

    await db
      .insert("price_snapshots")
      .values(snapshotData as unknown as Record<string, unknown>);

    console.log(`[${cronName}] ETH Price: $${ethPrice.toFixed(2)}`);
  } catch (error) {
    console.error(`[${cronName}] Failed to fetch prices:`, error);
    throw error;
  }
};

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch prices from CoinGecko API
 */
async function fetchPricesFromCoingecko(): Promise<PriceData[]> {
  const ids = Object.values(TRACKED_TOKENS)
    .map((t) => t.coingeckoId)
    .join(",");

  // CoinGecko API endpoint
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status}`);
  }

  const data = (await response.json()) as CoinGeckoItem[];

  // Get ETH price for conversion
  const ethData = data.find((d) => d.id === "weth");
  const ethPriceUsd = ethData?.current_price ?? 2000;

  // Map to our format
  return Object.entries(TRACKED_TOKENS).map(([symbol, token]) => {
    const coinData = data.find((d) => d.id === token.coingeckoId);

    return {
      symbol,
      address: token.address,
      priceUsd: coinData?.current_price ?? 0,
      priceEth: (coinData?.current_price ?? 0) / ethPriceUsd,
      volume24h: coinData?.total_volume ?? 0,
      marketCap: coinData?.market_cap ?? 0,
      change24h: coinData?.price_change_percentage_24h ?? 0,
    };
  });
}

// ============================================================================
// On-Chain Price Fetching (Alternative)
// ============================================================================

/**
 * Uniswap V2 getReserves ABI
 */
const GET_RESERVES_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint112", name: "reserve0" },
      { type: "uint112", name: "reserve1" },
      { type: "uint32", name: "blockTimestampLast" },
    ],
  },
] as const;

/**
 * Alternative: Fetch prices from on-chain (Uniswap pools)
 * This is more reliable but requires more RPC calls
 */
export async function fetchPricesOnChain(context: {
  rpc: RpcContext;
  db: DbContext;
}): Promise<PriceData[]> {
  const { rpc } = context;

  // WETH/USDC pool on Uniswap V2
  const WETH_USDC_PAIR = "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc" as const;

  // Get reserves with proper typing
  const reserves = await rpc.readContract<[bigint, bigint, number]>({
    address: WETH_USDC_PAIR,
    abi: GET_RESERVES_ABI,
    functionName: "getReserves",
  });

  // USDC is token0, WETH is token1 in this pair
  // USDC has 6 decimals, WETH has 18 decimals
  const usdcReserve = Number(reserves[0]) / 1e6;
  const wethReserve = Number(reserves[1]) / 1e18;

  const ethPriceUsd = usdcReserve / wethReserve;

  console.log(`On-chain ETH price: $${ethPriceUsd.toFixed(2)}`);

  return [
    {
      symbol: "WETH",
      address: TRACKED_TOKENS.WETH.address,
      priceUsd: ethPriceUsd,
      priceEth: 1,
      volume24h: 0, // Would need to calculate from swap events
      marketCap: 0,
      change24h: 0,
    },
    {
      symbol: "USDC",
      address: TRACKED_TOKENS.USDC.address,
      priceUsd: 1,
      priceEth: 1 / ethPriceUsd,
      volume24h: 0,
      marketCap: 0,
      change24h: 0,
    },
  ];
}

export default priceFetcher;
