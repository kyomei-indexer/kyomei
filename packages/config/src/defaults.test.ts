import { describe, it, expect } from "vitest";
import {
  DEFAULT_DATABASE_CONFIG,
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_API_CONFIG,
  DEFAULT_SYNC_CONFIG,
  DEFAULT_BLOCK_RANGES,
} from "./defaults.ts";

describe("DEFAULT_DATABASE_CONFIG", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_DATABASE_CONFIG.connectionString).toBe(
      "postgresql://kyomei:kyomei@localhost:5432/kyomei"
    );
    expect(DEFAULT_DATABASE_CONFIG.syncSchema).toBe("kyomei_sync");
    expect(DEFAULT_DATABASE_CONFIG.appSchema).toBe("kyomei_app");
    expect(DEFAULT_DATABASE_CONFIG.cronsSchema).toBe("kyomei_crons");
    expect(DEFAULT_DATABASE_CONFIG.poolSize).toBe(10);
    expect(DEFAULT_DATABASE_CONFIG.schemaVersion).toBe("v1");
  });
});

describe("DEFAULT_LOGGING_CONFIG", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_LOGGING_CONFIG.level).toBe("info");
    expect(DEFAULT_LOGGING_CONFIG.timestamps).toBe(true);
    expect(DEFAULT_LOGGING_CONFIG.progress).toBe(true);
  });
});

describe("DEFAULT_API_CONFIG", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_API_CONFIG.port).toBe(42069);
    expect(DEFAULT_API_CONFIG.host).toBe("0.0.0.0");
    expect(DEFAULT_API_CONFIG.graphql.enabled).toBe(true);
    expect(DEFAULT_API_CONFIG.graphql.path).toBe("/graphql");
  });
});

describe("DEFAULT_SYNC_CONFIG", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_SYNC_CONFIG.parallelWorkers).toBe(1);
    expect(DEFAULT_SYNC_CONFIG.blockRangePerRequest).toBe(1000);
    expect(DEFAULT_SYNC_CONFIG.blocksPerWorker).toBe(100000);
    expect(DEFAULT_SYNC_CONFIG.eventBatchSize).toBe(1000);
  });
});

describe("DEFAULT_BLOCK_RANGES", () => {
  it("should have different defaults per source type", () => {
    expect(DEFAULT_BLOCK_RANGES.rpc).toBe(1000);
    expect(DEFAULT_BLOCK_RANGES.erpc).toBe(2000);
    expect(DEFAULT_BLOCK_RANGES.hypersync).toBe(10000);
    expect(DEFAULT_BLOCK_RANGES.stream).toBe(1);
  });
});
