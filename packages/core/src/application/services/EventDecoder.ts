import type { Abi, AbiEvent } from 'viem';
import { decodeEventLog, getAbiItem } from 'viem';
import type { DecodedLog, Log } from '../../domain/entities/Log.js';

/**
 * Registered contract ABI with metadata
 */
interface RegisteredContract {
  name: string;
  abi: Abi;
  events: Map<`0x${string}`, AbiEvent>;
}

/**
 * Event decoder service
 * Decodes raw logs using registered ABIs
 */
export class EventDecoder {
  private contracts: Map<string, RegisteredContract> = new Map();
  private signatureToContract: Map<`0x${string}`, RegisteredContract[]> = new Map();

  /**
   * Register a contract ABI
   */
  registerContract(name: string, abi: Abi): void {
    const events = new Map<`0x${string}`, AbiEvent>();

    for (const item of abi) {
      if (item.type === 'event') {
        const event = item as AbiEvent;
        const signature = this.getEventSignature(event);
        events.set(signature, event);

        // Map signature to contracts
        const existing = this.signatureToContract.get(signature) ?? [];
        const contract: RegisteredContract = { name, abi, events };
        if (!existing.some((c) => c.name === name)) {
          this.signatureToContract.set(signature, [...existing, contract]);
        }
      }
    }

    this.contracts.set(name, { name, abi, events });
  }

  /**
   * Unregister a contract
   */
  unregisterContract(name: string): void {
    const contract = this.contracts.get(name);
    if (!contract) return;

    // Remove from signature map
    for (const signature of contract.events.keys()) {
      const contracts = this.signatureToContract.get(signature) ?? [];
      const filtered = contracts.filter((c) => c.name !== name);
      if (filtered.length > 0) {
        this.signatureToContract.set(signature, filtered);
      } else {
        this.signatureToContract.delete(signature);
      }
    }

    this.contracts.delete(name);
  }

  /**
   * Decode a log using registered ABIs
   */
  decode(log: Log): DecodedLog | null {
    if (!log.topic0) return null;

    const contracts = this.signatureToContract.get(log.topic0);
    if (!contracts || contracts.length === 0) return null;

    // Try each contract that has this event signature
    for (const contract of contracts) {
      const event = contract.events.get(log.topic0);
      if (!event) continue;

      try {
        const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(
          (t): t is `0x${string}` => t !== null
        ) as [`0x${string}`, ...`0x${string}`[]];

        const decoded = decodeEventLog({
          abi: contract.abi,
          data: log.data,
          topics,
          strict: false,
        });

        return {
          ...log,
          eventName: decoded.eventName ?? 'Unknown',
          args: (decoded.args ?? {}) as unknown as Record<string, unknown>,
        };
      } catch {
        // Try next contract
        continue;
      }
    }

    return null;
  }

  /**
   * Decode a log using a specific contract
   */
  decodeWithContract(log: Log, contractName: string): DecodedLog | null {
    if (!log.topic0) return null;

    const contract = this.contracts.get(contractName);
    if (!contract) return null;

    const event = contract.events.get(log.topic0);
    if (!event) return null;

    try {
      const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(
        (t): t is `0x${string}` => t !== null
      ) as [`0x${string}`, ...`0x${string}`[]];

      const decoded = decodeEventLog({
        abi: contract.abi,
        data: log.data,
        topics,
        strict: false,
      });

      return {
        ...log,
        eventName: decoded.eventName ?? 'Unknown',
        args: (decoded.args ?? {}) as unknown as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }

  /**
   * Decode multiple logs in batch
   */
  decodeBatch(logs: Log[]): DecodedLog[] {
    const decoded: DecodedLog[] = [];

    for (const log of logs) {
      const result = this.decode(log);
      if (result) {
        decoded.push(result);
      }
    }

    return decoded;
  }

  /**
   * Decode logs for a specific event
   */
  decodeForEvent(logs: Log[], contractName: string, eventName: string): DecodedLog[] {
    const contract = this.contracts.get(contractName);
    if (!contract) return [];

    const eventAbi = getAbiItem({ abi: contract.abi, name: eventName }) as AbiEvent | undefined;
    if (!eventAbi) return [];

    const signature = this.getEventSignature(eventAbi);

    return logs
      .filter((log) => log.topic0 === signature)
      .map((log) => this.decodeWithContract(log, contractName))
      .filter((log): log is DecodedLog => log !== null);
  }

  /**
   * Get event signature from ABI event
   */
  private getEventSignature(event: AbiEvent): `0x${string}` {
    // Manual calculation of event signature
    const params = event.inputs.map((input) => this.getTypeString(input)).join(',');
    const signature = `${event.name}(${params})`;

    // Import keccak256 from viem for hashing
    const { keccak256, toHex } = require('viem');
    return keccak256(toHex(signature));
  }

  /**
   * Get type string for parameter (handling tuples)
   */
  private getTypeString(param: { type: string; components?: readonly unknown[] }): string {
    if (param.type === 'tuple' && param.components) {
      const components = (param.components as Array<{ type: string; components?: readonly unknown[] }>)
        .map((c) => this.getTypeString(c))
        .join(',');
      return `(${components})`;
    }
    if (param.type.startsWith('tuple') && param.components) {
      const components = (param.components as Array<{ type: string; components?: readonly unknown[] }>)
        .map((c) => this.getTypeString(c))
        .join(',');
      const suffix = param.type.slice(5);
      return `(${components})${suffix}`;
    }
    return param.type;
  }

  /**
   * Check if an event is registered
   */
  hasEvent(signature: `0x${string}`): boolean {
    return this.signatureToContract.has(signature);
  }

  /**
   * Get all registered event signatures
   */
  getRegisteredSignatures(): `0x${string}`[] {
    return Array.from(this.signatureToContract.keys());
  }

  /**
   * Get registered contract names
   */
  getRegisteredContracts(): string[] {
    return Array.from(this.contracts.keys());
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.contracts.clear();
    this.signatureToContract.clear();
  }
}

/**
 * Singleton instance
 */
export const eventDecoder = new EventDecoder();
