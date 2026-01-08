import { createHash } from 'node:crypto';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Database } from '../connection.js';
import { rpcCache } from '../schemas/sync/index.js';
import type { IRpcCacheRepository, RpcCacheRecord } from '@kyomei/core';

/**
 * RPC cache repository implementation
 */
export class RpcCacheRepository implements IRpcCacheRepository {
  constructor(private readonly db: Database) {}

  async get(params: {
    chainId: number;
    blockNumber: bigint;
    method: string;
    requestHash: string;
  }): Promise<string | null> {
    const result = await this.db
      .select({ response: rpcCache.response })
      .from(rpcCache)
      .where(
        and(
          eq(rpcCache.chainId, params.chainId),
          eq(rpcCache.blockNumber, params.blockNumber),
          eq(rpcCache.requestHash, params.requestHash)
        )
      )
      .limit(1);

    return result[0]?.response ?? null;
  }

  async set(record: RpcCacheRecord): Promise<void> {
    await this.db
      .insert(rpcCache)
      .values({
        chainId: record.chainId,
        blockNumber: record.blockNumber,
        method: record.method,
        requestHash: record.requestHash,
        params: record.params,
        response: record.response,
        createdAt: record.createdAt,
      })
      .onConflictDoNothing();
  }

  async setBatch(records: RpcCacheRecord[]): Promise<void> {
    if (records.length === 0) return;

    const values = records.map((r) => ({
      chainId: r.chainId,
      blockNumber: r.blockNumber,
      method: r.method,
      requestHash: r.requestHash,
      params: r.params,
      response: r.response,
      createdAt: r.createdAt,
    }));

    await this.db
      .insert(rpcCache)
      .values(values)
      .onConflictDoNothing();
  }

  async deleteRange(chainId: number, fromBlock: bigint, toBlock?: bigint): Promise<number> {
    const conditions = [
      eq(rpcCache.chainId, chainId),
      gte(rpcCache.blockNumber, fromBlock),
    ];

    if (toBlock !== undefined) {
      conditions.push(lte(rpcCache.blockNumber, toBlock));
    }

    const result = await this.db
      .delete(rpcCache)
      .where(and(...conditions));

    return (result as any).rowCount ?? 0;
  }

  async getStats(chainId: number): Promise<{
    totalEntries: number;
    earliestBlock: bigint | null;
    latestBlock: bigint | null;
    sizeBytes: number;
  }> {
    const result = await this.db
      .select({
        totalEntries: sql<number>`COUNT(*)`,
        earliestBlock: sql<bigint>`MIN(block_number)`,
        latestBlock: sql<bigint>`MAX(block_number)`,
        sizeBytes: sql<number>`SUM(LENGTH(params) + LENGTH(response))`,
      })
      .from(rpcCache)
      .where(eq(rpcCache.chainId, chainId));

    const row = result[0];
    return {
      totalEntries: Number(row?.totalEntries ?? 0),
      earliestBlock: row?.earliestBlock ?? null,
      latestBlock: row?.latestBlock ?? null,
      sizeBytes: Number(row?.sizeBytes ?? 0),
    };
  }

  async clear(chainId: number): Promise<void> {
    await this.db.delete(rpcCache).where(eq(rpcCache.chainId, chainId));
  }

  generateRequestHash(method: string, params: unknown[]): string {
    const data = JSON.stringify({ method, params }, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    return createHash('sha256').update(data).digest('hex');
  }
}
