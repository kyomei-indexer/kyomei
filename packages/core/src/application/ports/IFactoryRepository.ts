/**
 * Factory child record
 * Stores dynamically discovered child contract addresses
 */
export interface FactoryChildRecord {
  /** Chain ID */
  chainId: number;
  /** Factory contract address */
  factoryAddress: string;
  /** Child contract address */
  childAddress: string;
  /** Contract name from config */
  contractName: string;
  /** Block number where child was created */
  createdAtBlock: bigint;
  /** Transaction hash of creation */
  createdAtTxHash: string;
  /** Log index of creation event */
  createdAtLogIndex: number;
  /** Decoded event parameters (JSON) */
  metadata: string | null;
  /** Custom ABI for child contract (JSON, optional) */
  childAbi: string | null;
  /** When the record was inserted */
  createdAt: Date;
}

/**
 * Factory child query options
 */
export interface FactoryChildQueryOptions {
  /** Chain ID */
  chainId: number;
  /** Factory address filter */
  factoryAddress?: string;
  /** Contract name filter */
  contractName?: string;
  /** Created after block */
  fromBlock?: bigint;
  /** Created before block */
  toBlock?: bigint;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Repository for factory-created child contracts
 */
export interface IFactoryRepository {
  /**
   * Insert a new child record
   */
  insert(record: FactoryChildRecord): Promise<void>;

  /**
   * Insert multiple child records in batch
   */
  insertBatch(records: FactoryChildRecord[]): Promise<void>;

  /**
   * Get child by address
   */
  getByAddress(chainId: number, childAddress: string): Promise<FactoryChildRecord | null>;

  /**
   * Query children with filters
   */
  query(options: FactoryChildQueryOptions): Promise<FactoryChildRecord[]>;

  /**
   * Get all child addresses for a factory
   */
  getChildAddresses(chainId: number, factoryAddress: string): Promise<string[]>;

  /**
   * Get all child addresses for a contract name
   */
  getChildAddressesByContract(chainId: number, contractName: string): Promise<string[]>;

  /**
   * Get all child addresses grouped by contract name for a chain
   * More efficient than calling getChildAddressesByContract for each contract
   */
  getAllChildAddressesByChain(chainId: number): Promise<Map<string, string[]>>;

  /**
   * Check if address is a known child
   */
  isChild(chainId: number, address: string): Promise<boolean>;

  /**
   * Count children
   */
  count(chainId: number, factoryAddress?: string): Promise<number>;

  /**
   * Delete children created after a block (for reorg handling)
   */
  deleteFromBlock(chainId: number, fromBlock: bigint): Promise<number>;

  /**
   * Get the latest block where a child was created
   */
  getLatestCreationBlock(chainId: number, factoryAddress?: string): Promise<bigint | null>;
}
