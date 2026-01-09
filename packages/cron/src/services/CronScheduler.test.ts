import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronScheduler } from "./CronScheduler.ts";
import type { CronConfig } from "@kyomei/config";

describe("CronScheduler", () => {
  const mockDb = {
    execute: vi.fn(),
  };

  const mockRpcClient = {
    chainId: 1,
    url: "https://eth.rpc.example.com",
    getBlockNumber: vi.fn(),
    getFinalizedBlockNumber: vi.fn(),
    getBlock: vi.fn(),
    getBlockByHash: vi.fn(),
    getLogs: vi.fn(),
    getTransaction: vi.fn(),
    getTransactionReceipt: vi.fn(),
    getBalance: vi.fn(),
    readContract: vi.fn(),
    call: vi.fn(),
    batch: vi.fn(),
    isHealthy: vi.fn(),
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

  const cronConfigs: CronConfig[] = [
    {
      name: "price-fetcher",
      chain: "mainnet",
      trigger: {
        type: "time",
        cron: "*/5 * * * *",
      },
      handler: "./crons/priceFetcher.js",
      schema: { type: "dedicated" },
      enabled: true,
    },
    {
      name: "block-snapshots",
      chain: "mainnet",
      trigger: {
        type: "block",
        interval: 100,
      },
      handler: "./crons/blockSnapshots.js",
      schema: { type: "chain", chain: "mainnet" },
      enabled: true,
    },
  ];

  const schemaConfig = {
    syncSchema: "kyomei_sync",
    appSchema: "kyomei_app",
    cronsSchema: "kyomei_crons",
    schemaVersion: "v1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockRpcClient.getBlockNumber.mockResolvedValue(10000n);
    mockRpcClient.getBlock.mockResolvedValue({
      number: 10000n,
      hash: "0x1234",
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should create instance with cron configs", () => {
      const scheduler = new CronScheduler({
        cronConfigs,
        schemaConfig,
        db: mockDb as any,
        rpcClients: new Map([["mainnet", mockRpcClient as any]]),
        logger: mockLogger as any,
      });

      expect(scheduler).toBeDefined();
    });
  });

  describe("stop", () => {
    it("should stop the scheduler", async () => {
      const scheduler = new CronScheduler({
        cronConfigs,
        schemaConfig,
        db: mockDb as any,
        rpcClients: new Map([["mainnet", mockRpcClient as any]]),
        logger: mockLogger as any,
      });

      await scheduler.stop();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("configuration", () => {
    it("should accept time-based cron config", () => {
      const timeConfig: CronConfig[] = [
        {
          name: "test",
          chain: "mainnet",
          trigger: { type: "time", cron: "*/5 * * * *" },
          handler: "./test.js",
        },
      ];

      const scheduler = new CronScheduler({
        cronConfigs: timeConfig,
        schemaConfig,
        db: mockDb as any,
        rpcClients: new Map([["mainnet", mockRpcClient as any]]),
        logger: mockLogger as any,
      });

      expect(scheduler).toBeDefined();
    });

    it("should accept block-based cron config", () => {
      const blockConfig: CronConfig[] = [
        {
          name: "test",
          chain: "mainnet",
          trigger: { type: "block", interval: 100 },
          handler: "./test.js",
        },
      ];

      const scheduler = new CronScheduler({
        cronConfigs: blockConfig,
        schemaConfig,
        db: mockDb as any,
        rpcClients: new Map([["mainnet", mockRpcClient as any]]),
        logger: mockLogger as any,
      });

      expect(scheduler).toBeDefined();
    });

    it("should accept empty cron configs", () => {
      const scheduler = new CronScheduler({
        cronConfigs: [],
        schemaConfig,
        db: mockDb as any,
        rpcClients: new Map(),
        logger: mockLogger as any,
      });

      expect(scheduler).toBeDefined();
    });
  });
});
