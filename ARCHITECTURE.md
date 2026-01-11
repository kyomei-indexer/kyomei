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
│             │  NOTIFY/  │                 │          │               │
│ • Chain     │  LISTEN   │ • Handler       │          │ • Block-based │
│   Syncer    │──────────▶│   Executor      │          │ • Time-based  │
│ • Factory   │ (PG Evt)  │ • Kyomei API    │          │ • Price       │
│   Watcher   │           │ • Cached RPC    │          │   Fetcher     │
│ • View      │           │   Context       │          │               │
│   Creator   │           │                 │          │               │
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
│   ├── events/        # Event-driven communication (LISTEN/NOTIFY)
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
- Repository implementations (Event, SyncWorker, ProcessWorker, Factory, RpcCache)
- Schema Manager with versioning and migrations
- TimescaleDB utilities (hypertables, compression, aggregates)
- Backup service with S3 support

#### `@kyomei/events`

- **EventNotifier**: Publish sync events via PostgreSQL NOTIFY
- **EventListener**: Subscribe to sync events via PostgreSQL LISTEN
- Event types: `block_range_synced`, `live_block_synced`, `factory_child_discovered`
- Enables sub-100ms latency between syncer and processor

#### `@kyomei/syncer`

- **ChainSyncer**: Parallel block synchronization with event buffering
- **FactoryWatcher**: Dynamic child contract discovery with multiple parameter support
- **ViewCreator**: Generate `event_*` views from sync tables
- Integrated EventNotifier for real-time processor notifications

#### `@kyomei/processor`

- **Kyomei**: Type-safe event handler registration with `kyomei.on()` and `kyomei.onParallel()`
- **HandlerExecutor**: Execute user-defined handlers with sequential/parallel modes
- Cached RPC context for deterministic replay
- Integrated EventListener for event-driven processing
- **Note:** PonderCompat API has been removed - use Kyomei API instead

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

  // Performance tuning (optional)
  performance: {
    connectionPoolSize: 100,      // DB connection pool (default: 100)
    parallelWorkers: 4,            // Sync workers (default: 4)
    eventBufferSize: 10000,        // Cross-block batching (default: 10000)
    processorBatchSize: 1000,      // Events per batch (default: 1000)
    processorConcurrency: 50,      // Parallel handlers (default: 50)
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
        parallelWorkers: 4,          // Concurrent sync workers (default: 4)
        blockRangePerRequest: 10000, // Blocks per HyperSync request
        blocksPerWorker: 250000,     // Blocks per worker chunk (default: 250k)
        eventBatchSize: 10000,       // Event insert batch size (default: 10k)
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
      // NEW: Direct factory configuration with event and parameter
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
        parameter: "pair", // Can be string or string[] for multiple
        // Optional: custom ABI for children
        // childAbi: CustomPairAbi,
        // Optional: custom contract name for children
        // childContractName: "UniswapV2Pair",
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

### Performance Configuration

Kyomei provides comprehensive performance tuning options for different deployment scenarios:

```typescript
export default defineConfig({
  // Global performance settings (optional - defaults shown)
  performance: {
    // Database
    connectionPoolSize: 100,        // Total DB connections (workers + handlers + buffer)
    insertBatchSize: 10000,         // Max events per insert batch

    // Sync
    parallelWorkers: 4,             // Historical sync worker concurrency
    eventBufferSize: 10000,         // Events buffered before flush
    checkpointInterval: 100,        // Blocks between checkpoints

    // Processor
    processorBatchSize: 1000,       // Events per processing batch
    processorConcurrency: 50,       // Max parallel handler executions

    // RPC (when using RPC client in handlers)
    rpcConcurrency: 100,            // Max concurrent RPC calls
    rpcBatchSize: 100,              // Calls batched per round-trip
  },

  // Per-chain overrides
  chains: {
    mainnet: {
      sync: {
        parallelWorkers: 8,         // Override for specific chain
        eventBatchSize: 20000,      // Larger batches for high-throughput chains
      },
    },
  },
});
```

**Tuning Guidelines:**

| Scenario | Workers | Buffer | Pool | Concurrency |
|----------|---------|--------|------|-------------|
| **Small project** | 2 | 5k | 50 | 25 |
| **Default (recommended)** | 4 | 10k | 100 | 50 |
| **High throughput** | 8 | 20k | 150 | 100 |
| **Low memory** | 1 | 2k | 30 | 10 |

**Connection Pool Formula:**
```
poolSize = parallelWorkers + processorConcurrency + 40 (buffer)
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

Kyomei automatically tracks child contracts created by factory patterns with full configurability:

```typescript
// Basic factory tracking - single child parameter
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
  parameter: "pair", // Extract address from event.args.pair
})

// Multiple child parameters - extract multiple addresses from one event
address: factory({
  address: "0xPoolFactory...",
  event: PoolCreatedEvent,
  parameter: ["pool", "gauge"], // Extract both pool and gauge addresses
})

// Custom child ABI - use different ABI for children than factory
address: factory({
  address: "0xTokenFactory...",
  event: TokenCreatedEvent,
  parameter: "token",
  childAbi: CustomTokenAbi, // Children use this ABI instead of factory's
  childContractName: "CustomToken", // Override contract name for children
})

