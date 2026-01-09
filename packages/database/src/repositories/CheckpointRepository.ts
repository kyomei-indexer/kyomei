import { eq, and, sql } from 'drizzle-orm';
import type { Database } from '../connection.ts';
import { syncCheckpoints } from '../schemas/sync/index.ts';
import { processCheckpoints } from '../schemas/app/index.ts';
import type {
  ISyncCheckpointRepository,
  IProcessCheckpointRepository,
  SyncCheckpoint,
  ProcessCheckpoint,
} from '@kyomei/core';

/**
 * Sync checkpoint repository implementation
 */
export class SyncCheckpointRepository implements ISyncCheckpointRepository {
  constructor(private readonly db: Database) {}

  async get(chainId: number): Promise<SyncCheckpoint | null> {
    const result = await this.db
      .select()
      .from(syncCheckpoints)
      .where(eq(syncCheckpoints.chainId, chainId))
      .limit(1);

    if (result.length === 0) return null;

    return {
      chainId: result[0].chainId,
      blockNumber: result[0].blockNumber,
      blockHash: result[0].blockHash,
      updatedAt: result[0].updatedAt,
    };
  }

  async set(checkpoint: SyncCheckpoint): Promise<void> {
    await this.db
      .insert(syncCheckpoints)
      .values({
        chainId: checkpoint.chainId,
        blockNumber: checkpoint.blockNumber,
        blockHash: checkpoint.blockHash,
        updatedAt: checkpoint.updatedAt,
      })
      .onConflictDoUpdate({
        target: syncCheckpoints.chainId,
        set: {
          blockNumber: checkpoint.blockNumber,
          blockHash: checkpoint.blockHash,
          updatedAt: checkpoint.updatedAt,
        },
      });
  }

  async delete(chainId: number): Promise<void> {
    await this.db
      .delete(syncCheckpoints)
      .where(eq(syncCheckpoints.chainId, chainId));
  }

  async getAll(): Promise<SyncCheckpoint[]> {
    const results = await this.db.select().from(syncCheckpoints);

    return results.map((row) => ({
      chainId: row.chainId,
      blockNumber: row.blockNumber,
      blockHash: row.blockHash,
      updatedAt: row.updatedAt,
    }));
  }
}

/**
 * Process checkpoint repository implementation
 */
export class ProcessCheckpointRepository implements IProcessCheckpointRepository {
  constructor(private readonly db: Database) {}

  async get(chainId: number, handlerName?: string): Promise<ProcessCheckpoint | null> {
    const result = await this.db
      .select()
      .from(processCheckpoints)
      .where(
        and(
          eq(processCheckpoints.chainId, chainId),
          eq(processCheckpoints.handlerName, handlerName ?? 'default')
        )
      )
      .limit(1);

    if (result.length === 0) return null;

    return {
      chainId: result[0].chainId,
      blockNumber: result[0].blockNumber,
      handlerName: result[0].handlerName,
      updatedAt: result[0].updatedAt,
    };
  }

  async set(checkpoint: ProcessCheckpoint): Promise<void> {
    await this.db
      .insert(processCheckpoints)
      .values({
        chainId: checkpoint.chainId,
        handlerName: checkpoint.handlerName ?? 'default',
        blockNumber: checkpoint.blockNumber,
        updatedAt: checkpoint.updatedAt,
      })
      .onConflictDoUpdate({
        target: [processCheckpoints.chainId, processCheckpoints.handlerName],
        set: {
          blockNumber: checkpoint.blockNumber,
          updatedAt: checkpoint.updatedAt,
        },
      });
  }

  async delete(chainId: number, handlerName?: string): Promise<void> {
    await this.db
      .delete(processCheckpoints)
      .where(
        and(
          eq(processCheckpoints.chainId, chainId),
          eq(processCheckpoints.handlerName, handlerName ?? 'default')
        )
      );
  }

  async getAllForChain(chainId: number): Promise<ProcessCheckpoint[]> {
    const results = await this.db
      .select()
      .from(processCheckpoints)
      .where(eq(processCheckpoints.chainId, chainId));

    return results.map((row) => ({
      chainId: row.chainId,
      blockNumber: row.blockNumber,
      handlerName: row.handlerName,
      updatedAt: row.updatedAt,
    }));
  }

  async getAll(): Promise<ProcessCheckpoint[]> {
    const results = await this.db.select().from(processCheckpoints);

    return results.map((row) => ({
      chainId: row.chainId,
      blockNumber: row.blockNumber,
      handlerName: row.handlerName,
      updatedAt: row.updatedAt,
    }));
  }

  async getMinBlock(chainId: number): Promise<bigint | null> {
    const result = await this.db
      .select({ minBlock: sql<bigint>`MIN(block_number)` })
      .from(processCheckpoints)
      .where(eq(processCheckpoints.chainId, chainId));

    return result[0]?.minBlock ?? null;
  }
}
