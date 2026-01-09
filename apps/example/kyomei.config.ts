import { defineConfig, factory } from "@kyomei/config";
import { createKyomei } from "@kyomei/processor";
import { UniswapV2FactoryAbi, UniswapV2PairAbi } from "./src/abis/index.ts";

/**
 * Contract ABIs with full type information for event inference.
 * Used by both the config and the Kyomei handler registration.
 */
const UniswapV2Factory = {
  abi: UniswapV2FactoryAbi,
  chain: "ethereum",
  address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
  startBlock: 23199095,
} as const;

const UniswapV2Pair = {
  abi: UniswapV2PairAbi,
  chain: "ethereum",
  address: factory({
    address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    event: {
      type: "event",
      name: "PairCreated",
      inputs: [
        { type: "address", name: "token0", indexed: true },
        { type: "address", name: "token1", indexed: true },
        { type: "address", name: "pair", indexed: false },
        { type: "uint256", name: "pairIndex", indexed: false },
      ],
    },
    parameter: "pair",
  }),
  startBlock: 23199095,
} as const;

/**
 * Kyomei Configuration
 */
export default defineConfig({
  database: {
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://kyomei:kyomei@localhost:5432/kyomei",
    syncSchema: "kyomei_sync",
    appSchema: "kyomei_app",
    cronsSchema: "kyomei_crons",
    poolSize: 10,
    /**
     * Schema version - appended to app/crons schema names
     * e.g., kyomei_app_v1, kyomei_crons_v1
     *
     * When you change your schema.ts, increment this version.
     * Kyomei will run migrations to create/update the new schema.
     */
    schemaVersion: "v1",
  },

  chains: {
    ethereum: {
      id: 1,
      source: {
        type: "hypersync",
        url: process.env.HYPERSYNC_URL ?? "https://eth.hypersync.xyz",
        apiToken:
          process.env.HYPERSYNC_API_TOKEN ??
          "b54b47fd-5cd0-46b4-beb2-40ea2849f8ac",
        fallbackRpc: process.env.FALLBACK_RPC_URL ?? "https://eth.llamarpc.com",
      },
      pollingInterval: 12000,
      /**
       * Sync configuration for parallel historical indexing
       * Splits the block range into chunks and processes them concurrently
       *
       */
      sync: {
        parallelWorkers: 1,
        blockRangePerRequest: 250000,
        blocksPerWorker: 2500000,
        eventBatchSize: 100000,
      },
    },
  },

  contracts: {
    UniswapV2Factory,
    UniswapV2Pair,
  },

  crons: [
    {
      name: "hourly-stats",
      chain: "ethereum",
      trigger: {
        type: "time",
        cron: "0 * * * *",
      },
      handler: "./src/crons/hourlyStats.js",
      schema: { type: "dedicated" },
    },
    {
      name: "block-snapshots",
      chain: "ethereum",
      trigger: {
        type: "block",
        interval: 100,
      },
      handler: "./src/crons/blockSnapshots.js",
      schema: { type: "chain", chain: "ethereum" },
    },
    {
      name: "price-fetcher",
      chain: "ethereum",
      trigger: {
        type: "time",
        cron: "*/5 * * * *",
      },
      handler: "./src/crons/priceFetcher.js",
      schema: { type: "dedicated" },
      enabled: true,
    },
  ],

  backup: {
    storage: {
      endpoint: process.env.S3_ENDPOINT ?? "http://localhost:4566",
      bucket: "kyomei-backups",
      region: "us-east-1",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
      forcePathStyle: true,
    },
    schemas: ["kyomei_sync", "kyomei_app_v1", "kyomei_crons_v1"],
    schedule: {
      enabled: true,
      cron: "0 0 * * *",
      retentionDays: 7,
    },
  },

  logging: {
    level: "info",
    timestamps: true,
    progress: true,
  },

  api: {
    port: 42069,
    host: "0.0.0.0",
    graphql: {
      enabled: true,
      path: "/graphql",
    },
  },
});

/**
 * Kyomei instance for type-safe handler registration.
 *
 * Uses the same ABIs as the config above - no duplication.
 *
 * Import this in handlers:
 *   import { kyomei } from "../../kyomei.config.ts";
 *   kyomei.on("UniswapV2Factory:PairCreated", handler);
 */
export const kyomei = createKyomei({
  UniswapV2Factory: { abi: UniswapV2Factory.abi },
  UniswapV2Pair: { abi: UniswapV2Pair.abi },
});
