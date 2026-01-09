/**
 * UniswapV2Factory Event Handlers
 */

import { kyomei } from "../../kyomei.config.ts";
import { type RpcContext } from "@kyomei/processor";
import { ERC20Abi } from "../abis/index.ts";

/**
 * Fetch ERC20 token metadata using cached RPC calls.
 */
async function fetchTokenMetadata(
  rpc: RpcContext,
  tokenAddress: `0x${string}`
): Promise<{ symbol: string; decimals: number } | null> {
  try {
    const [symbol, decimals] = await Promise.all([
      rpc.readContract<string>({
        address: tokenAddress,
        abi: ERC20Abi,
        functionName: "symbol",
      }),
      rpc.readContract<number>({
        address: tokenAddress,
        abi: ERC20Abi,
        functionName: "decimals",
      }),
    ]);
    return { symbol, decimals };
  } catch {
    return null;
  }
}

/**
 * Handle PairCreated events from the UniswapV2Factory contract.
 *
 * This is triggered whenever a new trading pair is created.
 * We store the pair information and fetch token metadata.
 */
kyomei.on("UniswapV2Factory:PairCreated", async ({ event, context }) => {
  const { args, block } = event;
  const { db, rpc } = context;

  // Fetch token metadata using cached RPC
  const [token0Meta, token1Meta] = await Promise.all([
    fetchTokenMetadata(rpc, args.token0),
    fetchTokenMetadata(rpc, args.token1),
  ]);

  // Store the new pair
  await db.insert("pairs").values({
    address: args.pair.toLowerCase(),
    token0: args.token0.toLowerCase(),
    token1: args.token1.toLowerCase(),
    token0_symbol: token0Meta?.symbol ?? null,
    token0_decimals: token0Meta?.decimals ?? null,
    token1_symbol: token1Meta?.symbol ?? null,
    token1_decimals: token1Meta?.decimals ?? null,
    reserve0: "0",
    reserve1: "0",
    created_at_block: block.number,
    created_at_timestamp: block.timestamp,
  });

  const pairLabel =
    token0Meta && token1Meta
      ? `${token0Meta.symbol}/${token1Meta.symbol}`
      : args.pair;

  console.log(`[PairCreated] ${pairLabel} at block ${block.number}`);
});
