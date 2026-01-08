import { type PublicClient, createPublicClient, http } from "viem";
import type { Block } from "../../domain/entities/Block.js";
import { createBlock } from "../../domain/entities/Block.js";
import type { Log, LogFilter } from "../../domain/entities/Log.js";
import { createLog } from "../../domain/entities/Log.js";
import type {
  Transaction,
  TransactionReceipt,
} from "../../domain/entities/Transaction.js";
import { createTransaction } from "../../domain/entities/Transaction.js";
import type {
  IRpcClient,
  ReadContractParams,
  RpcCallParams,
} from "../../application/ports/IRpcClient.js";

/**
 * RPC client implementation using viem
 */
export class RpcClient implements IRpcClient {
  readonly chainId: number;
  readonly url: string;
  private readonly client: PublicClient;

  constructor(params: { chainId: number; url: string; timeout?: number }) {
    this.chainId = params.chainId;
    this.url = params.url;
    this.client = createPublicClient({
      transport: http(params.url, {
        timeout: params.timeout ?? 30_000,
        retryCount: 3,
        retryDelay: 1000,
      }),
    });
  }

  async getBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getFinalizedBlockNumber(): Promise<bigint> {
    const block = await this.client.getBlock({ blockTag: "finalized" });
    return block.number;
  }

  async getBlock(blockNumber: bigint): Promise<Block | null> {
    try {
      const block = await this.client.getBlock({
        blockNumber,
        includeTransactions: false,
      });

      return createBlock({
        number: block.number,
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: block.timestamp,
        gasLimit: block.gasLimit,
        gasUsed: block.gasUsed,
        baseFeePerGas: block.baseFeePerGas ?? null,
        miner: block.miner,
        extraData: block.extraData,
        transactions: block.transactions,
      });
    } catch {
      return null;
    }
  }

  async getBlockByHash(hash: `0x${string}`): Promise<Block | null> {
    try {
      const block = await this.client.getBlock({
        blockHash: hash,
        includeTransactions: false,
      });

      return createBlock({
        number: block.number,
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: block.timestamp,
        gasLimit: block.gasLimit,
        gasUsed: block.gasUsed,
        baseFeePerGas: block.baseFeePerGas ?? null,
        miner: block.miner,
        extraData: block.extraData,
        transactions: block.transactions,
      });
    } catch {
      return null;
    }
  }

  async getLogs(filter: LogFilter): Promise<Log[]> {
    // Build the filter params compatible with viem's getLogs
    const params: Parameters<typeof this.client.getLogs>[0] = {
      address: filter.address,
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
    };

    // Add topics if present (cast to satisfy viem's strict typing)
    if (filter.topics && filter.topics.length > 0) {
      (params as Record<string, unknown>).topics = filter.topics;
    }

    const rawLogs = await this.client.getLogs(params);

    // Filter out logs without block numbers (pending logs)
    const confirmedLogs = rawLogs.filter(
      (l): l is typeof l & { blockNumber: bigint; blockHash: `0x${string}` } =>
        l.blockNumber !== null && l.blockHash !== null
    );

    // Get unique block numbers for timestamps
    const blockNumbers = [...new Set(confirmedLogs.map((l) => l.blockNumber))];
    const blockTimestamps = new Map<bigint, bigint>();

    // Batch fetch block timestamps
    for (const blockNumber of blockNumbers) {
      const block = await this.client.getBlock({ blockNumber });
      blockTimestamps.set(blockNumber, block.timestamp);
    }

    return confirmedLogs.map((log) =>
      createLog(
        {
          address: log.address,
          topics: log.topics as `0x${string}`[],
          data: log.data,
          blockNumber: `0x${log.blockNumber.toString(16)}` as `0x${string}`,
          blockHash: log.blockHash,
          transactionHash: log.transactionHash ?? "0x",
          transactionIndex: `0x${(log.transactionIndex ?? 0).toString(
            16
          )}` as `0x${string}`,
          logIndex: `0x${(log.logIndex ?? 0).toString(16)}` as `0x${string}`,
          removed: log.removed,
        },
        blockTimestamps.get(log.blockNumber) ?? 0n
      )
    );
  }

  async getTransaction(hash: `0x${string}`): Promise<Transaction | null> {
    try {
      const tx = await this.client.getTransaction({ hash });

      return createTransaction({
        hash: tx.hash,
        blockNumber: tx.blockNumber!,
        blockHash: tx.blockHash!,
        transactionIndex: tx.transactionIndex!,
        from: tx.from,
        to: tx.to ?? null,
        value: tx.value,
        input: tx.input,
        gas: tx.gas,
        gasPrice: tx.gasPrice ?? null,
        maxFeePerGas: tx.maxFeePerGas ?? null,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
        nonce: tx.nonce,
        type: tx.type,
      });
    } catch {
      return null;
    }
  }

  async getTransactionReceipt(
    hash: `0x${string}`
  ): Promise<TransactionReceipt | null> {
    try {
      const receipt = await this.client.getTransactionReceipt({ hash });

      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        transactionIndex: receipt.transactionIndex,
        contractAddress: receipt.contractAddress ?? null,
        status: receipt.status === "success" ? "success" : "reverted",
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        cumulativeGasUsed: receipt.cumulativeGasUsed,
        logsBloom: receipt.logsBloom,
      };
    } catch {
      return null;
    }
  }

  async getBalance(
    address: `0x${string}`,
    blockNumber?: bigint
  ): Promise<bigint> {
    return this.client.getBalance({
      address,
      blockNumber,
    });
  }

  async readContract<TResult = unknown>(
    params: ReadContractParams
  ): Promise<TResult> {
    const result = await this.client.readContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args as any,
      blockNumber: params.blockNumber,
    });

    return result as TResult;
  }

  async call(params: RpcCallParams): Promise<`0x${string}`> {
    const result = await this.client.call({
      to: params.to,
      data: params.data,
      blockNumber:
        params.blockNumber === "latest" ||
        params.blockNumber === "finalized" ||
        params.blockNumber === "safe"
          ? undefined
          : params.blockNumber,
    });

    return result.data ?? "0x";
  }

  async batch<T extends readonly unknown[]>(
    calls: { method: string; params: unknown[] }[]
  ): Promise<T> {
    // Use viem's batch functionality
    const results = await Promise.all(
      calls.map((call) => this.executeRpcCall(call.method, call.params))
    );
    return results as unknown as T;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a raw RPC call
   */
  private async executeRpcCall(
    method: string,
    params: unknown[]
  ): Promise<unknown> {
    const transport = this.client.transport;
    const response = await transport.request({
      method: method as any,
      params: params as any,
    });
    return response;
  }

  /**
   * Get the underlying viem client
   */
  getViemClient(): PublicClient {
    return this.client;
  }
}
