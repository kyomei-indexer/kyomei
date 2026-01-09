import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChainSyncer } from "./ChainSyncer.ts";
import type { ChainConfig } from "@kyomei/config";

describe("ChainSyncer", () => {
  const mockBlockSource = {
    sourceType: "rpc" as const,
    providesValidatedData: false,
    chainId: 1,
    getBlocks: vi.fn(),
    getLatestBlockNumber: vi.fn(),
    getFinalizedBlockNumber: vi.fn(),
    onBlock: vi.fn(),
    getBlocksByNumbers: vi.fn(),
    isHealthy: vi.fn(),
    close: vi.fn(),
  };

  const mockEventRepo = {
    save: vi.fn(),
    saveBatch: vi.fn(),
    get: vi.fn(),
    getRange: vi.fn(),
    getByBlock: vi.fn(),
    getByTransaction: vi.fn(),
    count: vi.fn(),
    deleteRange: vi.fn(),
  };

  const mockCheckpointRepo = {
    get: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(),
  };

  const mockLogger = {
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

  const chainConfig: ChainConfig = {
    id: 1,
    source: {
      type: "hypersync",
      url: "https://eth.hypersync.xyz",
    },
    pollingInterval: 12000,
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
    mockBlockSource.getLatestBlockNumber.mockResolvedValue(10000n);
    mockBlockSource.getFinalizedBlockNumber.mockResolvedValue(9990n);
    mockCheckpointRepo.get.mockResolvedValue(null);
  });

  describe("constructor", () => {
    it("should create instance with config", () => {
      const syncer = new ChainSyncer({
        chainName: "mainnet",
        chainConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        checkpointRepository: mockCheckpointRepo as any,
        logger: mockLogger as any,
      });

      expect(syncer).toBeDefined();
    });
  });

  describe("stop", () => {
    it("should stop the syncer", async () => {
      const syncer = new ChainSyncer({
        chainName: "mainnet",
        chainConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        checkpointRepository: mockCheckpointRepo as any,
        logger: mockLogger as any,
      });

      await syncer.stop();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("configuration", () => {
    it("should accept minimal config", () => {
      const minimalConfig: ChainConfig = {
        id: 1,
        source: { type: "hypersync" },
      };

      const syncer = new ChainSyncer({
        chainName: "mainnet",
        chainConfig: minimalConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        checkpointRepository: mockCheckpointRepo as any,
        logger: mockLogger as any,
      });

      expect(syncer).toBeDefined();
    });

    it("should accept full sync config", () => {
      const fullConfig: ChainConfig = {
        id: 1,
        source: { type: "hypersync" },
        sync: {
          parallelWorkers: 4,
          blockRangePerRequest: 2000,
          blocksPerWorker: 250000,
          eventBatchSize: 1000,
        },
      };

      const syncer = new ChainSyncer({
        chainName: "mainnet",
        chainConfig: fullConfig,
        contracts,
        blockSource: mockBlockSource as any,
        eventRepository: mockEventRepo as any,
        checkpointRepository: mockCheckpointRepo as any,
        logger: mockLogger as any,
      });

      expect(syncer).toBeDefined();
    });
  });
});
