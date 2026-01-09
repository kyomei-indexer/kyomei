import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiServer } from "./ApiServer.ts";
import type { ApiConfig } from "@kyomei/config";

describe("ApiServer", () => {
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

  const apiConfig: ApiConfig = {
    port: 42069,
    host: "0.0.0.0",
    graphql: {
      enabled: true,
      path: "/graphql",
    },
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
      const server = new ApiServer({
        apiConfig,
        schemaConfig,
        db: mockDb as any,
        logger: mockLogger as any,
      });

      expect(server).toBeDefined();
    });

    it("should use default config values", () => {
      const minimalConfig: ApiConfig = {};

      const server = new ApiServer({
        apiConfig: minimalConfig,
        schemaConfig,
        db: mockDb as any,
        logger: mockLogger as any,
      });

      expect(server).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("should accept custom port", () => {
      const customConfig: ApiConfig = {
        port: 3000,
      };

      const server = new ApiServer({
        apiConfig: customConfig,
        schemaConfig,
        db: mockDb as any,
        logger: mockLogger as any,
      });

      expect(server).toBeDefined();
    });

    it("should accept GraphQL config", () => {
      const graphqlConfig: ApiConfig = {
        graphql: {
          enabled: true,
          path: "/api/graphql",
        },
      };

      const server = new ApiServer({
        apiConfig: graphqlConfig,
        schemaConfig,
        db: mockDb as any,
        logger: mockLogger as any,
      });

      expect(server).toBeDefined();
    });
  });
});
