# Kyomei - EVM Indexer Architecture

A high-performance, fault-tolerant EVM blockchain indexer built with Domain-Driven Design principles.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Packages](#packages)
- [Data Flow](#data-flow)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Features](#features)
- [Deployment Models](#deployment-models)
- [API Reference](#api-reference)

---

## Overview

Kyomei is a two-phase blockchain indexing system inspired by [Ponder](https://ponder.sh), designed for:

- **Correctness**: Deterministic replay with cached RPC responses
- **Scalability**: Horizontal scaling with PostgreSQL job coordination
- **Flexibility**: Support for multiple data sources (RPC, eRPC, HyperSync, QuickNode Streams)
- **Developer Experience**: Ponder-compatible handler API and GraphQL

### Key Design Decisions

| Decision                     | Rationale                                                         |
| ---------------------------- | ----------------------------------------------------------------- |
| Two-phase (Syncer/Processor) | Decouples ingestion from business logic for independent scaling   |
| PostgreSQL as coordinator    | Single source of truth, ACID guarantees, no external dependencies |
| TimescaleDB for events       | Time-series optimized storage with compression and retention      |
| Block-range job model        | Efficient batching while maintaining ordering guarantees          |
| Cached RPC responses         | Enables deterministic replay during reindexing                    |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────┤
│    RPC      │    eRPC     │  HyperSync  │  QuickNode  │   Other         │
│  (viem)     │   (proxy)   │   (Envio)   │   Streams   │   Sources       │
└──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴────────┬────────┘
       │             │             │             │               │
       └─────────────┴─────────────┴─────────────┴───────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │         CORE LAYER          │
                    │  • Block/Log/Transaction    │
                    │  • IRpcClient, IBlockSource │
                    │  • ABI Parser, Event Decoder│
                    │  • Multi-level Logger       │
                    └──────────────┬──────────────┘
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       │                           │                           │
┌──────▼──────┐           ┌────────▼────────┐          ┌───────▼───────┐
│   SYNCER    │           │    PROCESSOR    │          │     CRON      │
│             │           │                 │          │               │
│ • Chain     │           │ • Handler       │          │ • Block-based │
│   Syncer    │──────────▶│   Executor      │          │ • Time-based  │
│ • Factory   │   Events  │ • Ponder        │          │ • Price       │
│   Watcher   │           │   Compat        │          │   Fetcher     │
│ • View      │           │ • Cached RPC    │          │               │
│   Creator   │           │   Context       │          │               │
└──────┬──────┘           └────────┬────────┘          └───────┬───────┘
       │                           │                           │
       └───────────────────────────┼───────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       DATABASE LAYER        │
                    │  • Drizzle ORM              │
                    │  • TimescaleDB Hypertables  │
                    │  • Schema Manager           │
                    │  • Repositories             │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │         PostgreSQL          │
                    │    + TimescaleDB Extension  │
                    │                             │
                    │  ┌─────────────────────┐    │
                    │  │   kyomei_sync       │    │
                    │  │   (raw events)      │    │
                    │  └─────────────────────┘    │
                    │  ┌─────────────────────┐    │
                    │  │   kyomei_app_v1     │    │
                    │  │   (app data)        │    │
                    │  └─────────────────────┘    │
                    │  ┌─────────────────────┐    │
                    │  │   kyomei_crons_v1   │    │
                    │  │   (cron data)       │    │
                    │  └─────────────────────┘    │
                    └─────────────────────────────┘
```

---

## Packages

### Monorepo Structure

```
kyomei/
├── packages/
│   ├── config/        # Configuration types and loader
│   ├── core/          # Domain entities, ports, and infrastructure
│   ├── database/      # Drizzle schemas, repositories, TimescaleDB
│   ├── syncer/        # Block ingestion and factory watching
│   ├── processor/     # Event handler execution
│   ├── cron/          # Scheduled job execution
│   ├── api/           # GraphQL API server
│   ├── runner/        # Service orchestration
│   ├── cli/           # Command-line interface
│   └── testing/       # Test utilities and mocks
├── apps/
│   └── example/       # Uniswap V2 example implementation
└── docker/            # Docker Compose for development
```

### Package Details

#### `@kyomei/config`

- Zod-validated configuration schemas
- Chain, contract, cron, and backup configuration
- Default values and environment variable support
- Handler and context type definitions

#### `@kyomei/core`

- **Domain Layer**: Block, Log, Transaction entities
- **Application Layer**: Ports (IRpcClient, IBlockSource, ILogger)
- **Infrastructure Layer**: RPC clients, block sources, logger implementation
- Services: ABI Parser, Event Decoder, Cached RPC Client

#### `@kyomei/database`

- Drizzle ORM schemas for all tables
- Repository implementations
- Schema Manager with versioning and migrations
- TimescaleDB utilities (hypertables, compression, aggregates)
- Backup service with S3 support

#### `@kyomei/syncer`

- ChainSyncer: Block-by-block synchronization
- FactoryWatcher: Dynamic contract discovery
- ViewCreator: Generate processor views from sync tables

#### `@kyomei/processor`

- **Kyomei**: Type-safe event handler registration with `kyomei.on()` and `kyomei.onParallel()`
- **HandlerExecutor**: Execute user-defined handlers with sequential/parallel modes
- **PonderCompat**: Ponder-compatible `ponder.on()` API
- Cached RPC context for deterministic replay

#### `@kyomei/cron`

- CronScheduler: Block-based and time-based scheduling
- Flexible schema targeting (chain or dedicated crons schema)

#### `@kyomei/api`

- Ponder-compatible GraphQL API
- Auto-generated schema from database tables
- Pagination, filtering, and custom resolvers

#### `@kyomei/runner`

- ServiceRunner: Orchestrates all services
- Supports all-in-one or distributed deployment

#### `@kyomei/cli`

- Commands: init, dev, start, migrate, backup, restore

---

## Data Flow

### Phase 1: Syncing (Ingestion)

```
Block Source ──▶ ChainSyncer ──▶ EventRepository ──▶ kyomei_sync.raw_events
                     │
                     ▼
              FactoryWatcher ──▶ kyomei_sync.factory_children
```

1. Block source fetches finalized blocks with logs
2. ChainSyncer filters logs for configured contracts
3. Events stored in `raw_events` TimescaleDB hypertable
4. FactoryWatcher detects child contracts from factory events
5. Checkpoint updated in `sync_checkpoints`

### Phase 2: Processing (Handlers)

```
kyomei_sync.raw_events ──▶ HandlerExecutor ──▶ User Handlers ──▶ kyomei_app_v1.*
                               │
                               ▼
                         Cached RPC Client ──▶ kyomei_sync.rpc_cache
```

1. HandlerExecutor reads events from sync schema
2. Events decoded using registered ABIs
3. User handlers executed with context (db, rpc, event)
4. RPC calls cached for deterministic replay
5. Handler results written to app schema

### Cron Jobs

```
CronScheduler ──▶ Cron Handlers ──▶ kyomei_crons_v1.* or kyomei_app_v1.*
                       │
                       ▼
                  RPC Client (for price feeds, etc.)
```

---

## Database Schema

### Schema Versioning

Schemas include version suffix for safe migrations:

- `kyomei_sync` - Raw sync data (no versioning, append-only)
- `kyomei_app_v1` - Application data (versioned)
- `kyomei_crons_v1` - Cron job data (versioned)
- `kyomei_meta` - Schema version tracking

### Core Tables

#### `kyomei_sync.raw_events` (TimescaleDB Hypertable)

```sql
CREATE TABLE kyomei_sync.raw_events (
  chain_id        INTEGER NOT NULL,
  block_number    BIGINT NOT NULL,
  block_hash      VARCHAR(66) NOT NULL,
  block_timestamp BIGINT NOT NULL,
  tx_hash         VARCHAR(66) NOT NULL,
  tx_index        INTEGER NOT NULL,
  log_index       INTEGER NOT NULL,
  address         VARCHAR(42) NOT NULL,
  topic0          VARCHAR(66),
  topic1          VARCHAR(66),
  topic2          VARCHAR(66),
  topic3          VARCHAR(66),
  data            TEXT NOT NULL,
  PRIMARY KEY (chain_id, block_number, tx_index, log_index)
);

-- Hypertable configuration
SELECT create_hypertable('raw_events', 'block_number',
  chunk_time_interval => 100000,
  if_not_exists => TRUE
);
```

#### `kyomei_sync.rpc_cache`

```sql
CREATE TABLE kyomei_sync.rpc_cache (
  chain_id      INTEGER NOT NULL,
  block_number  BIGINT NOT NULL,
  method        VARCHAR(100) NOT NULL,
  request_hash  VARCHAR(64) NOT NULL,
  params        TEXT NOT NULL,
  response      TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chain_id, block_number, request_hash)
);
```

#### `kyomei_sync.factory_children`

```sql
CREATE TABLE kyomei_sync.factory_children (
  chain_id           INTEGER NOT NULL,
  factory_address    VARCHAR(42) NOT NULL,
  child_address      VARCHAR(42) NOT NULL,
  contract_name      VARCHAR(255) NOT NULL,
  created_at_block   BIGINT NOT NULL,
  created_at_tx_hash VARCHAR(66) NOT NULL,
  metadata           TEXT,
  PRIMARY KEY (chain_id, child_address)
);
```

### Application Schema Example

```typescript
// schema.ts
export function createAppSchema(version: string) {
  const appSchema = pgSchema(`kyomei_app_${version}`);

  const pairs = appSchema.table("pairs", {
    address: varchar("address", { length: 42 }).primaryKey(),
    token0: varchar("token0", { length: 42 }).notNull(),
    token1: varchar("token1", { length: 42 }).notNull(),
    reserve0: numeric("reserve0").default("0"),
    reserve1: numeric("reserve1").default("0"),
    createdAtBlock: bigint("created_at_block", { mode: "bigint" }),
  });

  return { pairs };
}
```

---

## Configuration

### `kyomei.config.ts`

```typescript
import { defineConfig, factory } from "@kyomei/config";
import { UniswapV2Factory, UniswapV2Pair } from "./abis";

export default defineConfig({
  database: {
    connectionString: process.env.DATABASE_URL,
    schemaVersion: "v1",
  },

  chains: {
    mainnet: {
      id: 1,
      source: {
        type: "hypersync", // or "rpc", "erpc"
        url: "https://eth.hypersync.xyz",
      },
      pollingInterval: 2000,
      // Parallel historical sync configuration
      sync: {
        parallelWorkers: 4, // Concurrent sync workers
        blockRangePerRequest: 10000, // Blocks per HyperSync request
        blocksPerWorker: 250000, // Blocks per worker chunk
      },
    },
  },

  contracts: {
    UniswapV2Factory: {
      chain: "mainnet",
      abi: UniswapV2Factory,
      address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
      startBlock: 10000835n,
    },
    UniswapV2Pair: {
      chain: "mainnet",
      abi: UniswapV2Pair,
      address: factory({
        contract: "UniswapV2Factory",
        event: "PairCreated",
        parameter: "pair",
      }),
    },
  },

  crons: {
    priceFetcher: {
      chain: "mainnet",
      trigger: { type: "time", cron: "*/5 * * * *" },
      handler: "./src/crons/priceFetcher.js",
    },
  },

  backup: {
    enabled: true,
    schedule: "0 0 * * *",
    s3: {
      bucket: "kyomei-backups",
      region: "us-east-1",
    },
  },
});
```

---

## Features

### Type-Safe Event Handlers (Kyomei API)

Define contracts once and share them between config and handler registration:

```typescript
// kyomei.config.ts
import { defineConfig, factory } from "@kyomei/config";
import { createKyomei } from "@kyomei/processor";
import { FactoryAbi, PairAbi } from "./src/abis";

// Define contracts once - used by both config and Kyomei
const UniswapV2Factory = {
  abi: FactoryAbi,
  chain: "ethereum",
  address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
  startBlock: 10000835,
} as const;

const UniswapV2Pair = {
  abi: PairAbi,
  chain: "ethereum",
  address: factory({ ... }),
  startBlock: 10000835,
} as const;

// Config uses the contract objects directly
export default defineConfig({
  contracts: { UniswapV2Factory, UniswapV2Pair },
  // ... other config
});

// Kyomei instance uses the same ABIs - no duplication
export const kyomei = createKyomei({
  UniswapV2Factory: { abi: UniswapV2Factory.abi },
  UniswapV2Pair: { abi: UniswapV2Pair.abi },
});
```

```typescript
// src/handlers/Factory.ts
import { kyomei } from "../kyomei.config.ts";

// Full type inference for event.args from ABI
kyomei.on("UniswapV2Factory:PairCreated", async ({ event, context }) => {
  // event.args.token0, event.args.token1, event.args.pair are typed!
  await context.db.insert("pairs").values({
    address: event.args.pair,
    token0: event.args.token0,
    token1: event.args.token1,
  });
});
```

### Multi-Level Logging

```bash
kyomei dev          # Default (info level)
kyomei dev -v       # Error only
kyomei dev -vv      # Warnings
kyomei dev -vvv     # Info
kyomei dev -vvvv    # Debug
kyomei dev -vvvvv   # Trace
```

### Factory Contract Detection

```typescript
// Automatically tracks child contracts created by factory
address: factory({
  contract: "UniswapV2Factory",
  event: "PairCreated",
  parameter: "pair",
});
```

### Cached RPC for Deterministic Replay

```typescript
// In handlers, RPC calls are cached per block
const balance = await context.rpc.getBalance(address);
// Same call during reindex returns cached response
```

### Parallel Historical Sync

For faster historical data indexing, Kyomei supports parallel sync workers that split the block range into chunks:

```typescript
// kyomei.config.ts
chains: {
  mainnet: {
    id: 1,
    source: {
      type: 'hypersync', // or 'rpc', 'erpc'
      url: 'https://eth.hypersync.xyz',
    },
    sync: {
      // Number of parallel workers for historical sync (default: 1)
      parallelWorkers: 4,
      // Block range per request (default: 1000 for RPC, 10000 for HyperSync)
      blockRangePerRequest: 10000,
      // Total blocks per worker before rotating (default: 100000)
      blocksPerWorker: 100000,
    },
  },
},
```

**How it works:**

1. The syncer calculates the total block range: `startBlock` → `currentBlock`
2. Divides the range into chunks based on `blocksPerWorker`
3. Spins up `parallelWorkers` concurrent sync tasks
4. Each worker processes its assigned chunk independently
5. Checkpoints are updated atomically per-chunk
6. Once historical sync completes, switches to single-worker live mode

**Example: Syncing 10M blocks with 4 workers**

```
Worker 1: blocks 0 - 2,499,999
Worker 2: blocks 2,500,000 - 4,999,999
Worker 3: blocks 5,000,000 - 7,499,999
Worker 4: blocks 7,500,000 - 9,999,999

Each worker requests data in batches of `blockRangePerRequest` blocks
```

### Configurable Block Ranges

Different data sources have different optimal block ranges:

| Source    | Default Range | Recommended Range |
| --------- | ------------- | ----------------- |
| RPC       | 1,000         | 500 - 2,000       |
| eRPC      | 1,000         | 1,000 - 5,000     |
| HyperSync | 10,000        | 10,000 - 100,000  |

```typescript
// Contract-level override
contracts: {
  UniswapV2Pair: {
    chain: 'mainnet',
    abi: UniswapV2Pair,
    address: factory({ ... }),
    startBlock: 10000835,
    // Override block range for this specific contract
    maxBlockRange: 500, // Lower for high-volume contracts
  },
},
```

### TimescaleDB Integration

```typescript
import {
  createHypertable,
  enableCompression,
} from "@kyomei/database/timescale";

// Create hypertable for time-series data
await createHypertable(db, schema, "token_prices", "fetched_at", {
  chunkTimeInterval: "1 day",
});

// Enable compression
await enableCompression(
  db,
  schema,
  "token_prices",
  ["token_address"],
  ["fetched_at DESC"],
  { compressAfter: "7 days" }
);
```

### Ponder-Compatible API

```typescript
// Handler signature matches Ponder
kyomei.on("UniswapV2Pair:Swap", async ({ event, context }) => {
  const { args, block, transaction, log } = event;

  await context.db.insert("swaps").values({
    pair: log.address,
    amount0In: args.amount0In,
    // ...
  });
});
```

### Parallel Handler Execution

Kyomei supports both sequential and parallel handler execution modes for optimized throughput:

```typescript
import { kyomei } from "./kyomei.config.ts";

// Sequential (default) - runs one at a time, in order
// Use for handlers that update shared state or have dependencies
kyomei.on("UniswapV2Pair:Sync", async ({ event, context }) => {
  await context.db
    .update("pairs")
    .set({
      reserve0: event.args.reserve0.toString(),
      reserve1: event.args.reserve1.toString(),
    })
    .where({ address: event.log.address });
});

// Parallel - can run concurrently with other parallel handlers
// Use for independent insert operations
kyomei.onParallel("UniswapV2Pair:Swap", async ({ event, context }) => {
  await context.db.insert("swaps").values({
    id: `${event.transaction.hash}-${event.log.index}`,
    pair_address: event.log.address,
    // ...
  });
});
```

**When to use each mode:**

| Use `on` (sequential)     | Use `onParallel`     |
| ------------------------- | -------------------- |
| Updates shared state      | Independent inserts  |
| Depends on other handlers | Read-only operations |
| Requires strict ordering  | No dependencies      |
| Modifies data others read | Isolated writes      |

**Benefits of parallel execution:**

- Higher throughput for independent operations
- Better CPU utilization during processing
- Reduced overall indexing time

---

## Deployment Models

### All-in-One

```bash
kyomei start
# Runs: syncer + processor + crons + api
```

### Distributed

```bash
# Service 1: Syncer only
kyomei start --syncer

# Service 2: Processor only
kyomei start --processor

# Service 3: API only
kyomei start --api

# Service 4: Crons only
kyomei start --crons
```

### Docker Compose

```yaml
services:
  syncer:
    image: kyomei
    command: kyomei start --syncer

  processor:
    image: kyomei
    command: kyomei start --processor
    depends_on: [syncer]

  api:
    image: kyomei
    command: kyomei start --api
    ports: ["42069:42069"]
```

---

## API Reference

### GraphQL Endpoints

```graphql
# Auto-generated from database schema
type Query {
  pair(id: ID!): Pair
  pairs(first: Int, skip: Int, orderBy: String): PairConnection
  swap(id: ID!): Swap
  swaps(first: Int, skip: Int, where: SwapFilter): SwapConnection
}

# Custom resolvers
type Query {
  tokenPrices: [TokenPrice!]!
  priceChart(tokenAddress: String!, interval: String!): PriceChart!
}
```

### REST Endpoints

```
GET /health          # Health check
GET /status          # Indexer status
GET /graphql         # GraphiQL playground
POST /graphql        # GraphQL queries
```

---

## CLI Commands

```bash
# Initialize new project
kyomei init my-indexer

# Development with hot reload
kyomei dev

# Production start
kyomei start

# Run migrations
kyomei migrate

# Database backup
kyomei backup --create
kyomei backup --list
kyomei backup --download <filename>
kyomei backup --restore <filename>
```

---

## Roadmap

- [x] Core infrastructure (RPC, block sources, logging)
- [x] Database layer (Drizzle, TimescaleDB, repositories)
- [x] Syncer with factory detection
- [x] Processor with cached RPC context
- [x] Cron scheduler (block & time-based)
- [x] GraphQL API with auto-generation
- [x] CLI with all commands
- [x] Backup/restore system
- [x] Schema versioning and migrations
- [x] HyperSync integration
- [x] Parallel historical sync with configurable block ranges
- [x] Parallel handler execution (`on` / `onParallel`)
- [ ] QuickNode Streams webhook receiver
- [ ] Full test suite
- [ ] Documentation site

---

# Extra notes

- The comunication between the sync and the processor for tracking new events and live mode need to be using queues github.com/citusdata/pg_cron using ddd as a arquitecture of events.

- The views on the kyomei*app since they are the raw events need to start always by event*

- Improve log system

- Schema version - appended to app/crons schema names \* e.g., kyomei_app_v1, kyomei_crons_v1

## License

MIT
