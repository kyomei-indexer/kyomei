import { describe, it, expect } from "vitest";
import { defineConfig } from "./loader.ts";

describe("defineConfig", () => {
  it("should return the config as-is", () => {
    const config = {
      database: {
        connectionString: "postgresql://localhost/db",
        schemaVersion: "v1",
      },
      chains: {
        mainnet: {
          id: 1,
          source: { type: "hypersync" as const },
        },
      },
      contracts: {},
    };

    const result = defineConfig(config);
    expect(result).toEqual(config);
  });

  it("should preserve literal types", () => {
    const TestAbi = [
      {
        type: "event" as const,
        name: "Transfer",
        inputs: [
          { type: "address", name: "from", indexed: true },
          { type: "address", name: "to", indexed: true },
        ],
      },
    ] as const;

    const config = defineConfig({
      database: {
        connectionString: "postgresql://localhost/db",
        schemaVersion: "v1",
      },
      chains: {},
      contracts: {
        Token: {
          abi: TestAbi,
          chain: "mainnet",
          address: "0x1234567890123456789012345678901234567890",
        },
      },
    });

    expect(config.contracts.Token.abi).toBe(TestAbi);
  });
});