// Array parameter support - extract all addresses from array
address: factory({
  address: "0xMultiFactory...",
  event: BatchCreatedEvent,
  parameter: "tokens", // If event.args.tokens is address[]
})
```

**How it works:**

1. **Phase 1 - Historical Discovery:** Scans entire block range for factory events before regular sync
2. **Live Discovery:** Continuously monitors new blocks for factory events in real-time
3. **Child Storage:** Discovered addresses stored in `factory_children` table with metadata
4. **Automatic Sync:** Child contracts automatically included in event sync filters
5. **Event-Driven:** New discoveries trigger immediate processor notification (sub-100ms latency)

**Database Schema:**
```sql
CREATE TABLE factory_children (
  chain_id INTEGER,
  factory_address TEXT,
  child_address TEXT,
  contract_name TEXT,
  created_at_block BIGINT,
  created_at_tx_hash TEXT,
  created_at_log_index INTEGER,
  metadata TEXT,              -- Full decoded event args as JSON
  child_abi TEXT,             -- Optional custom ABI for child
  created_at TIMESTAMPTZ,
  PRIMARY KEY (chain_id, child_address)
);
```

### Event-Driven Sync-to-Processor Communication

Kyomei uses PostgreSQL LISTEN/NOTIFY for real-time event-driven communication between syncer and processor, achieving sub-100ms latency in live mode:

```typescript
// @kyomei/events package
import { EventNotifier, EventListener } from '@kyomei/events';

// Syncer notifies when new events are synced
const notifier = new EventNotifier(sql);
await notifier.notify('sync_events', {
  type: 'block_range_synced',
  chainId: 1,
  blockNumber: 18000000n,
  timestamp: new Date(),
});

// Processor listens and wakes immediately
const listener = new EventListener(sql);
await listener.listen('sync_events', (event) => {
  if (event.chainId === chainId) {
    // Process new events immediately
  }
});
```

**Benefits:**
- **Low Latency:** Sub-100ms notification delivery (vs 1-5s polling)
- **No External Dependencies:** Uses PostgreSQL's built-in NOTIFY/LISTEN
- **Distributed Ready:** Works across multiple processor instances
- **Event Types:**
  - `block_range_synced` - Historical sync progress
  - `live_block_synced` - New block in live mode
  - `factory_child_discovered` - New factory child found

**Architecture:**
```
Syncer Process                     Processor Process
     │                                    │
     ├─ Sync Block Range                 │
     ├─ Insert Events                    │
     ├─ NOTIFY 'sync_events' ────────────▶ LISTEN 'sync_events'
     │                                    ├─ Wake Signal
     │                                    ├─ Query New Events
     │                                    └─ Execute Handlers
```

**Fallback:** 5-second polling timeout ensures processing continues even without notifications.

### Cached RPC for Deterministic Replay

```typescript
// In handlers, RPC calls are cached per block
const balance = await context.rpc.getBalance(address);
// Same call during reindex returns cached response
```

### Parallel Historical Sync with Cross-Block Batching

For maximum performance during historical data indexing, Kyomei uses parallel sync workers with intelligent event buffering:

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
      // Number of parallel workers for historical sync (default: 4)
      parallelWorkers: 4,
      // Block range per request (default: 1000 for RPC, 10000 for HyperSync)
      blockRangePerRequest: 10000,
      // Total blocks per worker before rotating (default: 250000)
      blocksPerWorker: 250000,
      // Events buffered across blocks before insert (default: 10000)
      eventBatchSize: 10000,
    },
  },
},
```

**Performance Optimizations:**

1. **Parallel Workers (4x):** 4 workers process blocks concurrently
2. **Cross-Block Batching (10-50x):** Events buffered across multiple blocks, then inserted in single transaction
3. **Large Connection Pool (10x):** 100 connections (vs 10) supports workers + handlers
4. **Optimized Defaults:** Tuned for modern hardware and database capabilities

**How it works:**

1. The syncer calculates the total block range: `startBlock` → `currentBlock`
2. Divides the range into chunks based on `blocksPerWorker`
3. Spins up `parallelWorkers` concurrent sync tasks
4. Each worker:
   - Fetches blocks in batches of `blockRangePerRequest`
   - Buffers events across blocks until reaching `eventBatchSize`
   - Inserts entire buffer in single transaction
   - Updates checkpoint atomically
5. Once historical sync completes, switches to single-worker live mode

**Example: Syncing 10M blocks with 4 workers**

```
Worker 1: blocks 0 - 2,499,999
Worker 2: blocks 2,500,000 - 4,999,999
Worker 3: blocks 5,000,000 - 7,499,999
Worker 4: blocks 7,500,000 - 9,999,999

Each worker:
- Requests 10k blocks at a time from HyperSync
- Buffers up to 10k events across blocks
- Single transaction per 10k events (vs per-block inserts)
```

**Expected Performance:**
- **Historical Sync:** 40-400x faster than v1 (combination of parallelism + batching + pooling)
- **Database Throughput:** 10-50x fewer round-trips due to cross-block batching
- **Connection Saturation:** Eliminated with 100-connection pool

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

### Completed ✅

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
- [x] **Performance optimizations (v2.0):**
  - [x] Connection pool scaling (10 → 100 connections)
  - [x] Parallel workers by default (1 → 4 workers)
  - [x] Cross-block event batching (10k buffer)
  - [x] Configurable performance settings
  - [x] Database index optimization
- [x] **Factory tracking enhancements:**
  - [x] Multiple parameter support (extract multiple addresses)
  - [x] Custom child ABI support
  - [x] Array parameter support
  - [x] Custom child contract names
- [x] **Event-driven architecture:**
  - [x] PostgreSQL LISTEN/NOTIFY communication
  - [x] Sub-100ms processor latency
  - [x] @kyomei/events package
- [x] **View naming convention:** All event views prefixed with `event_*`
- [x] **Code cleanup:** Removed PonderCompat, deprecated old checkpoint repositories

### In Progress 🚧

- [ ] Full test suite
- [ ] Documentation site
- [ ] Performance monitoring and metrics

### Future Considerations 💭

- [ ] QuickNode Streams webhook receiver
- [ ] Multi-chain coordination improvements
- [ ] Advanced caching strategies

## License

MIT
