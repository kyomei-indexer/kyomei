import { and, eq, gte, lte, asc, sql } from 'drizzle-orm';
import type { Database } from '../connection.ts';
import { factoryChildren } from '../schemas/sync/index.ts';
import type {
  IFactoryRepository,
  FactoryChildRecord,
  FactoryChildQueryOptions,
} from '@kyomei/core';

/**
 * Factory repository implementation
 */
export class FactoryRepository implements IFactoryRepository {
  constructor(private readonly db: Database) {}

  async insert(record: FactoryChildRecord): Promise<void> {
    await this.db
      .insert(factoryChildren)
      .values({
        chainId: record.chainId,
        factoryAddress: record.factoryAddress,
        childAddress: record.childAddress,
        contractName: record.contractName,
        createdAtBlock: record.createdAtBlock,
        createdAtTxHash: record.createdAtTxHash,
        createdAtLogIndex: record.createdAtLogIndex,
        metadata: record.metadata,
        createdAt: record.createdAt,
      })
      .onConflictDoNothing();
  }

  async insertBatch(records: FactoryChildRecord[]): Promise<void> {
    if (records.length === 0) return;

    const values = records.map((r) => ({
      chainId: r.chainId,
      factoryAddress: r.factoryAddress,
      childAddress: r.childAddress,
      contractName: r.contractName,
      createdAtBlock: r.createdAtBlock,
      createdAtTxHash: r.createdAtTxHash,
      createdAtLogIndex: r.createdAtLogIndex,
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));

    // Insert in batches
    const batchSize = 1000;
    for (let i = 0; i < values.length; i += batchSize) {
      const batch = values.slice(i, i + batchSize);
      await this.db
        .insert(factoryChildren)
        .values(batch)
        .onConflictDoNothing();
    }
  }

  async getByAddress(chainId: number, childAddress: string): Promise<FactoryChildRecord | null> {
    const result = await this.db
      .select()
      .from(factoryChildren)
      .where(
        and(
          eq(factoryChildren.chainId, chainId),
          eq(factoryChildren.childAddress, childAddress.toLowerCase())
        )
      )
      .limit(1);

    if (result.length === 0) return null;

    return this.toRecord(result[0]);
  }

  async query(options: FactoryChildQueryOptions): Promise<FactoryChildRecord[]> {
    const conditions = [eq(factoryChildren.chainId, options.chainId)];

    if (options.factoryAddress) {
      conditions.push(eq(factoryChildren.factoryAddress, options.factoryAddress.toLowerCase()));
    }

    if (options.contractName) {
      conditions.push(eq(factoryChildren.contractName, options.contractName));
    }

    if (options.fromBlock !== undefined) {
      conditions.push(gte(factoryChildren.createdAtBlock, options.fromBlock));
    }

    if (options.toBlock !== undefined) {
      conditions.push(lte(factoryChildren.createdAtBlock, options.toBlock));
    }

    let query = this.db
      .select()
      .from(factoryChildren)
      .where(and(...conditions))
      .orderBy(asc(factoryChildren.createdAtBlock));

    if (options.limit) {
      query = query.limit(options.limit) as any;
    }

    if (options.offset) {
      query = query.offset(options.offset) as any;
    }

    const results = await query;
    return results.map(this.toRecord);
  }

  async getChildAddresses(chainId: number, factoryAddress: string): Promise<string[]> {
    const results = await this.db
      .select({ childAddress: factoryChildren.childAddress })
      .from(factoryChildren)
      .where(
        and(
          eq(factoryChildren.chainId, chainId),
          eq(factoryChildren.factoryAddress, factoryAddress.toLowerCase())
        )
      );

    return results.map((r) => r.childAddress);
  }

  async getChildAddressesByContract(chainId: number, contractName: string): Promise<string[]> {
    const results = await this.db
      .select({ childAddress: factoryChildren.childAddress })
      .from(factoryChildren)
      .where(
        and(
          eq(factoryChildren.chainId, chainId),
          eq(factoryChildren.contractName, contractName)
        )
      );

    return results.map((r) => r.childAddress);
  }

  async isChild(chainId: number, address: string): Promise<boolean> {
    const result = await this.db
      .select({ count: sql<number>`1` })
      .from(factoryChildren)
      .where(
        and(
          eq(factoryChildren.chainId, chainId),
          eq(factoryChildren.childAddress, address.toLowerCase())
        )
      )
      .limit(1);

    return result.length > 0;
  }

  async count(chainId: number, factoryAddress?: string): Promise<number> {
    const conditions = [eq(factoryChildren.chainId, chainId)];

    if (factoryAddress) {
      conditions.push(eq(factoryChildren.factoryAddress, factoryAddress.toLowerCase()));
    }

    const result = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(factoryChildren)
      .where(and(...conditions));

    return Number(result[0]?.count ?? 0);
  }

  async deleteFromBlock(chainId: number, fromBlock: bigint): Promise<number> {
    const result = await this.db
      .delete(factoryChildren)
      .where(
        and(
          eq(factoryChildren.chainId, chainId),
          gte(factoryChildren.createdAtBlock, fromBlock)
        )
      );

    return (result as any).rowCount ?? 0;
  }

  async getLatestCreationBlock(chainId: number, factoryAddress?: string): Promise<bigint | null> {
    const conditions = [eq(factoryChildren.chainId, chainId)];

    if (factoryAddress) {
      conditions.push(eq(factoryChildren.factoryAddress, factoryAddress.toLowerCase()));
    }

    const result = await this.db
      .select({ maxBlock: sql<bigint>`MAX(created_at_block)` })
      .from(factoryChildren)
      .where(and(...conditions));

    return result[0]?.maxBlock ?? null;
  }

  private toRecord(row: typeof factoryChildren.$inferSelect): FactoryChildRecord {
    return {
      chainId: row.chainId,
      factoryAddress: row.factoryAddress,
      childAddress: row.childAddress,
      contractName: row.contractName,
      createdAtBlock: row.createdAtBlock,
      createdAtTxHash: row.createdAtTxHash,
      createdAtLogIndex: row.createdAtLogIndex,
      metadata: row.metadata,
      createdAt: row.createdAt,
    };
  }
}
