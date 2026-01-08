import { defineConfig, factory } from "@kyomei/config";
import { UniswapV2FactoryAbi, UniswapV2PairAbi } from "./src/abis/index.js";

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
        type: 'erpc',
        url: process.env.ERPC_URL ?? 'http://localhost:4000',
        finality: 'finalized',
      },
      pollingInterval: 12000,
    },
  },

  contracts: {
    UniswapV2Factory: {
      abi: UniswapV2FactoryAbi,
      chain: 'ethereum',
      address: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
      startBlock: 10000835,
    },

    UniswapV2Pair: {
      abi: UniswapV2PairAbi,
      chain: 'ethereum',
      // Factory pattern - dynamically track pairs
      address: factory({
        address: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
        event: {
          type: 'event',
          name: 'PairCreated',
          inputs: [
            { type: 'address', name: 'token0', indexed: true },
            { type: 'address', name: 'token1', indexed: true },
            { type: 'address', name: 'pair', indexed: false },
            { type: 'uint256', name: '', indexed: false },
          ],
        },
        parameter: 'pair',
      }),
      startBlock: 10000835,
    },
  },

  crons: [
    {
      name: 'hourly-stats',
      chain: 'ethereum',
      trigger: {
        type: 'time',
        cron: '0 * * * *', // Every hour
      },
      handler: './src/crons/hourlyStats.js',
      schema: { type: 'dedicated' },
    },
    {
      name: 'block-snapshots',
      chain: 'ethereum',
      trigger: {
        type: 'block',
        interval: 100, // Every 100 blocks
      },
      handler: './src/crons/blockSnapshots.js',
      schema: { type: 'chain', chain: 'ethereum' },
    },
    {
      name: 'price-fetcher',
      chain: 'ethereum',
      trigger: {
        type: 'time',
        cron: '*/5 * * * *', // Every 5 minutes
      },
      handler: './src/crons/priceFetcher.js',
      schema: { type: 'dedicated' },
      enabled: true,
    },
  ],

  backup: {
    storage: {
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:4566',
      bucket: 'kyomei-backups',
      region: 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      forcePathStyle: true,
    },
    schemas: ["kyomei_sync", "kyomei_app_v1", "kyomei_crons_v1"],
    schedule: {
      enabled: true,
      cron: '0 0 * * *', // Daily at midnight
      retentionDays: 7,
    },
  },

  logging: {
    level: 'info',
    timestamps: true,
    progress: true,
  },

  api: {
    port: 42069,
    host: '0.0.0.0',
    graphql: {
      enabled: true,
      path: '/graphql',
    },
  },
});
