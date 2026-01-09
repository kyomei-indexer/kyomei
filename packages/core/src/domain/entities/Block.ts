/**
 * Block entity representing an EVM block
 */
export interface Block {
  /** Block number */
  readonly number: bigint;
  /** Block hash */
  readonly hash: `0x${string}`;
  /** Parent block hash */
  readonly parentHash: `0x${string}`;
  /** Block timestamp (Unix seconds) */
  readonly timestamp: bigint;
  /** Gas limit */
  readonly gasLimit: bigint;
  /** Gas used */
  readonly gasUsed: bigint;
  /** Base fee per gas (EIP-1559) */
  readonly baseFeePerGas: bigint | null;
  /** Miner/validator address */
  readonly miner: `0x${string}`;
  /** Extra data */
  readonly extraData: `0x${string}`;
  /** Transaction count */
  readonly transactionCount: number;
}

/**
 * Block with associated logs for processing
 */
export interface BlockWithLogs {
  readonly block: Block;
  readonly logs: readonly Log[];
  readonly transactions?: readonly Transaction[];
}

/**
 * Import Log and Transaction for the interface
 */
import type { Log } from './Log.ts';
import type { Transaction } from './Transaction.ts';

/**
 * Create a Block from raw RPC data
 */
export function createBlock(data: {
  number: bigint;
  hash: `0x${string}`;
  parentHash: `0x${string}`;
  timestamp: bigint;
  gasLimit: bigint;
  gasUsed: bigint;
  baseFeePerGas?: bigint | null;
  miner: `0x${string}`;
  extraData: `0x${string}`;
  transactions: readonly unknown[];
}): Block {
  return {
    number: data.number,
    hash: data.hash,
    parentHash: data.parentHash,
    timestamp: data.timestamp,
    gasLimit: data.gasLimit,
    gasUsed: data.gasUsed,
    baseFeePerGas: data.baseFeePerGas ?? null,
    miner: data.miner,
    extraData: data.extraData,
    transactionCount: data.transactions.length,
  };
}

/**
 * Block range for fetching
 */
export interface BlockRange {
  readonly from: bigint;
  readonly to: bigint;
}

/**
 * Create a block range
 */
export function createBlockRange(from: bigint, to: bigint): BlockRange {
  if (from > to) {
    throw new Error(`Invalid block range: from (${from}) > to (${to})`);
  }
  return { from, to };
}

/**
 * Calculate the size of a block range
 */
export function blockRangeSize(range: BlockRange): bigint {
  return range.to - range.from + 1n;
}

/**
 * Split a block range into chunks
 */
export function splitBlockRange(range: BlockRange, chunkSize: bigint): BlockRange[] {
  const chunks: BlockRange[] = [];
  let current = range.from;

  while (current <= range.to) {
    const chunkEnd = current + chunkSize - 1n;
    chunks.push({
      from: current,
      to: chunkEnd > range.to ? range.to : chunkEnd,
    });
    current = chunkEnd + 1n;
  }

  return chunks;
}
