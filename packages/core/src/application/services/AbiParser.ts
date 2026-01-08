import type { Abi, AbiEvent, AbiFunction, AbiParameter } from 'viem';
import { encodeEventTopics, getAbiItem, toEventSelector } from 'viem';

/**
 * Parsed event information
 */
export interface ParsedEvent {
  /** Event name */
  name: string;
  /** Event signature hash (topic0) */
  signature: `0x${string}`;
  /** Full event signature string */
  signatureString: string;
  /** Event inputs */
  inputs: ParsedEventInput[];
  /** ABI event definition */
  abiEvent: AbiEvent;
}

/**
 * Parsed event input
 */
export interface ParsedEventInput {
  /** Parameter name */
  name: string;
  /** Solidity type */
  type: string;
  /** Whether the parameter is indexed */
  indexed: boolean;
  /** Array components (for array types) */
  components?: ParsedEventInput[];
}

/**
 * Factory event detection result
 */
export interface FactoryEventInfo {
  /** Event that creates children */
  event: ParsedEvent;
  /** Parameter containing child address */
  childAddressParam: ParsedEventInput;
  /** Index of the parameter */
  childAddressIndex: number;
}

/**
 * SQL column definition for table generation
 */
export interface SqlColumn {
  name: string;
  sqlType: string;
  nullable: boolean;
  indexed?: boolean;
}

/**
 * ABI Parser service
 * Extracts events, detects factory patterns, and generates table schemas
 */
export class AbiParser {
  /**
   * Parse all events from an ABI
   */
  parseEvents(abi: Abi): ParsedEvent[] {
    const events: ParsedEvent[] = [];

    for (const item of abi) {
      if (item.type === 'event') {
        const event = item as AbiEvent;
        const signature = toEventSelector(event);
        const signatureString = this.getEventSignatureString(event);

        events.push({
          name: event.name,
          signature,
          signatureString,
          inputs: event.inputs.map((input) => this.parseInput(input)),
          abiEvent: event,
        });
      }
    }

    return events;
  }

  /**
   * Get a specific event by name
   */
  getEvent(abi: Abi, eventName: string): ParsedEvent | null {
    const item = getAbiItem({ abi, name: eventName });
    if (!item || item.type !== 'event') {
      return null;
    }

    const event = item as AbiEvent;
    const signature = toEventSelector(event);

    return {
      name: event.name,
      signature,
      signatureString: this.getEventSignatureString(event),
      inputs: event.inputs.map((input) => this.parseInput(input)),
      abiEvent: event,
    };
  }

  /**
   * Get event signature hash from ABI event
   */
  getEventSignature(event: AbiEvent): `0x${string}` {
    return toEventSelector(event);
  }

  /**
   * Encode event topics for filtering
   */
  encodeTopics(event: AbiEvent, args?: Record<string, unknown>): (`0x${string}` | null)[] {
    return encodeEventTopics({ abi: [event], eventName: event.name, args }) as (`0x${string}` | null)[];
  }

  /**
   * Detect factory pattern events (events that emit child addresses)
   */
  detectFactoryEvents(abi: Abi): FactoryEventInfo[] {
    const factoryEvents: FactoryEventInfo[] = [];
    const events = this.parseEvents(abi);

    for (const event of events) {
      // Look for address parameters that could be child contracts
      const addressParams = event.inputs
        .map((input, index) => ({ input, index }))
        .filter(({ input }) => input.type === 'address');

      // Common factory event patterns
      const namePatterns = ['pair', 'pool', 'vault', 'clone', 'child', 'created', 'deployed'];
      const eventNamePatterns = ['Created', 'Deployed', 'Spawned', 'Cloned'];

      for (const { input, index } of addressParams) {
        const inputLower = input.name.toLowerCase();
        const eventLower = event.name.toLowerCase();

        // Check if this looks like a factory child address
        const isFactoryChild =
          namePatterns.some((p) => inputLower.includes(p)) ||
          eventNamePatterns.some((p) => eventLower.includes(p.toLowerCase()));

        if (isFactoryChild) {
          factoryEvents.push({
            event,
            childAddressParam: input,
            childAddressIndex: index,
          });
          break; // Only one child per event
        }
      }
    }

    return factoryEvents;
  }

  /**
   * Get all function signatures from ABI
   */
  parseFunctions(abi: Abi): Array<{ name: string; signature: string; inputs: readonly AbiParameter[] }> {
    return abi
      .filter((item): item is AbiFunction => item.type === 'function')
      .map((func) => ({
        name: func.name,
        signature: this.getFunctionSignatureString(func),
        inputs: func.inputs,
      }));
  }

