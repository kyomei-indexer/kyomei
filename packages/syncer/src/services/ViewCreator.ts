import type { Database } from '@kyomei/database';
import type { ILogger } from '@kyomei/core';
import { AbiParser, type ParsedEvent } from '@kyomei/core';
import { sql } from 'drizzle-orm';
import type { ContractConfig } from '@kyomei/config';

/**
 * View creator options
 */
export interface ViewCreatorOptions {
  db: Database;
  syncSchema: string;
  appSchema: string;
  logger: ILogger;
}

/**
 * View creator service
 * Creates SQL views in app schema that expose synced data
 */
export class ViewCreator {
  private readonly db: Database;
  private readonly syncSchema: string;
  private readonly appSchema: string;
  private readonly logger: ILogger;
  private readonly abiParser = new AbiParser();

  constructor(options: ViewCreatorOptions) {
    this.db = options.db;
    this.syncSchema = options.syncSchema;
    this.appSchema = options.appSchema;
    this.logger = options.logger.child({ module: 'ViewCreator' });
  }

  /**
   * Create views for all contracts
   */
  async createViewsForContracts(
    contracts: Array<ContractConfig & { name: string }>,
    chainId: number
  ): Promise<void> {
    for (const contract of contracts) {
      const events = this.abiParser.parseEvents(contract.abi);

      for (const event of events) {
        await this.createEventView(contract.name, event, chainId);
      }
    }
  }

  /**
   * Create a view for a specific event
   */
  async createEventView(
    contractName: string,
    event: ParsedEvent,
    chainId: number
  ): Promise<void> {
    const viewName = `${contractName}_${event.name}`.toLowerCase();
    const fullViewName = `${this.appSchema}.${viewName}`;

    // Build column expressions for decoded event data
    const eventColumns = event.inputs.map((input, index) => {
      const columnName = this.toSnakeCase(input.name || `param_${index}`);
      const topicIndex = input.indexed ? this.getTopicIndex(event, index) : null;

      if (topicIndex !== null) {
        // Indexed parameter - extract from topic
        return `topic${topicIndex} AS ${columnName}`;
      } else {
        // Non-indexed parameter - would need complex decoding
        // For now, include raw data
        return null;
      }
    }).filter(Boolean);

    const selectColumns = [
      'chain_id',
      'block_number',
      'block_timestamp',
      'block_hash',
      'tx_hash',
      'tx_index',
      'log_index',
      'address',
      ...eventColumns,
    ].join(',\n      ');

    const viewSql = `
    CREATE OR REPLACE VIEW ${fullViewName} AS
    SELECT
      ${selectColumns}
    FROM ${this.syncSchema}.raw_events
    WHERE chain_id = ${chainId}
      AND topic0 = '${event.signature}'
    ORDER BY block_number, tx_index, log_index;
    `;

    try {
      await this.db.execute(sql.raw(viewSql));
      this.logger.debug(`Created view: ${fullViewName}`, {
        event: event.name,
        signature: event.signature,
      });
    } catch (error) {
      this.logger.error(`Failed to create view: ${fullViewName}`, {
        error: error as Error,
      });
    }
  }

  /**
   * Create a raw events view for a contract
   */
  async createRawEventsView(
    contractName: string,
    addresses: string[],
    chainId: number
  ): Promise<void> {
    const viewName = `${contractName}_events`.toLowerCase();
    const fullViewName = `${this.appSchema}.${viewName}`;

    const addressList = addresses.map((a) => `'${a.toLowerCase()}'`).join(', ');

    const viewSql = `
    CREATE OR REPLACE VIEW ${fullViewName} AS
    SELECT *
    FROM ${this.syncSchema}.raw_events
    WHERE chain_id = ${chainId}
      AND address IN (${addressList})
    ORDER BY block_number, tx_index, log_index;
    `;

    try {
      await this.db.execute(sql.raw(viewSql));
      this.logger.debug(`Created raw events view: ${fullViewName}`);
    } catch (error) {
      this.logger.error(`Failed to create raw events view: ${fullViewName}`, {
        error: error as Error,
      });
    }
  }

  /**
   * Drop all views for a contract
   */
  async dropViewsForContract(contractName: string): Promise<void> {
    // Get all views with this prefix
    const result = await this.db.execute(sql.raw(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = '${this.appSchema}'
        AND table_name LIKE '${contractName.toLowerCase()}_%'
    `));

    for (const row of result as any[]) {
      await this.db.execute(sql.raw(`
        DROP VIEW IF EXISTS ${this.appSchema}.${row.table_name}
      `));
      this.logger.debug(`Dropped view: ${this.appSchema}.${row.table_name}`);
    }
  }

  /**
   * List all views in app schema
   */
  async listViews(): Promise<string[]> {
    const result = await this.db.execute(sql.raw(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = '${this.appSchema}'
      ORDER BY table_name
    `));

    return (result as any[]).map((row) => row.table_name);
  }

  /**
   * Get topic index for an indexed parameter
   */
  private getTopicIndex(event: ParsedEvent, paramIndex: number): number | null {
    let topicIndex = 1; // topic0 is the event signature

    for (let i = 0; i < paramIndex; i++) {
      if (event.inputs[i].indexed) {
        topicIndex++;
      }
    }

    return event.inputs[paramIndex].indexed ? topicIndex : null;
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
}
