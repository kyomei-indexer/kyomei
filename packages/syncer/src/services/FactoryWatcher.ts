import type {
  IBlockSource,
  IFactoryRepository,
  ILogger,
  BlockRange,
  Log,
} from '@kyomei/core';
import { AbiParser, EventDecoder } from '@kyomei/core';
import type { FactoryConfig, ContractConfig } from '@kyomei/config';
import { isFactoryConfig } from '@kyomei/config';
import { decodeEventLog } from 'viem';

/**
 * Factory watcher options
 */
export interface FactoryWatcherOptions {
  chainId: number;
  chainName: string;
  contracts: Array<ContractConfig & { name: string }>;
  blockSource: IBlockSource;
  factoryRepository: IFactoryRepository;
  logger: ILogger;
}

/**
 * Factory contract definition
 */
interface FactoryContract {
  name: string;
  config: FactoryConfig;
  eventSignature: `0x${string}`;
}

/**
 * Factory watcher service
 * Monitors factory contracts for child creation events
 */
export class FactoryWatcher {
  private readonly chainId: number;
  private readonly blockSource: IBlockSource;
  private readonly factoryRepo: IFactoryRepository;
  private readonly logger: ILogger;
  private readonly factories: FactoryContract[] = [];
  private readonly abiParser = new AbiParser();
  private readonly eventDecoder = new EventDecoder();

  constructor(options: FactoryWatcherOptions) {
    this.chainId = options.chainId;
    this.blockSource = options.blockSource;
    this.factoryRepo = options.factoryRepository;
    this.logger = options.logger.child({ module: 'FactoryWatcher', chain: options.chainName });

    // Find factory contracts
    for (const contract of options.contracts) {
      if (isFactoryConfig(contract.address)) {
        const factoryConfig = contract.address;
        const eventSignature = this.abiParser.getEventSignature(factoryConfig.event);

        this.factories.push({
          name: contract.name,
          config: factoryConfig,
          eventSignature,
        });

        // Register ABI for decoding
        this.eventDecoder.registerContract(contract.name, contract.abi);

        this.logger.debug(`Registered factory: ${contract.name}`, {
          address: factoryConfig.address,
          event: factoryConfig.event.name,
        });
      }
    }
  }

  /**
   * Check if there are any factory contracts to watch
   */
  hasFactories(): boolean {
    return this.factories.length > 0;
  }

  /**
   * Get all tracked factory addresses
   */
  getFactoryAddresses(): `0x${string}`[] {
    return this.factories.map((f) => f.config.address);
  }

  /**
   * Scan a block range for factory events
   */
  async scanRange(range: BlockRange): Promise<number> {
    if (!this.hasFactories()) return 0;

    const addresses = this.getFactoryAddresses();
    const signatures = this.factories.map((f) => f.eventSignature);

    let totalChildren = 0;

    // Get logs for factory events
    for await (const blockWithLogs of this.blockSource.getBlocks(range, {
      address: addresses,
      topics: [signatures],
      fromBlock: range.from,
      toBlock: range.to,
    })) {
      for (const log of blockWithLogs.logs) {
        const child = await this.processLog(log);
        if (child) {
          totalChildren++;
        }
      }
    }

    return totalChildren;
  }

  /**
   * Process a single log for factory events
   */
  async processLog(log: Log): Promise<boolean> {
    if (!log.topic0) return false;

    // Find matching factory
    const factory = this.factories.find(
      (f) =>
        f.eventSignature === log.topic0 &&
        f.config.address.toLowerCase() === log.address.toLowerCase()
    );

    if (!factory) return false;

    try {
      // Decode the event
      const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(
        (t): t is `0x${string}` => t !== null
      ) as [`0x${string}`, ...`0x${string}`[]];
      
      const decoded = decodeEventLog({
        abi: [factory.config.event],
        data: log.data,
        topics,
        strict: false,
      });

      // Extract child address from the specified parameter
      const childAddress = (decoded.args as Record<string, unknown>)[factory.config.parameter] as string;

      if (!childAddress || typeof childAddress !== 'string') {
        this.logger.warn(`Could not extract child address from ${factory.config.parameter}`, {
          event: factory.config.event.name,
          args: decoded.args,
        });
        return false;
      }

      // Check if already registered
      const existing = await this.factoryRepo.getByAddress(this.chainId, childAddress);
      if (existing) {
        return false;
      }

      // Store the child
      await this.factoryRepo.insert({
        chainId: this.chainId,
        factoryAddress: log.address.toLowerCase(),
        childAddress: childAddress.toLowerCase(),
        contractName: factory.name,
        createdAtBlock: log.blockNumber,
        createdAtTxHash: log.transactionHash,
        createdAtLogIndex: log.logIndex,
        metadata: JSON.stringify(decoded.args),
        createdAt: new Date(),
      });

      this.logger.debug(`Discovered child contract: ${childAddress}`, {
        factory: factory.name,
        block: log.blockNumber,
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to decode factory event`, {
        factory: factory.name,
        error: error as Error,
      });
      return false;
    }
  }

  /**
   * Get all child addresses for a contract name
   */
  async getChildAddresses(contractName: string): Promise<string[]> {
    return this.factoryRepo.getChildAddressesByContract(this.chainId, contractName);
  }

  /**
   * Get all child addresses across all factories
   */
  async getAllChildAddresses(): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();

    for (const factory of this.factories) {
      const children = await this.factoryRepo.getChildAddressesByContract(
        this.chainId,
        factory.name
      );
      result.set(factory.name, children);
    }

    return result;
  }

  /**
   * Check if an address is a known child contract
   */
  async isChild(address: string): Promise<boolean> {
    return this.factoryRepo.isChild(this.chainId, address);
  }

  /**
   * Delete children created after a block (for reorg handling)
   */
  async deleteFromBlock(fromBlock: bigint): Promise<number> {
    return this.factoryRepo.deleteFromBlock(this.chainId, fromBlock);
  }
}
