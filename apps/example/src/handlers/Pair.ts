import type { EventHandler } from "@kyomei/config";

// ============================================================================
// Event Types
// ============================================================================

/**
 * Swap event arguments from UniswapV2Pair
 */
interface SwapEvent {
  sender: `0x${string}`;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  to: `0x${string}`;
}

/**
 * Sync event arguments from UniswapV2Pair
 */
interface SyncEvent {
  reserve0: bigint;
  reserve1: bigint;
}

/**
 * Mint event arguments from UniswapV2Pair
 */
interface MintEvent {
  sender: `0x${string}`;
  amount0: bigint;
  amount1: bigint;
}

/**
 * Burn event arguments from UniswapV2Pair
 */
interface BurnEvent {
  sender: `0x${string}`;
  amount0: bigint;
  amount1: bigint;
  to: `0x${string}`;
}

// ============================================================================
// Database Types - Match schema.ts
// ============================================================================

/**
 * Swap insert data
 */
interface SwapInsert {
  id: string;
  pairAddress: string;
  sender: string;
  recipient: string;
  amount0In: string;
  amount1In: string;
  amount0Out: string;
  amount1Out: string;
  amountUsd?: string | null;
  blockNumber: bigint;
  blockTimestamp: bigint;
  txHash: string;
  logIndex: number;
}

/**
 * Daily pair stats data
 */
interface DailyPairStatsInsert {
  id: string;
  pairAddress: string;
  dayId: number;
  volume0: string;
  volume1: string;
  volumeUsd?: string;
  swapCount: number;
  mintCount?: number;
  burnCount?: number;
}

interface DailyPairStatsRow {
  id: string;
  pairAddress: string;
  dayId: number;
  volume0: string;
  volume1: string;
  volumeUsd: string | null;
  swapCount: number;
  mintCount: number;
  burnCount: number;
}

/**
 * Pair update data
 */
interface PairUpdate {
  reserve0: string;
  reserve1: string;
  lastSyncBlock: bigint;
  lastSyncTimestamp: bigint;
}

/**
 * Liquidity event insert data
 */
