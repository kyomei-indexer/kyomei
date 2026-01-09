/**
 * Kyomei - Type-safe event handler registration
 *
 * Provides a Ponder-like API for registering event handlers with full type inference.
 *
 * @example
 * ```typescript
 * import { Kyomei } from '@kyomei/processor';
 * import { UniswapV2FactoryAbi, UniswapV2PairAbi } from './abis';
 *
 * // Create a Kyomei instance with your contracts
 * export const kyomei = new Kyomei({
 *   UniswapV2Factory: { abi: UniswapV2FactoryAbi },
 *   UniswapV2Pair: { abi: UniswapV2PairAbi },
 * });
 *
 * // Register handlers with full type inference
 * kyomei.on('UniswapV2Factory:PairCreated', async ({ event, context }) => {
 *   // event.args is fully typed: { token0, token1, pair }
 *   await context.db.insert('pairs').values({ ... });
 * });
 * ```
 */

import type { Abi } from "abitype";
import type { GetEventArgs as ViemGetEventArgs } from "viem";

// ============================================================================
// Type Utilities for ABI Event Inference
// ============================================================================

/**
 * Extract event names from an ABI
 */
type ExtractEventNames<TAbi extends Abi> = Extract<
  TAbi[number],
  { type: "event" }
>["name"];

/**
 * Get event args type from ABI and event name using viem's type system
 * This correctly handles both named and unnamed parameters
 */
type GetEventArgs<
  TAbi extends Abi,
  TEventName extends string
> = ViemGetEventArgs<
  TAbi,
  TEventName,
  { EnableUnion: false; IndexedOnly: false; Required: true }
>;

/**
 * Contract configuration for Kyomei
 */
export interface KyomeiContractConfig<TAbi extends Abi = Abi> {
  abi: TAbi;
}

/**
 * Contracts map type
 */
export type KyomeiContracts = Record<string, KyomeiContractConfig>;

/**
 * Build event keys from contracts
 * Creates a union of "ContractName:EventName" strings
 */
type BuildEventKeys<TContracts extends KyomeiContracts> = {
  [K in keyof TContracts]: TContracts[K]["abi"] extends Abi
    ? `${K & string}:${ExtractEventNames<TContracts[K]["abi"]>}`
    : never;
}[keyof TContracts];

/**
 * Extract contract name from event key
 */
type ExtractContractName<TKey extends string> =
  TKey extends `${infer Contract}:${string}` ? Contract : never;

/**
 * Extract event name from event key
 */
type ExtractEventName<TKey extends string> =
  TKey extends `${string}:${infer Event}` ? Event : never;

/**
 * Get event args for a specific event key
 */
type GetEventArgsForKey<
  TContracts extends KyomeiContracts,
  TKey extends string
> = ExtractContractName<TKey> extends keyof TContracts
  ? TContracts[ExtractContractName<TKey>]["abi"] extends Abi
    ? GetEventArgs<
        TContracts[ExtractContractName<TKey>]["abi"],
        ExtractEventName<TKey>
      >
    : never
  : never;

// ============================================================================
// Handler Context Types
// ============================================================================

/**
 * Block information provided to handlers
 */
export interface BlockContext {
  /** Block number */
  number: bigint;
  /** Block hash */
  hash: `0x${string}`;
  /** Block timestamp (unix seconds) */
  timestamp: bigint;
}

/**
 * Transaction information provided to handlers
 */
export interface TransactionContext {
  /** Transaction hash */
  hash: `0x${string}`;
  /** Sender address */
  from: `0x${string}`;
  /** Recipient address (null for contract creation) */
  to: `0x${string}` | null;
  /** Transaction index in block */
  index: number;
}

/**
 * Log information provided to handlers
 */
export interface LogContext {
  /** Log index in block */
  index: number;
  /** Contract address that emitted the event */
  address: `0x${string}`;
}

/**
 * Database operations context
 */
export interface DbContext {
  /** Insert record(s) into a table */
  insert: <T extends Record<string, unknown>>(
    table: string
  ) => {
    values: (data: T | T[]) => Promise<void>;
  };
  /** Update records in a table */
  update: <T extends Record<string, unknown>>(
    table: string
  ) => {
    set: (data: Partial<T>) => {
      where: (condition: Record<string, unknown>) => Promise<void>;
    };
  };
  /** Delete records from a table */
  delete: (table: string) => {
    where: (condition: Record<string, unknown>) => Promise<void>;
  };
  /** Find record(s) in a table */
  find: <T extends Record<string, unknown>>(
    table: string
  ) => {
    where: (condition: Record<string, unknown>) => Promise<T | null>;
    many: (condition?: Record<string, unknown>) => Promise<T[]>;
  };
  /** Get record by ID */
  get: <T extends Record<string, unknown>>(
    table: string,
    id: string | number
  ) => Promise<T | null>;
}

