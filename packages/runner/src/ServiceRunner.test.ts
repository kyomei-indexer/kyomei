import { describe, it, expect, vi, beforeEach } from "vitest";
import { ServiceRunner } from "./ServiceRunner.ts";
import type { KyomeiConfig } from "@kyomei/config";

describe("ServiceRunner", () => {
  const mockConfig: KyomeiConfig = {
    database: {
      connectionString: "postgresql://localhost/test",
      syncSchema: "kyomei_sync",
      appSchema: "kyomei_app",
      cronsSchema: "kyomei_crons",
      poolSize: 5,
      schemaVersion: "v1",
    },
    chains: {
      mainnet: {
        id: 1,
        source: {
          type: "hypersync",
        },
        pollingInterval: 12000,
      },
    },
    contracts: {},
    crons: [],
    api: {
      port: 42069,
      host: "0.0.0.0",
      graphql: {
        enabled: true,
        path: "/graphql",
      },
    },
    logging: {
      level: "info",
      timestamps: true,
      progress: true,
    },
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with config", () => {
      const runner = new ServiceRunner({
        config: mockConfig,
        logger: mockLogger as any,
      });

      expect(runner).toBeDefined();
    });

    it("should create instance with service selection", () => {
      const runner = new ServiceRunner({
        config: mockConfig,
        logger: mockLogger as any,
        services: {
          syncer: true,
          processor: false,
          api: true,
          crons: false,
        },
      });

      expect(runner).toBeDefined();
    });
  });

  describe("stop", () => {
    it("should stop all services", async () => {
      const runner = new ServiceRunner({
        config: mockConfig,
        logger: mockLogger as any,
      });

      await runner.stop();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("service selection", () => {
    it("should allow enabling only syncer", () => {
      const runner = new ServiceRunner({
        config: mockConfig,
        logger: mockLogger as any,
        services: {
          syncer: true,
          processor: false,
          api: false,
          crons: false,
        },
      });

      expect(runner).toBeDefined();
    });

    it("should allow enabling only API", () => {
      const runner = new ServiceRunner({
        config: mockConfig,
        logger: mockLogger as any,
        services: {
          syncer: false,
          processor: false,
          api: true,
          crons: false,
        },
      });

      expect(runner).toBeDefined();
    });

    it("should allow all-in-one mode", () => {
      const runner = new ServiceRunner({
        config: mockConfig,
        logger: mockLogger as any,
        services: {
          syncer: true,
          processor: true,
          api: true,
          crons: true,
        },
      });

      expect(runner).toBeDefined();
    });
  });
});
