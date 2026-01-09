import { eq, and, sql } from 'drizzle-orm';
import type { Database } from '../connection.ts';
import { syncCheckpoints, workerCheckpoints, syncWorkers } from '../schemas/sync/index.ts';
import { processCheckpoints, processWorkers } from '../schemas/app/index.ts';
import type {
  // Sync worker types
  ISyncWorkerRepository,
  SyncWorker,
  SyncStatus,
  // Process worker types
  IProcessWorkerRepository,
  ProcessWorker,
  ProcessStatus,
  // Process checkpoints
  IProcessCheckpointRepository,
  ProcessCheckpoint,
  // Legacy types (deprecated)
  ISyncCheckpointRepository,
  SyncCheckpoint,
  WorkerCheckpoint,
} from '@kyomei/core';

/**
 * Sync worker repository implementation
 * Uses the unified sync_workers table
 */
export class SyncWorkerRepository implements ISyncWorkerRepository {
  constructor(private readonly db: Database) {}

  async getWorkers(chainId: number): Promise<SyncWorker[]> {
    const results = await this.db
      .select()
      .from(syncWorkers)
      .where(eq(syncWorkers.chainId, chainId));

    return results.map((row) => ({
      chainId: row.chainId,
      workerId: row.workerId,
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd,
      currentBlock: row.currentBlock,
      status: row.status as SyncStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async getWorker(chainId: number, workerId: number): Promise<SyncWorker | null> {
    const results = await this.db
      .select()
      .from(syncWorkers)
      .where(
        and(
          eq(syncWorkers.chainId, chainId),
          eq(syncWorkers.workerId, workerId)
        )
      )
      .limit(1);

    if (results.length === 0) return null;

    const row = results[0];
    return {
      chainId: row.chainId,
      workerId: row.workerId,
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd,
      currentBlock: row.currentBlock,
      status: row.status as SyncStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getLiveWorker(chainId: number): Promise<SyncWorker | null> {
    const results = await this.db
      .select()
      .from(syncWorkers)
      .where(
        and(
          eq(syncWorkers.chainId, chainId),
          eq(syncWorkers.status, 'live')
        )
      )
      .limit(1);

    if (results.length === 0) return null;

    const row = results[0];
    return {
      chainId: row.chainId,
      workerId: row.workerId,
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd,
      currentBlock: row.currentBlock,
      status: row.status as SyncStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getHistoricalWorkers(chainId: number): Promise<SyncWorker[]> {
    const results = await this.db
      .select()
      .from(syncWorkers)
      .where(
        and(
          eq(syncWorkers.chainId, chainId),
          eq(syncWorkers.status, 'historical')
        )
      );

    return results.map((row) => ({
      chainId: row.chainId,
      workerId: row.workerId,
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd,
      currentBlock: row.currentBlock,
      status: row.status as SyncStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async setWorker(worker: SyncWorker): Promise<void> {
    await this.db
      .insert(syncWorkers)
      .values({
        chainId: worker.chainId,
        workerId: worker.workerId,
        rangeStart: worker.rangeStart,
        rangeEnd: worker.rangeEnd,
        currentBlock: worker.currentBlock,
        status: worker.status,
        createdAt: worker.createdAt,
        updatedAt: worker.updatedAt,
      })
      .onConflictDoUpdate({
        target: [syncWorkers.chainId, syncWorkers.workerId],
        set: {
          rangeStart: worker.rangeStart,
          rangeEnd: worker.rangeEnd,
          currentBlock: worker.currentBlock,
          status: worker.status,
          updatedAt: worker.updatedAt,
        },
      });
  }

  async deleteWorker(chainId: number, workerId: number): Promise<void> {
    await this.db
      .delete(syncWorkers)
      .where(
        and(
          eq(syncWorkers.chainId, chainId),
          eq(syncWorkers.workerId, workerId)
        )
      );
  }

  async deleteAllWorkers(chainId: number): Promise<void> {
    await this.db
      .delete(syncWorkers)
      .where(eq(syncWorkers.chainId, chainId));
  }
}

/**
 * Process worker repository implementation
 * Tracks handler execution progress per chain
 */
export class ProcessWorkerRepository implements IProcessWorkerRepository {
  constructor(private readonly db: Database) {}

  async getWorker(chainId: number): Promise<ProcessWorker | null> {
    const results = await this.db
      .select()
      .from(processWorkers)
      .where(eq(processWorkers.chainId, chainId))
      .limit(1);

    if (results.length === 0) return null;

    const row = results[0];
    return {
      chainId: row.chainId,
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd,
      currentBlock: row.currentBlock,
      eventsProcessed: row.eventsProcessed,
      status: row.status as ProcessStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async setWorker(worker: ProcessWorker): Promise<void> {
    await this.db
      .insert(processWorkers)
      .values({
        chainId: worker.chainId,
        rangeStart: worker.rangeStart,
        rangeEnd: worker.rangeEnd,
        currentBlock: worker.currentBlock,
        eventsProcessed: worker.eventsProcessed,
        status: worker.status,
        createdAt: worker.createdAt,
        updatedAt: worker.updatedAt,
      })
      .onConflictDoUpdate({
        target: processWorkers.chainId,
        set: {
          rangeStart: worker.rangeStart,
          rangeEnd: worker.rangeEnd,
          currentBlock: worker.currentBlock,
          eventsProcessed: worker.eventsProcessed,
          status: worker.status,
          updatedAt: worker.updatedAt,
        },
      });
  }

  async deleteWorker(chainId: number): Promise<void> {
    await this.db
      .delete(processWorkers)
      .where(eq(processWorkers.chainId, chainId));
  }
}

/**
 * @deprecated Use SyncWorkerRepository instead
 * Sync checkpoint repository implementation (legacy)
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

  async getWorkerCheckpoints(chainId: number): Promise<WorkerCheckpoint[]> {
    const results = await this.db
      .select()
      .from(workerCheckpoints)
      .where(eq(workerCheckpoints.chainId, chainId));

    return results.map((row) => ({
      chainId: row.chainId,
      workerId: row.workerId,
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd,
      currentBlock: row.currentBlock,
      isComplete: row.isComplete === 1,
      updatedAt: row.updatedAt,
    }));
  }

  async setWorkerCheckpoint(checkpoint: WorkerCheckpoint): Promise<void> {
    await this.db
      .insert(workerCheckpoints)
      .values({
        chainId: checkpoint.chainId,
        workerId: checkpoint.workerId,
        rangeStart: checkpoint.rangeStart,
        rangeEnd: checkpoint.rangeEnd,
        currentBlock: checkpoint.currentBlock,
        isComplete: checkpoint.isComplete ? 1 : 0,
        updatedAt: checkpoint.updatedAt,
      })
      .onConflictDoUpdate({
        target: [workerCheckpoints.chainId, workerCheckpoints.workerId],
        set: {
          rangeStart: checkpoint.rangeStart,
          rangeEnd: checkpoint.rangeEnd,
          currentBlock: checkpoint.currentBlock,
          isComplete: checkpoint.isComplete ? 1 : 0,
          updatedAt: checkpoint.updatedAt,
        },
      });
  }

  async deleteWorkerCheckpoints(chainId: number): Promise<void> {
    await this.db
      .delete(workerCheckpoints)
      .where(eq(workerCheckpoints.chainId, chainId));
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