/**
 * RPC operations context (cached for deterministic replay)
 */
export interface RpcContext {
  /** Read contract state at current block */
  readContract: <TResult = unknown>(params: {
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args?: unknown[];
  }) => Promise<TResult>;
  /** Get ETH balance at current block */
  getBalance: (address: `0x${string}`) => Promise<bigint>;
  /** Get block by number */
  getBlock: (
    blockNumber?: bigint
  ) => Promise<BlockContext & { gasUsed: bigint; gasLimit: bigint }>;
  /** Get transaction receipt */
  getTransactionReceipt: (hash: `0x${string}`) => Promise<{
    status: "success" | "reverted";
    gasUsed: bigint;
    logs: Array<{
      address: `0x${string}`;
      topics: `0x${string}`[];
      data: `0x${string}`;
    }>;
  }>;
}

/**
 * Full context provided to event handlers
 */
export interface HandlerContext {
  /** Database operations */
  db: DbContext;
  /** Cached RPC operations */
  rpc: RpcContext;
}

/**
 * Event data provided to handlers
 */
export interface EventData<TArgs = Record<string, unknown>> {
  /** Decoded event arguments (fully typed from ABI) */
  args: TArgs;
  /** Block information */
  block: BlockContext;
  /** Transaction information */
  transaction: TransactionContext;
  /** Log information */
  log: LogContext;
}

/**
 * Handler function parameters
 */
export interface HandlerParams<TArgs = Record<string, unknown>> {
  /** The decoded event with typed arguments */
  event: EventData<TArgs>;
  /** Context with database and RPC access */
  context: HandlerContext;
}

/**
 * Event handler function type
 */
export type EventHandler<TArgs = Record<string, unknown>> = (
  params: HandlerParams<TArgs>
) => Promise<void> | void;

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Handler execution mode
 */
export type HandlerExecutionMode = "sequential" | "parallel";

/**
 * Internal handler registration record
 */
export interface HandlerRegistration {
  contractName: string;
  eventName: string;
  handler: EventHandler;
  /**
   * Execution mode for this handler
   * - 'sequential': Handler runs one at a time, in order (default)
   * - 'parallel': Handler can run concurrently with other parallel handlers
   */
  mode: HandlerExecutionMode;
}

// ============================================================================
// Kyomei Class
// ============================================================================

/**
 * Kyomei - Type-safe blockchain event indexer
 *
 * Create an instance with your contract ABIs to get full type inference
 * when registering event handlers.
 */
export class Kyomei<TContracts extends KyomeiContracts> {
  private readonly contracts: TContracts;
  private readonly registrations: HandlerRegistration[] = [];

  /**
   * Create a new Kyomei instance
   *
   * @param contracts - Map of contract names to their configurations
   *
   * @example
   * ```typescript
   * const kyomei = new Kyomei({
   *   UniswapV2Factory: { abi: UniswapV2FactoryAbi },
   *   UniswapV2Pair: { abi: UniswapV2PairAbi },
   * });
   * ```
   */
  constructor(contracts: TContracts) {
    this.contracts = contracts;
  }

  /**
   * Register an event handler (sequential execution)
   *
   * Handlers registered with `on` are executed one at a time, in order.
   * Use this for handlers that modify shared state or depend on previous results.
   *
   * @param eventKey - Event identifier in format "ContractName:EventName"
   * @param handler - Handler function with typed event arguments
   *
   * @example
   * ```typescript
   * kyomei.on('UniswapV2Factory:PairCreated', async ({ event, context }) => {
   *   // This handler runs sequentially - safe for dependent operations
   *   await context.db.insert('pairs').values({
   *     address: event.args.pair,
   *     token0: event.args.token0,
   *     token1: event.args.token1,
   *   });
   * });
   * ```
   */
  on<TKey extends BuildEventKeys<TContracts>>(
    eventKey: TKey,
    handler: EventHandler<GetEventArgsForKey<TContracts, TKey>>
  ): this {
    return this.registerHandler(eventKey, handler, "sequential");
  }

