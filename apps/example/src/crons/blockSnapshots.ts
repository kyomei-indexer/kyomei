// Types will be imported from @kyomei/config after build
// For now, define them locally for type checking

interface QueryCondition {
  [key: string]: unknown;
}

interface DbContext {
  insert: (table: string) => {
    values: (data: Record<string, unknown> | Record<string, unknown>[]) => Promise<void>;
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
    baseFeePerGas?: bigint;
  } | null>;
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
 * Block snapshot insert data
 */
interface BlockSnapshotInsert {
  id: string;
  blockNumber: bigint;
  blockHash: string;
  blockTimestamp: bigint;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas?: string | null;
  snapshotAt: Date;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Block Snapshots Cron Handler
 *
 * Takes snapshots of block data every 100 blocks.
 * Stores in the chain's app schema.
 *
 * This cron runs on block interval (every 100 blocks) and captures:
 * - Block metadata (hash, timestamp, gas usage)
 * - Transaction count
 * - Base fee (for EIP-1559 blocks)
 */
export const blockSnapshots: CronHandler = async (context) => {
  const { db, blockNumber, timestamp, rpc, cronName, chainId } = context;

  console.log(`[${cronName}] Taking snapshot at block ${blockNumber}`);

  try {
    // Get block data via RPC (cached for reindexing)
    const block = await rpc.getBlock(blockNumber);

    if (!block) {
      console.warn(`[${cronName}] Block ${blockNumber} not found`);
      return;
    }

    // Calculate timestamp for display
    const timestampMs =
      timestamp instanceof Date ? timestamp.getTime() : Number(timestamp) * 1000;

    // Calculate block timestamp as bigint
    const blockTimestampBigint =
      timestamp instanceof Date
        ? BigInt(Math.floor(timestamp.getTime() / 1000))
        : BigInt(timestamp);

    // Create snapshot data
    const snapshotId = `block-${blockNumber}`;
    const snapshotData: BlockSnapshotInsert = {
      id: snapshotId,
      blockNumber,
      blockHash: block.hash,
      blockTimestamp: blockTimestampBigint,
      gasUsed: block.gasUsed.toString(),
      gasLimit: block.gasLimit.toString(),
      baseFeePerGas: block.baseFeePerGas?.toString() ?? null,
      snapshotAt: new Date(),
    };

    // Store snapshot in app schema
    await db.insert("blockSnapshots").values(snapshotData as unknown as Record<string, unknown>);

    // Calculate gas percentage
    const gasPercent = (
      (Number(block.gasUsed) / Number(block.gasLimit)) *
      100
    ).toFixed(2);

    console.log(`[${cronName}] Snapshot saved:`);
    console.log(`  - Chain ID: ${chainId}`);
    console.log(`  - Block: ${blockNumber}`);
    console.log(`  - Hash: ${block.hash}`);
    console.log(`  - Timestamp: ${new Date(timestampMs).toISOString()}`);
    console.log(`  - Gas used: ${block.gasUsed} / ${block.gasLimit}`);
    console.log(`  - Gas %: ${gasPercent}%`);

    // Log base fee if available (EIP-1559)
    if (block.baseFeePerGas !== undefined) {
      const gwei = Number(block.baseFeePerGas) / 1e9;
      console.log(`  - Base fee: ${gwei.toFixed(2)} gwei`);
    }
  } catch (error) {
    console.error(`[${cronName}] Failed to take snapshot:`, error);
    throw error;
  }
};

export default blockSnapshots;
