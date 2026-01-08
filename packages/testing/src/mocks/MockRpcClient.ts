import type {
  IRpcClient,
  ReadContractParams,
  RpcCallParams,
  Block,
  Log,
  LogFilter,
  Transaction,
  TransactionReceipt,
} from "@kyomei/core";

/**
 * Mock RPC client for testing
 */
export class MockRpcClient implements IRpcClient {
  readonly chainId: number;
  readonly url: string = "mock://localhost";

  private blockNumber: bigint = 1000n;
  private blocks: Map<bigint, Block> = new Map();
  private logs: Log[] = [];
  private transactions: Map<string, Transaction> = new Map();
  private receipts: Map<string, TransactionReceipt> = new Map();
  private balances: Map<string, bigint> = new Map();
  private contractData: Map<string, unknown> = new Map();

  constructor(chainId: number = 31337) {
    this.chainId = chainId;
  }

  /**
   * Set the current block number
   */
  setBlockNumber(blockNumber: bigint): void {
    this.blockNumber = blockNumber;
  }

  /**
   * Add a mock block
   */
  addBlock(block: Block): void {
    this.blocks.set(block.number, block);
  }

  /**
   * Add mock logs
   */
  addLogs(logs: Log[]): void {
    this.logs.push(...logs);
  }

  /**
   * Set balance for an address
   */
  setBalance(address: string, balance: bigint): void {
    this.balances.set(address.toLowerCase(), balance);
  }

  /**
   * Set contract data response
   */
  setContractData(key: string, data: unknown): void {
    this.contractData.set(key, data);
  }

  async getBlockNumber(): Promise<bigint> {
    return this.blockNumber;
  }

  async getFinalizedBlockNumber(): Promise<bigint> {
    return this.blockNumber - 10n;
  }

  async getBlock(blockNumber: bigint): Promise<Block | null> {
    return this.blocks.get(blockNumber) ?? null;
  }

  async getBlockByHash(hash: `0x${string}`): Promise<Block | null> {
    for (const block of this.blocks.values()) {
      if (block.hash === hash) return block;
    }
    return null;
  }

  async getLogs(filter: LogFilter): Promise<Log[]> {
    return this.logs.filter((log) => {
      if (log.blockNumber < filter.fromBlock) return false;
      if (log.blockNumber > filter.toBlock) return false;
      if (filter.address) {
        const addresses = Array.isArray(filter.address)
          ? filter.address
          : [filter.address];
        if (
          !addresses.some((a) => a.toLowerCase() === log.address.toLowerCase())
        ) {
          return false;
        }
      }
      return true;
    });
  }

  async getTransaction(hash: `0x${string}`): Promise<Transaction | null> {
    return this.transactions.get(hash) ?? null;
  }

  async getTransactionReceipt(
    hash: `0x${string}`
  ): Promise<TransactionReceipt | null> {
    return this.receipts.get(hash) ?? null;
  }

  async getBalance(address: `0x${string}`): Promise<bigint> {
    return this.balances.get(address.toLowerCase()) ?? 0n;
  }

  async readContract<TResult = unknown>(
    params: ReadContractParams
  ): Promise<TResult> {
    const key = `${params.address}:${params.functionName}`;
    const data = this.contractData.get(key);
    if (data === undefined) {
      throw new Error(`No mock data for ${key}`);
    }
    return data as TResult;
  }

  async call(_params: RpcCallParams): Promise<`0x${string}`> {
    return "0x";
  }

  async batch<T extends readonly unknown[]>(
    calls: { method: string; params: unknown[] }[]
  ): Promise<T> {
    const results = await Promise.all(
      calls.map(async (call) => {
        switch (call.method) {
          case "eth_blockNumber":
            return `0x${this.blockNumber.toString(16)}`;
          case "eth_getBalance":
            const balance =
              this.balances.get((call.params[0] as string).toLowerCase()) ?? 0n;
            return `0x${balance.toString(16)}`;
          default:
            return null;
        }
      })
    );
    return results as unknown as T;
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