  /**
   * Register an event handler for parallel execution
   *
   * Handlers registered with `onParallel` can run concurrently with other
   * parallel handlers. Use this for independent operations that don't
   * share state or depend on other handlers.
   *
   * ⚠️ Warning: Parallel handlers should not:
   * - Depend on results from other handlers
   * - Modify shared state that other handlers read
   * - Require strict ordering guarantees
   *
   * @param eventKey - Event identifier in format "ContractName:EventName"
   * @param handler - Handler function with typed event arguments
   *
   * @example
   * ```typescript
   * // Good: Independent insert operations
   * kyomei.onParallel('UniswapV2Pair:Swap', async ({ event, context }) => {
   *   await context.db.insert('swaps').values({ ... });
   * });
   *
   * // Good: Read-only operations
   * kyomei.onParallel('UniswapV2Pair:Transfer', async ({ event, context }) => {
   *   const balance = await context.rpc.getBalance(event.args.to);
   *   await context.db.insert('transfers').values({ ... });
   * });
   * ```
   */
  onParallel<TKey extends BuildEventKeys<TContracts>>(
    eventKey: TKey,
    handler: EventHandler<GetEventArgsForKey<TContracts, TKey>>
  ): this {
    return this.registerHandler(eventKey, handler, "parallel");
  }

  /**
   * Internal method to register a handler with a specific execution mode
   */
  private registerHandler<TKey extends BuildEventKeys<TContracts>>(
    eventKey: TKey,
    handler: EventHandler<GetEventArgsForKey<TContracts, TKey>>,
    mode: HandlerExecutionMode
  ): this {
    const [contractName, eventName] = eventKey.split(":");

    if (!contractName || !eventName) {
      throw new Error(
        `Invalid event key: "${eventKey}". Expected format: "ContractName:EventName"`
      );
    }

    if (!(contractName in this.contracts)) {
      throw new Error(
        `Unknown contract: "${contractName}". Available contracts: ${Object.keys(
          this.contracts
        ).join(", ")}`
      );
    }

    this.registrations.push({
      contractName,
      eventName,
      handler: handler as unknown as EventHandler,
      mode,
    });

    return this;
  }

  /**
   * Get all registered handlers
   *
   * Used internally by the processor to execute handlers.
   */
  getRegistrations(): HandlerRegistration[] {
    return [...this.registrations];
  }

  /**
   * Get contract configurations
   *
   * Used internally to access ABIs for event decoding.
   */
  getContracts(): TContracts {
    return this.contracts;
  }

  /**
   * Get a specific contract's ABI
   */
  getAbi<K extends keyof TContracts>(contractName: K): TContracts[K]["abi"] {
    return this.contracts[contractName].abi;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new Kyomei instance from contract definitions
 *
 * @example
 * ```typescript
 * import { createKyomei } from '@kyomei/processor';
 *
 * export const kyomei = createKyomei({
 *   UniswapV2Factory: { abi: UniswapV2FactoryAbi },
 *   UniswapV2Pair: { abi: UniswapV2PairAbi },
 * });
 * ```
 */
export function createKyomei<TContracts extends KyomeiContracts>(
  contracts: TContracts
): Kyomei<TContracts> {
  return new Kyomei(contracts);
}

/**
 * Config contract type - has an abi property and possibly other config props
 */
interface ConfigContract {
  abi: Abi;
}

/**
 * Config with contracts - matches structure from defineConfig
 */
interface ConfigWithContracts<T extends Record<string, ConfigContract>> {
  contracts: T;
}

/**
 * Extract just the ABI from each contract config
 */
type ExtractContractAbis<T extends Record<string, ConfigContract>> = {
  [K in keyof T]: { abi: T[K]["abi"] };
};

/**
 * Create a Kyomei instance directly from config.contracts
 *
 * This eliminates duplication - you define contracts once in defineConfig(),
 * and create the Kyomei instance from that same config.
 *
 * @example
 * ```typescript
 * import { defineConfig } from '@kyomei/config';
 * import { kyomeiFromConfig } from '@kyomei/processor';
 *
 * const config = defineConfig({
 *   contracts: {
 *     UniswapV2Factory: { abi: FactoryAbi, chain: 'mainnet', ... },
 *     UniswapV2Pair: { abi: PairAbi, chain: 'mainnet', ... },
 *   },
 *   ...
 * });
 *
 * export default config;
 * export const kyomei = kyomeiFromConfig(config);
 * ```
 */
export function kyomeiFromConfig<T extends Record<string, ConfigContract>>(
  config: ConfigWithContracts<T>
): Kyomei<ExtractContractAbis<T>> {
  const contracts = {} as ExtractContractAbis<T>;

  for (const key of Object.keys(config.contracts) as Array<keyof T>) {
    const contract = config.contracts[key];
    (contracts as Record<string, { abi: Abi }>)[key as string] = {
      abi: contract.abi,
    };
  }

  return new Kyomei(contracts);
}
