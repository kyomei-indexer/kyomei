/**
 * Log entity representing an EVM event log
 */
export interface Log {
  /** Block number where log was emitted */
  readonly blockNumber: bigint;
  /** Block hash */
  readonly blockHash: `0x${string}`;
  /** Block timestamp */
  readonly blockTimestamp: bigint;
  /** Transaction hash */
  readonly transactionHash: `0x${string}`;
  /** Transaction index in block */
  readonly transactionIndex: number;
  /** Log index in block */
  readonly logIndex: number;
  /** Contract address that emitted the log */
  readonly address: `0x${string}`;
  /** First topic (event signature) */
  readonly topic0: `0x${string}` | null;
  /** Second topic (indexed param) */
  readonly topic1: `0x${string}` | null;
  /** Third topic (indexed param) */
  readonly topic2: `0x${string}` | null;
  /** Fourth topic (indexed param) */
  readonly topic3: `0x${string}` | null;
  /** Non-indexed data */
  readonly data: `0x${string}`;
  /** Whether the log was removed (reorg) */
  readonly removed: boolean;
}

/**
 * Raw log as returned from RPC
 */
export interface RawLog {
  address: `0x${string}`;
  topics: `0x${string}`[];
  data: `0x${string}`;
  blockNumber: `0x${string}`;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  transactionIndex: `0x${string}`;
  logIndex: `0x${string}`;
  removed: boolean;
}

/**
 * Create a Log from raw RPC data
 */
export function createLog(
  raw: RawLog,
  blockTimestamp: bigint
): Log {
  return {
    blockNumber: BigInt(raw.blockNumber),
    blockHash: raw.blockHash,
    blockTimestamp,
    transactionHash: raw.transactionHash,
    transactionIndex: Number(raw.transactionIndex),
    logIndex: Number(raw.logIndex),
    address: raw.address.toLowerCase() as `0x${string}`,
    topic0: raw.topics[0] ?? null,
    topic1: raw.topics[1] ?? null,
    topic2: raw.topics[2] ?? null,
    topic3: raw.topics[3] ?? null,
    data: raw.data,
    removed: raw.removed,
  };
}

/**
 * Decoded log with event name and arguments
 */
export interface DecodedLog<TArgs = Record<string, unknown>> extends Log {
  /** Event name from ABI */
  readonly eventName: string;
  /** Decoded event arguments */
  readonly args: TArgs;
}

/**
 * Log filter for querying logs
 */
export interface LogFilter {
  /** Contract addresses to filter */
  address?: `0x${string}` | `0x${string}`[];
  /** Event signatures to filter */
  topics?: (`0x${string}` | `0x${string}`[] | null)[];
  /** Start block */
  fromBlock: bigint;
  /** End block */
  toBlock: bigint;
}

/**
 * Create a log filter
 */
export function createLogFilter(params: {
  address?: `0x${string}` | `0x${string}`[];
  topics?: (`0x${string}` | `0x${string}`[] | null)[];
  fromBlock: bigint;
  toBlock: bigint;
}): LogFilter {
  return {
    address: params.address,
    topics: params.topics,
    fromBlock: params.fromBlock,
    toBlock: params.toBlock,
  };
}

/**
 * Get unique ordering key for a log
 */
export function getLogOrderKey(log: Log): string {
  return `${log.blockNumber.toString().padStart(20, '0')}-${log.transactionIndex.toString().padStart(10, '0')}-${log.logIndex.toString().padStart(10, '0')}`;
}

/**
 * Compare two logs by their order in the chain
 */
export function compareLogs(a: Log, b: Log): number {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1;
  }
  if (a.transactionIndex !== b.transactionIndex) {
    return a.transactionIndex - b.transactionIndex;
  }
  return a.logIndex - b.logIndex;
}
