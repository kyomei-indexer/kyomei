import type { EventHandler, RpcContext } from "@kyomei/config";

/**
 * ERC20 ABI for reading token metadata
 */
const ERC20_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string", name: "" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8", name: "" }],
  },
] as const;

/**
 * PairCreated event arguments
 */
interface PairCreatedEvent {
  token0: `0x${string}`;
  token1: `0x${string}`;
  pair: `0x${string}`;
}

/**
 * Pair insert data - matches schema.ts pairs table
 */
interface PairInsert {
  address: string;
  token0: string;
  token1: string;
  token0Symbol?: string | null;
  token0Decimals?: number | null;
  token1Symbol?: string | null;
  token1Decimals?: number | null;
  reserve0?: string;
  reserve1?: string;
  createdAtBlock: bigint;
  createdAtTimestamp: bigint;
}

/**
 * Fetch token metadata with proper typing
 */
async function fetchTokenMetadata(
  rpc: RpcContext,
  tokenAddress: `0x${string}`
): Promise<{ symbol: string; decimals: number } | null> {
  try {
    const [symbol, decimals] = await Promise.all([
      rpc.readContract<string>({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "symbol",
      }),
      rpc.readContract<number>({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ]);

    return { symbol, decimals };
  } catch {
    return null;
  }
}

/**
 * Handler for UniswapV2Factory:PairCreated events
 *
 * This handler is triggered whenever a new Uniswap V2 pair is created.
 * It stores the pair information and optionally fetches token metadata.
 */
export const handlePairCreated: EventHandler<PairCreatedEvent> = async (
  context
) => {
  const { event, block, db, rpc } = context;

  // Fetch token metadata using cached RPC
  const [token0Meta, token1Meta] = await Promise.all([
    fetchTokenMetadata(rpc, event.token0),
    fetchTokenMetadata(rpc, event.token1),
  ]);

  // Build pair data
  const pairData: PairInsert = {
    address: event.pair.toLowerCase(),
    token0: event.token0.toLowerCase(),
    token1: event.token1.toLowerCase(),
    token0Symbol: token0Meta?.symbol ?? null,
    token0Decimals: token0Meta?.decimals ?? null,
    token1Symbol: token1Meta?.symbol ?? null,
    token1Decimals: token1Meta?.decimals ?? null,
    reserve0: "0",
    reserve1: "0",
    createdAtBlock: block.number,
    createdAtTimestamp: block.timestamp,
  };

  // Store the new pair
  await db.insert<PairInsert>("pairs").values(pairData);

  // Log creation
  const pairLabel =
    token0Meta && token1Meta
      ? `${token0Meta.symbol}/${token1Meta.symbol}`
      : event.pair;

  console.log(
    `[PairCreated] New pair: ${pairLabel} at block ${block.number}`
  );
};
