import { and, eq, gte, lte, inArray, desc, asc, sql } from 'drizzle-orm';
import type { Database } from '../connection.ts';
import { rawEvents, type NewRawEvent } from '../schemas/sync/index.ts';
import type {
  IEventRepository,
  RawEventRecord,
  EventQueryOptions,
} from '@kyomei/core';
import type { BlockRange, Log } from '@kyomei/core';

/**
 * Event repository implementation using Drizzle ORM
 */
export class EventRepository implements IEventRepository {
  constructor(private readonly db: Database) {}

  async insertBatch(events: RawEventRecord[], batchSize = 10000): Promise<void> {
    if (events.length === 0) return;

    const records: NewRawEvent[] = events.map((e) => ({
      chainId: e.chainId,
      blockNumber: e.blockNumber,
      blockHash: e.blockHash,
      blockTimestamp: e.blockTimestamp,
      txIndex: e.txIndex,
      logIndex: e.logIndex,
      txHash: e.txHash,
      address: e.address,
      topic0: e.topic0,
      topic1: e.topic1,
      topic2: e.topic2,
      topic3: e.topic3,
      data: e.data,
    }));

    // Wrap all inserts in a single transaction for better performance
    await this.db.transaction(async (tx) => {
      // Insert in sub-batches for better memory management
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        await tx
          .insert(rawEvents)
          .values(batch)
          .onConflictDoNothing();
      }
    });
  }

  async query(options: EventQueryOptions): Promise<RawEventRecord[]> {
    const conditions = [eq(rawEvents.chainId, options.chainId)];

    if (options.addresses && options.addresses.length > 0) {
      conditions.push(inArray(rawEvents.address, options.addresses));
    }

    if (options.eventSignatures && options.eventSignatures.length > 0) {
      conditions.push(inArray(rawEvents.topic0, options.eventSignatures));
    }

    if (options.blockRange) {
      conditions.push(gte(rawEvents.blockNumber, options.blockRange.from));
      conditions.push(lte(rawEvents.blockNumber, options.blockRange.to));
    }

    let query = this.db
      .select()
      .from(rawEvents)
      .where(and(...conditions));

    // Apply ordering
    if (options.order === 'desc') {
      query = query.orderBy(
        desc(rawEvents.blockNumber),
        desc(rawEvents.txIndex),
        desc(rawEvents.logIndex)
      ) as any;
    } else {
      query = query.orderBy(
        asc(rawEvents.blockNumber),
        asc(rawEvents.txIndex),
        asc(rawEvents.logIndex)
      ) as any;
    }

    // Apply pagination
    if (options.limit) {
      query = query.limit(options.limit) as any;
    }
    if (options.offset) {
      query = query.offset(options.offset) as any;
    }

    const results = await query;
    return results.map(this.toRecord);
  }

  async getByBlock(chainId: number, blockNumber: bigint): Promise<RawEventRecord[]> {
    const results = await this.db
      .select()
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.chainId, chainId),
          eq(rawEvents.blockNumber, blockNumber)
        )
      )
      .orderBy(asc(rawEvents.txIndex), asc(rawEvents.logIndex));

    return results.map(this.toRecord);
  }

  async count(chainId: number, blockRange?: BlockRange): Promise<number> {
    const conditions = [eq(rawEvents.chainId, chainId)];

    if (blockRange) {
      conditions.push(gte(rawEvents.blockNumber, blockRange.from));
      conditions.push(lte(rawEvents.blockNumber, blockRange.to));
    }

    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(rawEvents)
      .where(and(...conditions));

    return Number(result[0]?.count ?? 0);
  }

  async deleteRange(chainId: number, fromBlock: bigint, toBlock?: bigint): Promise<number> {
    const conditions = [
      eq(rawEvents.chainId, chainId),
      gte(rawEvents.blockNumber, fromBlock),
    ];

    if (toBlock !== undefined) {
      conditions.push(lte(rawEvents.blockNumber, toBlock));
    }

    const result = await this.db
      .delete(rawEvents)
      .where(and(...conditions));

    return (result as any).rowCount ?? 0;
  }

  async hasBlock(chainId: number, blockNumber: bigint): Promise<boolean> {
    const result = await this.db
      .select({ count: sql<number>`1` })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.chainId, chainId),
          eq(rawEvents.blockNumber, blockNumber)
        )
      )
      .limit(1);

    return result.length > 0;
  }

  async getLatestBlock(chainId: number): Promise<bigint | null> {
    const result = await this.db
      .select({ maxBlock: sql<bigint>`MAX(block_number)` })
      .from(rawEvents)
      .where(eq(rawEvents.chainId, chainId));

    return result[0]?.maxBlock ?? null;
  }

  async getEarliestBlock(chainId: number): Promise<bigint | null> {
    const result = await this.db
      .select({ minBlock: sql<bigint>`MIN(block_number)` })
      .from(rawEvents)
      .where(eq(rawEvents.chainId, chainId));

    return result[0]?.minBlock ?? null;
  }

  async getGaps(chainId: number, fromBlock: bigint, toBlock: bigint): Promise<BlockRange[]> {
    // Get all unique block numbers in range
    const result = await this.db
      .selectDistinct({ blockNumber: rawEvents.blockNumber })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.chainId, chainId),
          gte(rawEvents.blockNumber, fromBlock),
          lte(rawEvents.blockNumber, toBlock)
        )
      )
      .orderBy(asc(rawEvents.blockNumber));

    const existingBlocks = new Set(result.map((r) => r.blockNumber));
    const gaps: BlockRange[] = [];
    let gapStart: bigint | null = null;

    for (let block = fromBlock; block <= toBlock; block++) {
      if (!existingBlocks.has(block)) {
        if (gapStart === null) {
          gapStart = block;
        }
      } else if (gapStart !== null) {
        gaps.push({ from: gapStart, to: block - 1n });
        gapStart = null;
      }
    }

    // Handle trailing gap
    if (gapStart !== null) {
      gaps.push({ from: gapStart, to: toBlock });
    }

    return gaps;
  }

  logToRecord(log: Log, chainId: number): RawEventRecord {
    return {
      chainId,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      blockTimestamp: log.blockTimestamp,
      txIndex: log.transactionIndex,
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      address: log.address,
      topic0: log.topic0,
      topic1: log.topic1,
      topic2: log.topic2,
      topic3: log.topic3,
      data: log.data,
    };
  }

  private toRecord(row: typeof rawEvents.$inferSelect): RawEventRecord {
    return {
      chainId: row.chainId,
      blockNumber: row.blockNumber,
      blockHash: row.blockHash,
      blockTimestamp: row.blockTimestamp,
      txIndex: row.txIndex,
      logIndex: row.logIndex,
      txHash: row.txHash,
      address: row.address,
      topic0: row.topic0,
      topic1: row.topic1,
      topic2: row.topic2,
      topic3: row.topic3,
      data: row.data,
    };
  }
}