interface LiquidityEventInsert {
  id: string;
  type: "mint" | "burn";
  pairAddress: string;
  sender: string;
  recipient?: string | null;
  amount0: string;
  amount1: string;
  liquidity?: string | null;
  blockNumber: bigint;
  blockTimestamp: bigint;
  txHash: string;
  logIndex: number;
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * Handler for UniswapV2Pair:Swap events
 *
 * Records swap transactions and updates daily volume statistics.
 */
export const handleSwap: EventHandler<SwapEvent> = async (context) => {
  const { event, block, log, transaction, db } = context;

  // Create unique ID from tx hash and log index
  const swapId = `${transaction.hash}-${log.index}`;

  // Build swap data
  const swapData: SwapInsert = {
    id: swapId,
    pairAddress: log.address.toLowerCase(),
    sender: event.sender.toLowerCase(),
    recipient: event.to.toLowerCase(),
    amount0In: event.amount0In.toString(),
    amount1In: event.amount1In.toString(),
    amount0Out: event.amount0Out.toString(),
    amount1Out: event.amount1Out.toString(),
    amountUsd: null, // Would need price oracle
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    txHash: transaction.hash,
    logIndex: log.index,
  };

  // Store the swap
  await db.insert<SwapInsert>("swaps").values(swapData);

  // Update daily volume statistics
  const dayId = Math.floor(Number(block.timestamp) / 86400);
  const dailyStatsId = `${log.address.toLowerCase()}-${dayId}`;

  const existing = await db
    .find<DailyPairStatsRow>("dailyPairStats")
    .where({ id: dailyStatsId });

  if (existing) {
    // Update existing stats
    const newVolume0 = (
      BigInt(existing.volume0) +
      event.amount0In +
      event.amount0Out
    ).toString();
    const newVolume1 = (
      BigInt(existing.volume1) +
      event.amount1In +
      event.amount1Out
    ).toString();

    await db
      .update<Partial<DailyPairStatsInsert>>("dailyPairStats")
      .set({
        volume0: newVolume0,
        volume1: newVolume1,
        swapCount: existing.swapCount + 1,
      })
      .where({ id: existing.id });
  } else {
    // Create new daily stats
    const dailyStatsData: DailyPairStatsInsert = {
      id: dailyStatsId,
      pairAddress: log.address.toLowerCase(),
      dayId,
      volume0: (event.amount0In + event.amount0Out).toString(),
      volume1: (event.amount1In + event.amount1Out).toString(),
      swapCount: 1,
      mintCount: 0,
      burnCount: 0,
    };

    await db
      .insert<DailyPairStatsInsert>("dailyPairStats")
      .values(dailyStatsData);
  }
};

/**
 * Handler for UniswapV2Pair:Sync events
 *
 * Updates the pair's reserve values after any liquidity change.
 */
export const handleSync: EventHandler<SyncEvent> = async (context) => {
  const { event, block, log, db } = context;

  // Update pair reserves
  const updateData: PairUpdate = {
    reserve0: event.reserve0.toString(),
    reserve1: event.reserve1.toString(),
    lastSyncBlock: block.number,
    lastSyncTimestamp: block.timestamp,
  };

  await db
    .update<PairUpdate>("pairs")
    .set(updateData)
    .where({ address: log.address.toLowerCase() });
};

/**
 * Handler for UniswapV2Pair:Mint events
 *
 * Records liquidity addition events.
 */
export const handleMint: EventHandler<MintEvent> = async (context) => {
  const { event, block, log, transaction, db } = context;

  const eventId = `${transaction.hash}-${log.index}`;

  const eventData: LiquidityEventInsert = {
    id: eventId,
    type: "mint",
    pairAddress: log.address.toLowerCase(),
    sender: event.sender.toLowerCase(),
    recipient: null,
    amount0: event.amount0.toString(),
    amount1: event.amount1.toString(),
    liquidity: null,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    txHash: transaction.hash,
    logIndex: log.index,
  };

  await db.insert<LiquidityEventInsert>("liquidityEvents").values(eventData);

  // Update daily stats
  const dayId = Math.floor(Number(block.timestamp) / 86400);
  const dailyStatsId = `${log.address.toLowerCase()}-${dayId}`;

  const existing = await db
    .find<DailyPairStatsRow>("dailyPairStats")
    .where({ id: dailyStatsId });

  if (existing) {
    await db
      .update<Partial<DailyPairStatsInsert>>("dailyPairStats")
      .set({ mintCount: existing.mintCount + 1 })
      .where({ id: existing.id });
  }
};

/**
 * Handler for UniswapV2Pair:Burn events
 *
 * Records liquidity removal events.
 */
export const handleBurn: EventHandler<BurnEvent> = async (context) => {
  const { event, block, log, transaction, db } = context;

  const eventId = `${transaction.hash}-${log.index}`;

  const eventData: LiquidityEventInsert = {
    id: eventId,
    type: "burn",
    pairAddress: log.address.toLowerCase(),
    sender: event.sender.toLowerCase(),
    recipient: event.to.toLowerCase(),
    amount0: event.amount0.toString(),
    amount1: event.amount1.toString(),
    liquidity: null,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
    txHash: transaction.hash,
    logIndex: log.index,
  };

  await db.insert<LiquidityEventInsert>("liquidityEvents").values(eventData);

  // Update daily stats
  const dayId = Math.floor(Number(block.timestamp) / 86400);
  const dailyStatsId = `${log.address.toLowerCase()}-${dayId}`;

  const existing = await db
    .find<DailyPairStatsRow>("dailyPairStats")
    .where({ id: dailyStatsId });

  if (existing) {
    await db
      .update<Partial<DailyPairStatsInsert>>("dailyPairStats")
      .set({ burnCount: existing.burnCount + 1 })
      .where({ id: existing.id });
  }
};