  /**
   * Generate SQL column definitions for an event
   */
  generateTableColumns(event: ParsedEvent): SqlColumn[] {
    const columns: SqlColumn[] = [
      // Standard columns
      { name: 'chain_id', sqlType: 'INTEGER', nullable: false, indexed: true },
      { name: 'block_number', sqlType: 'BIGINT', nullable: false, indexed: true },
      { name: 'block_timestamp', sqlType: 'BIGINT', nullable: false },
      { name: 'tx_hash', sqlType: 'VARCHAR(66)', nullable: false },
      { name: 'tx_index', sqlType: 'INTEGER', nullable: false },
      { name: 'log_index', sqlType: 'INTEGER', nullable: false },
      { name: 'address', sqlType: 'VARCHAR(42)', nullable: false, indexed: true },
    ];

    // Add event-specific columns
    for (const input of event.inputs) {
      columns.push({
        name: this.toSnakeCase(input.name || `param_${columns.length}`),
        sqlType: this.solidityToSqlType(input.type),
        nullable: false,
        indexed: input.indexed,
      });
    }

    return columns;
  }

  /**
   * Generate CREATE TABLE SQL for an event
   */
  generateCreateTableSql(
    event: ParsedEvent,
    tableName: string,
    schema: string
  ): string {
    const columns = this.generateTableColumns(event);
    const columnDefs = columns.map(
      (col) => `  ${col.name} ${col.sqlType}${col.nullable ? '' : ' NOT NULL'}`
    );

    // Add primary key
    const pkColumns = ['chain_id', 'block_number', 'tx_index', 'log_index'];

    // Generate indexes for indexed parameters
    const indexDefs = columns
      .filter((col) => col.indexed && !pkColumns.includes(col.name))
      .map((col) => `CREATE INDEX idx_${tableName}_${col.name} ON ${schema}.${tableName}(${col.name});`);

    return `
CREATE TABLE ${schema}.${tableName} (
${columnDefs.join(',\n')},
  PRIMARY KEY (${pkColumns.join(', ')})
);

${indexDefs.join('\n')}
`.trim();
  }

  /**
   * Convert Solidity type to PostgreSQL type
   */
  private solidityToSqlType(solidityType: string): string {
    // Handle arrays
    if (solidityType.endsWith('[]')) {
      const baseType = solidityType.slice(0, -2);
      return `${this.solidityToSqlType(baseType)}[]`;
    }

    // Handle fixed-size arrays
    const fixedArrayMatch = solidityType.match(/^(.+)\[(\d+)\]$/);
    if (fixedArrayMatch) {
      const baseType = this.solidityToSqlType(fixedArrayMatch[1]);
      return `${baseType}[]`;
    }

    // Handle basic types
    if (solidityType === 'address') return 'VARCHAR(42)';
    if (solidityType === 'bool') return 'BOOLEAN';
    if (solidityType === 'string') return 'TEXT';
    if (solidityType.startsWith('bytes')) {
      if (solidityType === 'bytes') return 'TEXT';
      return 'VARCHAR(66)'; // bytes32 etc
    }
    if (solidityType.startsWith('uint') || solidityType.startsWith('int')) {
      const bits = Number.parseInt(solidityType.replace(/u?int/, ''), 10) || 256;
      if (bits <= 32) return 'INTEGER';
      if (bits <= 64) return 'BIGINT';
      return 'NUMERIC(78,0)'; // For uint256/int256
    }

    // Default to TEXT for unknown types
    return 'TEXT';
  }

  /**
   * Convert camelCase to snake_case
   */
  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

  /**
   * Get full event signature string
   */
  private getEventSignatureString(event: AbiEvent): string {
    const params = event.inputs.map((input) => this.getTypeString(input)).join(',');
    return `${event.name}(${params})`;
  }

  /**
   * Get full function signature string
   */
  private getFunctionSignatureString(func: AbiFunction): string {
    const params = func.inputs.map((input) => this.getTypeString(input)).join(',');
    return `${func.name}(${params})`;
  }

  /**
   * Get type string for a parameter (handling tuples)
   */
  private getTypeString(param: AbiParameter): string {
    if (param.type === 'tuple' && 'components' in param && param.components) {
      const components = param.components.map((c) => this.getTypeString(c)).join(',');
      return `(${components})`;
    }
    if (param.type.startsWith('tuple') && 'components' in param && param.components) {
      const components = param.components.map((c) => this.getTypeString(c)).join(',');
      const suffix = param.type.slice(5); // e.g., '[]' or '[5]'
      return `(${components})${suffix}`;
    }
    return param.type;
  }

  /**
   * Parse an ABI input parameter
   */
  private parseInput(input: AbiParameter): ParsedEventInput {
    const result: ParsedEventInput = {
      name: input.name || '',
      type: input.type,
      indexed: 'indexed' in input ? !!input.indexed : false,
    };

    if ('components' in input && input.components) {
      result.components = input.components.map((c) => this.parseInput(c));
    }

    return result;
  }
}

/**
 * Singleton instance
 */
export const abiParser = new AbiParser();
