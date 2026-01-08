import type {
  IBlockSource,
  SourceType,
  BlockHandler,
  Unsubscribe,
  BlockRange,
  BlockWithLogs,
  LogFilter,
} from '@kyomei/core';

/**
 * Mock block source for testing
 */
export class MockBlockSource implements IBlockSource {
  readonly sourceType: SourceType = 'rpc';
  readonly providesValidatedData = true;
  readonly chainId: number;

  private blocks: BlockWithLogs[] = [];
  private latestBlock: bigint = 1000n;
  private handlers: Set<BlockHandler> = new Set();

  constructor(chainId: number = 31337) {
    this.chainId = chainId;
  }

  /**
   * Add blocks to the mock
   */
  addBlocks(blocks: BlockWithLogs[]): void {
    this.blocks.push(...blocks);
    if (blocks.length > 0) {
      const maxBlock = blocks.reduce(
        (max, b) => (b.block.number > max ? b.block.number : max),
        0n
      );
      if (maxBlock > this.latestBlock) {
        this.latestBlock = maxBlock;
      }
    }
  }

  /**
   * Emit a new block to handlers
   */
  emitBlock(block: BlockWithLogs): void {
    for (const handler of this.handlers) {
      handler(block);
    }
  }

  async *getBlocks(
    range: BlockRange,
    _filter?: LogFilter
  ): AsyncGenerator<BlockWithLogs, void, unknown> {
    for (const block of this.blocks) {
      if (block.block.number >= range.from && block.block.number <= range.to) {
        yield block;
      }
    }
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.latestBlock;
  }

  async getFinalizedBlockNumber(): Promise<bigint> {
    return this.latestBlock;
  }

  onBlock(handler: BlockHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async getBlocksByNumbers(blockNumbers: bigint[]): Promise<BlockWithLogs[]> {
    return this.blocks.filter((b) => blockNumbers.includes(b.block.number));
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
