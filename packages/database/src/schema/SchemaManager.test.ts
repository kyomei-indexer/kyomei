import { describe, it, expect, vi, beforeEach } from "vitest";
import { SchemaManager } from "./SchemaManager.ts";

describe("SchemaManager", () => {
  const mockDb = {
    execute: vi.fn(),
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

  const schemaConfig = {
    syncSchema: "kyomei_sync",
    appSchema: "kyomei_app",
    cronsSchema: "kyomei_crons",
    schemaVersion: "v1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue([]);
  });

  describe("constructor", () => {
    it("should create instance with config", () => {
      const manager = new SchemaManager(
        mockDb as any,
        schemaConfig,
        mockLogger as any
      );

      expect(manager).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("should accept schema config", () => {
      const customConfig = {
        syncSchema: "custom_sync",
        appSchema: "custom_app",
        cronsSchema: "custom_crons",
        schemaVersion: "v2",
      };

      const manager = new SchemaManager(
        mockDb as any,
        customConfig,
        mockLogger as any
      );

      expect(manager).toBeDefined();
    });
  });
});
