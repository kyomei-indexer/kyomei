import type { Abi, AbiEvent } from "viem";
import type { ContractConfig } from "@kyomei/config";
import type { HandlerRegistration, EventHandler } from "../Kyomei.ts";

/**
 * Ponder-compatible handler builder
 * Provides a similar API to Ponder's ponder.on() syntax
 */
export class PonderCompat {
  private registrations: HandlerRegistration[] = [];
  private contracts: Map<string, ContractConfig & { name: string }> = new Map();

  /**
   * Register contracts for the handler builder
   */
  registerContracts(contracts: Array<ContractConfig & { name: string }>): void {
    for (const contract of contracts) {
      this.contracts.set(contract.name, contract);
    }
  }

  /**
   * Ponder-compatible event handler registration
   *
   * @example
   * ponder.on("ContractName:EventName", async (context) => {
   *   const { event, db, rpc } = context;
   *   await db.insert("tokens").values({ ... });
   * });
   */
  on<TEvent = unknown>(
    eventSelector: string,
    handler: EventHandler<TEvent>
  ): void {
    const [contractName, eventName] = this.parseEventSelector(eventSelector);

    // Validate contract exists
    const contract = this.contracts.get(contractName);
    if (!contract) {
      throw new Error(`Unknown contract: ${contractName}`);
    }

    // Validate event exists in ABI
    const eventExists = contract.abi.some(
      (item) => item.type === "event" && (item as AbiEvent).name === eventName
    );
    if (!eventExists) {
      throw new Error(`Event ${eventName} not found in ${contractName} ABI`);
    }

    this.registrations.push({
      contractName,
      eventName,
      handler: handler as EventHandler,
      mode: "sequential",
    });
  }

  /**
   * Get all registered handlers
   */
  getRegistrations(): HandlerRegistration[] {
    return [...this.registrations];
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.registrations = [];
  }

  /**
   * Parse event selector (ContractName:EventName)
   */
  private parseEventSelector(selector: string): [string, string] {
    const parts = selector.split(":");
    if (parts.length !== 2) {
      throw new Error(
        `Invalid event selector: ${selector}. Expected format: ContractName:EventName`
      );
    }
    return [parts[0], parts[1]];
  }
}

/**
 * Create a Ponder-compatible handler builder
 */
export function createPonder(
  contracts: Array<ContractConfig & { name: string }>
): PonderCompat {
  const ponder = new PonderCompat();
  ponder.registerContracts(contracts);
  return ponder;
}

/**
 * Type helper for event handler context
 * Similar to Ponder's event types
 */
export interface TypedEventContext<
  TAbi extends Abi,
  TEventName extends string
> {
  event: ExtractEventArgs<TAbi, TEventName>;
  block: {
    number: bigint;
    hash: `0x${string}`;
    timestamp: bigint;
  };
  transaction: {
    hash: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}` | null;
    index: number;
  };
  log: {
    index: number;
    address: `0x${string}`;
  };
}

/**
 * Extract event args from ABI
 * Simplified type to avoid complex indexed access issues
 */
type ExtractEventArgs<_TAbi extends Abi, _TEventName extends string> = Record<
  string,
  unknown
>;
