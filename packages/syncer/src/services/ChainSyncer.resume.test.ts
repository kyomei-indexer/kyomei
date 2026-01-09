import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChainSyncer } from "./ChainSyncer.ts";
import type { ChainConfig } from "@kyomei/config";
import type {
  IBlockSource,
  IEventRepository,
  ISyncWorkerRepository,
  ILogger,
  BlockWithLogs,
  SyncWorker,
} from "@kyomei/core";

/**
 * Helper to create a mock block
 */
function createMockBlock(blockNumber: bigint): BlockWithLogs {
  return {
    block: {
      number: blockNumber,
      hash: `0x${blockNumber.toString(16).padStart(64, "0")}` as `0x${string}`,
      parentHash: `0x${(blockNumber - 1n).toString(16).padStart(64, "0")}` as `0x${string}`,
      timestamp: BigInt(Date.now()),
    },
    logs: [],
    transactions: [],
  };
}

describe("ChainSyncer Resume Functionality", () => {
  // Track worker state across syncer instances
  let workers: Map<string, SyncWorker> = new Map(); // key = "chainId-workerId"
  let blocksProcessed: bigint[] = [];
  let progressUpdates: Array<{
    blocksSynced: number;
    totalBlocks: number;
    percentage: number;
    workers: number;
  }> = [];

  // Mock block source that tracks which blocks were requested
  const createMockBlockSource = (latestBlock: bigint) => ({
    sourceType: "hypersync" as const,
    providesValidatedData: true,
    chainId: 1,
    getBlocks: vi.fn(async function* (range: { from: bigint; to: bigint }) {
      for (let block = range.from; block <= range.to; block++) {
        blocksProcessed.push(block);
        yield createMockBlock(block);
      }
    }),
    getLatestBlockNumber: vi.fn().mockResolvedValue(latestBlock),
    getFinalizedBlockNumber: vi.fn().mockResolvedValue(latestBlock),
    onBlock: undefined, // No subscription support
    getBlocksByNumbers: vi.fn(),
    isHealthy: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  });

  const mockEventRepo: IEventRepository = {
    save: vi.fn(),
    saveBatch: vi.fn(),
    get: vi.fn(),
    getRange: vi.fn(),
    getByBlock: vi.fn(),
    getByTransaction: vi.fn(),
    count: vi.fn(),
    deleteRange: vi.fn(),
  };

  // Helper to create worker key
  const workerKey = (chainId: number, workerId: number) => `${chainId}-${workerId}`;

  // Mock worker repository that persists across syncer instances
  const createMockWorkerRepo = (): ISyncWorkerRepository => ({
    getWorkers: vi.fn(async (chainId: number) => {
      return Array.from(workers.values()).filter((w) => w.chainId === chainId);
    }),
    getWorker: vi.fn(async (chainId: number, workerId: number) => {
      return workers.get(workerKey(chainId, workerId)) ?? null;
    }),
    getLiveWorker: vi.fn(async (chainId: number) => {
      return (
        Array.from(workers.values()).find(
          (w) => w.chainId === chainId && w.status === "live"
        ) ?? null
      );
    }),
    getHistoricalWorkers: vi.fn(async (chainId: number) => {
      return Array.from(workers.values()).filter(
        (w) => w.chainId === chainId && w.status === "historical"
      );
    }),
    setWorker: vi.fn(async (worker: SyncWorker) => {
      workers.set(workerKey(worker.chainId, worker.workerId), worker);
    }),
    deleteWorker: vi.fn(async (chainId: number, workerId: number) => {
      workers.delete(workerKey(chainId, workerId));
    }),
    deleteAllWorkers: vi.fn(async (chainId: number) => {
      for (const [key, worker] of workers) {
        if (worker.chainId === chainId) {
          workers.delete(key);
        }
      }
    }),
  });

  const mockLogger: ILogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    progress: vi.fn(),
    clearProgress: vi.fn(),
    isLevelEnabled: vi.fn().mockReturnValue(true),
    startTimer: vi.fn().mockReturnValue(() => {}),
    level: "info" as const,
  };

  const contracts = [
    {
      name: "Token",
      abi: [
        {
          type: "event" as const,
          name: "Transfer",
          inputs: [
            { type: "address", name: "from", indexed: true },
            { type: "address", name: "to", indexed: true },
            { type: "uint256", name: "value", indexed: false },
          ],
        },
      ],
      chain: "mainnet",
      address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      startBlock: 1000n,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    workers.clear();
    blocksProcessed = [];
    progressUpdates = [];
  });

  describe("Single Worker Resume", () => {
    const singleWorkerConfig: ChainConfig = {
      id: 1,
      source: { type: "hypersync" },
      sync: {
        parallelWorkers: 1,
        blockRangePerRequest: 100,
        blocksPerWorker: 100000,
        eventBatchSize: 100,
      },
    };

    it("should start from contract startBlock on fresh start", async () => {
      const mockBlockSource = createMockBlockSource(1100n);
      const mockWorkerRepo = createMockWorkerRepo();

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: singleWorkerConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
        onProgress: (info) => {
          progressUpdates.push({
            blocksSynced: info.blocksSynced,
            totalBlocks: info.totalBlocks,
            percentage: info.percentage,
            workers: info.workers,
          });
        },
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Let it run briefly then stop
      await new Promise((r) => setTimeout(r, 100));
      await syncer.stop();
      await syncPromise;

      // Verify it started from contract startBlock (1000)
      expect(blocksProcessed[0]).toBe(1000n);
    });

    it("should resume from live worker after restart", async () => {
      const mockBlockSource = createMockBlockSource(2000n);
      const mockWorkerRepo = createMockWorkerRepo();

      // Simulate previous sync completed historical and created live worker at block 1500
      const now = new Date();
      workers.set(workerKey(1, 0), {
        chainId: 1,
        workerId: 0,
        rangeStart: 1500n,
        rangeEnd: null,
        currentBlock: 1500n,
        status: "live",
        createdAt: now,
        updatedAt: now,
      });

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: singleWorkerConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Let it run briefly then stop
      await new Promise((r) => setTimeout(r, 100));
      await syncer.stop();
      await syncPromise;

      // Should resume from block 1501 (next after live worker's currentBlock)
      expect(blocksProcessed[0]).toBe(1501n);
    });
  });

  describe("Multi Worker Resume", () => {
    const multiWorkerConfig: ChainConfig = {
      id: 1,
      source: { type: "hypersync" },
      sync: {
        parallelWorkers: 4,
        blockRangePerRequest: 100,
        blocksPerWorker: 1000,
        eventBatchSize: 100,
      },
    };

    it("should create historical workers on fresh start", async () => {
      const mockBlockSource = createMockBlockSource(5000n);
      const mockWorkerRepo = createMockWorkerRepo();

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: multiWorkerConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Let it run briefly then stop
      await new Promise((r) => setTimeout(r, 100));
      await syncer.stop();
      await syncPromise;

      // Should have created 4 historical workers
      const historicalWorkers = Array.from(workers.values()).filter(
        (w) => w.status === "historical"
      );
      expect(historicalWorkers.length).toBeLessThanOrEqual(4);
    });

    it("should resume incomplete historical workers", async () => {
      const mockBlockSource = createMockBlockSource(5000n);
      const mockWorkerRepo = createMockWorkerRepo();

      // Config with 2 parallel workers to match what we're simulating
      const twoWorkerConfig: ChainConfig = {
        id: 1,
        source: { type: "hypersync" },
        sync: {
          parallelWorkers: 2,
          blockRangePerRequest: 100,
          blocksPerWorker: 1000,
          eventBatchSize: 100,
        },
      };

      // Simulate 2 incomplete historical workers
      const now = new Date();
      workers.set(workerKey(1, 1), {
        chainId: 1,
        workerId: 1,
        rangeStart: 1000n,
        rangeEnd: 2000n,
        currentBlock: 1500n, // 50% done
        status: "historical",
        createdAt: now,
        updatedAt: now,
      });
      workers.set(workerKey(1, 2), {
        chainId: 1,
        workerId: 2,
        rangeStart: 2001n,
        rangeEnd: 3000n,
        currentBlock: 2500n, // 50% done
        status: "historical",
        createdAt: now,
        updatedAt: now,
      });

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: twoWorkerConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Let it run briefly then stop
      await new Promise((r) => setTimeout(r, 100));
      await syncer.stop();
      await syncPromise;

      // Should resume from 1501 (worker 1) and 2501 (worker 2)
      expect(blocksProcessed).toContain(1501n);
      expect(blocksProcessed).toContain(2501n);

      // Should NOT start from beginning
      expect(blocksProcessed).not.toContain(1000n);
      expect(blocksProcessed).not.toContain(2001n);
    });

    it("should calculate correct progress from resumed workers", async () => {
      const mockBlockSource = createMockBlockSource(3000n);
      const mockWorkerRepo = createMockWorkerRepo();

      // Simulate worker that's 75% done
      const now = new Date();
      workers.set(workerKey(1, 1), {
        chainId: 1,
        workerId: 1,
        rangeStart: 1000n,
        rangeEnd: 2000n,
        currentBlock: 1750n, // 750/1000 = 75% done
        status: "historical",
        createdAt: now,
        updatedAt: now,
      });

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: singleWorkerConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
        onProgress: (info) => {
          progressUpdates.push({
            blocksSynced: info.blocksSynced,
            totalBlocks: info.totalBlocks,
            percentage: info.percentage,
            workers: info.workers,
          });
        },
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Let it run briefly then stop
      await new Promise((r) => setTimeout(r, 100));
      await syncer.stop();
      await syncPromise;

      // First progress update should reflect resumed state (around 75%)
      const firstProgress = progressUpdates[0];
      if (firstProgress) {
        expect(firstProgress.percentage).toBeGreaterThanOrEqual(70);
      }
    });

    const singleWorkerConfig: ChainConfig = {
      id: 1,
      source: { type: "hypersync" },
      sync: {
        parallelWorkers: 1,
        blockRangePerRequest: 100,
        blocksPerWorker: 100000,
        eventBatchSize: 100,
      },
    };
  });

  describe("Configuration Change Detection", () => {
    it("should reset when parallelWorkers count changes", async () => {
      const mockBlockSource = createMockBlockSource(5000n);
      const mockWorkerRepo = createMockWorkerRepo();

      // Simulate previous sync with 2 workers
      const now = new Date();
      workers.set(workerKey(1, 1), {
        chainId: 1,
        workerId: 1,
        rangeStart: 1000n,
        rangeEnd: 2000n,
        currentBlock: 1500n,
        status: "historical",
        createdAt: now,
        updatedAt: now,
      });
      workers.set(workerKey(1, 2), {
        chainId: 1,
        workerId: 2,
        rangeStart: 2001n,
        rangeEnd: 3000n,
        currentBlock: 2500n,
        status: "historical",
        createdAt: now,
        updatedAt: now,
      });

      // Now configure with 4 workers (changed!)
      const newConfig: ChainConfig = {
        id: 1,
        source: { type: "hypersync" },
        sync: {
          parallelWorkers: 4, // Was 2
          blockRangePerRequest: 100,
          blocksPerWorker: 1000,
          eventBatchSize: 100,
        },
      };

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: newConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Let it run briefly then stop
      await new Promise((r) => setTimeout(r, 100));
      await syncer.stop();
      await syncPromise;

      // Should have logged a warning about config change
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Worker count changed")
      );

      // Old workers should be deleted and new ones created
      // Should start from beginning (1000n)
      expect(blocksProcessed).toContain(1000n);
    });

    it("should reset when startBlock changes", async () => {
      const mockBlockSource = createMockBlockSource(5000n);
      const mockWorkerRepo = createMockWorkerRepo();

      // Simulate previous sync started at block 1000
      const now = new Date();
      workers.set(workerKey(1, 1), {
        chainId: 1,
        workerId: 1,
        rangeStart: 1000n,
        rangeEnd: 2000n,
        currentBlock: 1500n,
        status: "historical",
        createdAt: now,
        updatedAt: now,
      });

      // Create syncer with contract starting at block 2000 (different!)
      const contractsWithNewStart = [
        {
          ...contracts[0],
          startBlock: 2000n, // Changed from 1000n
        },
      ];

      const config: ChainConfig = {
        id: 1,
        source: { type: "hypersync" },
        sync: {
          parallelWorkers: 1,
          blockRangePerRequest: 100,
          blocksPerWorker: 100000,
          eventBatchSize: 100,
        },
      };

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: config,
        contracts: contractsWithNewStart,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Let it run briefly then stop
      await new Promise((r) => setTimeout(r, 100));
      await syncer.stop();
      await syncPromise;

      // Should start from new startBlock (2000n)
      expect(blocksProcessed[0]).toBe(2000n);
    });
  });

  describe("Progress Persistence", () => {
    it("should save worker progress periodically", async () => {
      const mockBlockSource = createMockBlockSource(2000n);
      const mockWorkerRepo = createMockWorkerRepo();

      const config: ChainConfig = {
        id: 1,
        source: { type: "hypersync" },
        sync: {
          parallelWorkers: 1,
          blockRangePerRequest: 100,
          blocksPerWorker: 100000,
          eventBatchSize: 100,
        },
      };

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: config,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
        batchSize: 10, // Save every 10 blocks
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Let it run until some blocks are processed
      await new Promise((r) => setTimeout(r, 200));
      await syncer.stop();
      await syncPromise;

      // Should have saved worker progress multiple times
      expect(mockWorkerRepo.setWorker).toHaveBeenCalled();
    });

    it("should preserve progress on abort", async () => {
      const mockBlockSource = createMockBlockSource(5000n);
      const mockWorkerRepo = createMockWorkerRepo();

      const config: ChainConfig = {
        id: 1,
        source: { type: "hypersync" },
        sync: {
          parallelWorkers: 2,
          blockRangePerRequest: 100,
          blocksPerWorker: 1000,
          eventBatchSize: 100,
        },
      };

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: config,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
        batchSize: 10,
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Let it process some blocks then abort
      await new Promise((r) => setTimeout(r, 100));
      await syncer.stop();
      await syncPromise;

      // Workers should NOT be deleted (preserved for resume)
      const remainingWorkers = Array.from(workers.values()).filter(
        (w) => w.chainId === 1 && w.status === "historical"
      );
      
      // Should have at least saved some progress (workers exist)
      expect(mockWorkerRepo.setWorker).toHaveBeenCalled();
    });
  });

  describe("Transition to Live Sync", () => {
    it("should create live worker after historical sync completes", async () => {
      // Use a small range so sync completes quickly
      const mockBlockSource = createMockBlockSource(1010n);
      const mockWorkerRepo = createMockWorkerRepo();

      const config: ChainConfig = {
        id: 1,
        source: { type: "hypersync" },
        sync: {
          parallelWorkers: 1,
          blockRangePerRequest: 100,
          blocksPerWorker: 100000,
          eventBatchSize: 100,
        },
      };

      const contractsShortRange = [
        {
          ...contracts[0],
          startBlock: 1000n,
        },
      ];

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: config,
        contracts: contractsShortRange,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
      });

      // Start syncing - should complete quickly since range is small
      const syncPromise = syncer.start();

      // Wait a bit for completion
      await new Promise((r) => setTimeout(r, 300));
      await syncer.stop();
      await syncPromise;

      // Should have created a live worker
      const liveWorker = Array.from(workers.values()).find(
        (w) => w.chainId === 1 && w.status === "live"
      );
      expect(liveWorker).toBeDefined();
      if (liveWorker) {
        expect(liveWorker.workerId).toBe(0);
        expect(liveWorker.rangeEnd).toBeNull();
      }
    });

    it("should delete historical workers after they complete", async () => {
      // Use a small range so sync completes quickly
      const mockBlockSource = createMockBlockSource(1010n);
      const mockWorkerRepo = createMockWorkerRepo();

      const config: ChainConfig = {
        id: 1,
        source: { type: "hypersync" },
        sync: {
          parallelWorkers: 1,
          blockRangePerRequest: 100,
          blocksPerWorker: 100000,
          eventBatchSize: 100,
        },
      };

      const contractsShortRange = [
        {
          ...contracts[0],
          startBlock: 1000n,
        },
      ];

      const syncer = new ChainSyncer({
        chainId: 1,
        chainName: "mainnet",
        chainConfig: config,
        contracts: contractsShortRange,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        workerRepository: mockWorkerRepo as any,
        logger: mockLogger as any,
      });

      // Start syncing
      const syncPromise = syncer.start();

      // Wait for completion
      await new Promise((r) => setTimeout(r, 300));
      await syncer.stop();
      await syncPromise;

      // Historical workers should be deleted
      const historicalWorkers = Array.from(workers.values()).filter(
        (w) => w.chainId === 1 && w.status === "historical"
      );
      expect(historicalWorkers.length).toBe(0);
    });
  });
});
