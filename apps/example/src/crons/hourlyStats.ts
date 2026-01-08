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
}

interface RpcContext {
  getBlock: (blockNumber?: bigint) => Promise<{
    number: bigint;
    hash: `0x${string}`;
    timestamp: bigint;
    gasUsed: bigint;
    gasLimit: bigint;
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
// Database Types - Match schema.ts
// ============================================================================

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
 * Hourly stats insert data
 */
interface HourlyStatsInsert {
  id: string;
  hourId: number;
  blockNumber: bigint;
  calculatedAt: Date;
  totalSwaps: number;
  totalVolumeUsd: string;
  activePairs: number;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Hourly Statistics Cron Handler
 *
 * Calculates and stores protocol-wide statistics every hour.
 * Stores data in the dedicated kyomei_crons schema.
 *
 * This cron runs every hour (0 * * * *) and aggregates:
 * - Total swap count in the past hour
 * - Total volume in USD
 * - Number of active trading pairs
 */
export const hourlyStats: CronHandler = async (context) => {
  const { db, blockNumber, timestamp, cronName, chainId } = context;

  console.log(`[${cronName}] Calculating hourly stats at block ${blockNumber}`);

  // Calculate hour ID from timestamp
  const timestampMs =
    timestamp instanceof Date ? timestamp.getTime() : Number(timestamp) * 1000;
  const hourId = Math.floor(timestampMs / 3600000);
  const hourStartTimestamp = BigInt(hourId * 3600);
  const hourEndTimestamp = hourStartTimestamp + 3600n;

  try {
    // Query swaps in the past hour
    // Note: In production, use proper query builder with range conditions
    const condition: QueryCondition = {
      blockTimestamp_gte: hourStartTimestamp,
      blockTimestamp_lt: hourEndTimestamp,
    };

    const swaps = (await db
      .find<SwapRow>("swaps")
      .many(condition)) as SwapRow[];

    const swapCount = swaps.length;

    // Calculate volume (simplified - in production, would convert to USD)
    let totalVolume = 0n;
    for (const swap of swaps) {
      totalVolume += BigInt(swap.amount0In) + BigInt(swap.amount1In);
    }

    // Count active pairs (pairs with swaps this hour)
    const activePairsSet = new Set<string>();
    for (const swap of swaps) {
      activePairsSet.add(swap.pairAddress);
    }
    const activePairs = activePairsSet.size;

    // Create hourly stats record
    const statsId = `hour-${hourId}`;
    const statsData: HourlyStatsInsert = {
      id: statsId,
      hourId,
      blockNumber,
      calculatedAt: new Date(),
      totalSwaps: swapCount,
      totalVolumeUsd: totalVolume.toString(), // Would need price conversion
      activePairs,
    };

    // Store stats in crons schema
    await db
      .insert("hourlyStats")
      .values(statsData as unknown as Record<string, unknown>);

    console.log(`[${cronName}] Hourly stats saved:`);
    console.log(`  - Hour ID: ${hourId}`);
    console.log(`  - Chain ID: ${chainId}`);
    console.log(`  - Block: ${blockNumber}`);
    console.log(`  - Swaps: ${swapCount}`);
    console.log(`  - Active pairs: ${activePairs}`);
  } catch (error) {
    console.error(`[${cronName}] Failed to calculate hourly stats:`, error);
    throw error;
  }
};

export default hourlyStats;
