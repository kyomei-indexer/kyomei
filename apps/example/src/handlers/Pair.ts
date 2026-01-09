/**
 * UniswapV2Pair Event Handlers
 *
 * Demonstrates both sequential (on) and parallel (onParallel) handlers:
 * - onParallel: Used for independent insert operations (Swap, Mint, Burn)
 * - on: Used for operations that update shared state (Sync)
 */

import { kyomei } from "../../kyomei.config.ts";

/**
 * Handle Swap events from UniswapV2Pair contracts.
 *
 * Records each swap transaction for analytics.
 * Uses onParallel since this is an independent insert operation.
 */
kyomei.onParallel("UniswapV2Pair:Swap", async ({ event, context }) => {
  const { args, block, transaction, log } = event;
  const { db } = context;

  await db.insert("swaps").values({
    id: `${transaction.hash}-${log.index}`,
    pair_address: log.address.toLowerCase(),
    sender: args.sender.toLowerCase(),
    to: args.to.toLowerCase(),
    amount0_in: args.amount0In.toString(),
    amount1_in: args.amount1In.toString(),
    amount0_out: args.amount0Out.toString(),
    amount1_out: args.amount1Out.toString(),
    block_number: block.number,
    block_timestamp: block.timestamp,
    tx_hash: transaction.hash,
  });
});

/**
 * Handle Sync events from UniswapV2Pair contracts.
 *
 * Updates the reserve balances for the pair.
 * Uses sequential (on) since it updates shared state (pairs table).
 */
kyomei.on("UniswapV2Pair:Sync", async ({ event, context }) => {
  const { args, block, log } = event;
  const { db } = context;

  await db
    .update("pairs")
    .set({
      reserve0: args.reserve0.toString(),
      reserve1: args.reserve1.toString(),
      last_sync_block: block.number,
      last_sync_timestamp: block.timestamp,
    })
    .where({
      address: log.address.toLowerCase(),
    });
});

/**
 * Handle Mint events from UniswapV2Pair contracts.
 *
 * Records liquidity additions.
 * Uses onParallel since this is an independent insert operation.
 */
kyomei.onParallel("UniswapV2Pair:Mint", async ({ event, context }) => {
  const { args, block, transaction, log } = event;
  const { db } = context;

  await db.insert("liquidity_events").values({
    id: `${transaction.hash}-${log.index}`,
    pair_address: log.address.toLowerCase(),
    type: "mint",
    sender: args.sender.toLowerCase(),
    amount0: args.amount0.toString(),
    amount1: args.amount1.toString(),
    block_number: block.number,
    block_timestamp: block.timestamp,
    tx_hash: transaction.hash,
  });
});

/**
 * Handle Burn events from UniswapV2Pair contracts.
 *
 * Records liquidity removals.
 * Uses onParallel since this is an independent insert operation.
 */
kyomei.onParallel("UniswapV2Pair:Burn", async ({ event, context }) => {
  const { args, block, transaction, log } = event;
  const { db } = context;

  await db.insert("liquidity_events").values({
    id: `${transaction.hash}-${log.index}`,
    pair_address: log.address.toLowerCase(),
    type: "burn",
    sender: args.sender.toLowerCase(),
    to: args.to.toLowerCase(),
    amount0: args.amount0.toString(),
    amount1: args.amount1.toString(),
    block_number: block.number,
    block_timestamp: block.timestamp,
    tx_hash: transaction.hash,
  });
});
