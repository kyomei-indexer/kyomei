/**
 * Transaction entity representing an EVM transaction
 */
export interface Transaction {
  /** Transaction hash */
  readonly hash: `0x${string}`;
  /** Block number */
  readonly blockNumber: bigint;
  /** Block hash */
  readonly blockHash: `0x${string}`;
  /** Transaction index in block */
  readonly transactionIndex: number;
  /** Sender address */
  readonly from: `0x${string}`;
  /** Recipient address (null for contract creation) */
  readonly to: `0x${string}` | null;
  /** Value in wei */
  readonly value: bigint;
  /** Input data */
  readonly input: `0x${string}`;
  /** Gas limit */
  readonly gas: bigint;
  /** Gas price (legacy) */
  readonly gasPrice: bigint | null;
  /** Max fee per gas (EIP-1559) */
  readonly maxFeePerGas: bigint | null;
  /** Max priority fee per gas (EIP-1559) */
  readonly maxPriorityFeePerGas: bigint | null;
  /** Nonce */
  readonly nonce: number;
  /** Transaction type */
  readonly type: TransactionType;
}

/**
 * Transaction types
 */
export type TransactionType = 'legacy' | 'eip2930' | 'eip1559' | 'eip4844';

/**
 * Transaction receipt
 */
export interface TransactionReceipt {
  /** Transaction hash */
  readonly transactionHash: `0x${string}`;
  /** Block number */
  readonly blockNumber: bigint;
  /** Block hash */
  readonly blockHash: `0x${string}`;
  /** Transaction index */
  readonly transactionIndex: number;
  /** Contract address (if contract creation) */
  readonly contractAddress: `0x${string}` | null;
  /** Transaction status */
  readonly status: 'success' | 'reverted';
  /** Gas used */
  readonly gasUsed: bigint;
  /** Effective gas price */
  readonly effectiveGasPrice: bigint;
  /** Cumulative gas used in block */
  readonly cumulativeGasUsed: bigint;
  /** Logs bloom filter */
  readonly logsBloom: `0x${string}`;
}

/**
 * Create a Transaction from raw RPC data
 */
export function createTransaction(data: {
  hash: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionIndex: number;
  from: `0x${string}`;
  to: `0x${string}` | null;
  value: bigint;
  input: `0x${string}`;
  gas: bigint;
  gasPrice?: bigint | null;
  maxFeePerGas?: bigint | null;
  maxPriorityFeePerGas?: bigint | null;
  nonce: number;
  type: string;
}): Transaction {
  return {
    hash: data.hash,
    blockNumber: data.blockNumber,
    blockHash: data.blockHash,
    transactionIndex: data.transactionIndex,
    from: data.from.toLowerCase() as `0x${string}`,
    to: data.to ? (data.to.toLowerCase() as `0x${string}`) : null,
    value: data.value,
    input: data.input,
    gas: data.gas,
    gasPrice: data.gasPrice ?? null,
    maxFeePerGas: data.maxFeePerGas ?? null,
    maxPriorityFeePerGas: data.maxPriorityFeePerGas ?? null,
    nonce: data.nonce,
    type: parseTransactionType(data.type),
  };
}

/**
 * Parse transaction type from hex string
 */
function parseTransactionType(type: string): TransactionType {
  const typeNum = Number(type);
  switch (typeNum) {
    case 0:
      return 'legacy';
    case 1:
      return 'eip2930';
    case 2:
      return 'eip1559';
    case 3:
      return 'eip4844';
    default:
      return 'legacy';
  }
}

/**
 * Check if transaction is a contract creation
 */
export function isContractCreation(tx: Transaction): boolean {
  return tx.to === null;
}

/**
 * Check if transaction is EIP-1559
 */
export function isEIP1559Transaction(tx: Transaction): boolean {
  return tx.type === 'eip1559' || tx.type === 'eip4844';
}
