# Kyomei

A high-performance EVM blockchain indexer with pluggable data sources, built with Domain-Driven Design principles.

## Features

- **Two-Phase Architecture**: Syncer (ingestion) + Processor (handlers) for scalability
- **Multiple Data Sources**: RPC, eRPC, HyperSync, QuickNode Streams
- **Factory Pattern Support**: Automatically track child contracts (like Uniswap pairs)
- **Ponder-Compatible API**: Easy migration from Ponder indexers
- **Cached RPC Calls**: Deterministic replay with persistent response caching
- **TimescaleDB**: Optimized time-series storage with automatic compression
- **Flexible Deployment**: Run all services together or separately
- **Cron Jobs**: Block-based and time-based scheduled tasks
- **S3 Backups**: Automated backup and restore functionality

## Quick Start

```bash
# Install dependencies
pnpm install

# Start database
pnpm db:up

# Run migrations
pnpm --filter @kyomei/example migrate

# Start development server
pnpm --filter @kyomei/example dev
```

## Project Structure

```
kyomei/
├── packages/
│   ├── config/      # Configuration types and loading
│   ├── core/        # Domain entities, ports, and services
│   ├── database/    # Drizzle schemas, repositories, migrations
│   ├── syncer/      # Block ingestion and factory watching
│   ├── processor/   # Handler execution with cached RPC
│   ├── cron/        # Block-based and time-based cron jobs
│   ├── api/         # GraphQL API server
│   ├── runner/      # Service orchestration
│   ├── cli/         # Command-line interface
│   └── testing/     # Test utilities and mocks
├── apps/
│   └── example/     # Uniswap V2 example indexer
└── docker/          # Docker Compose configurations
```

## Configuration

Create a `kyomei.config.ts` file:

```typescript
import { defineConfig, factory } from '@kyomei/config';

export default defineConfig({
  database: {
    connectionString: 'postgresql://...',
  },
  chains: {
    ethereum: {
      id: 1,
      source: {
        type: 'erpc',
        url: 'http://localhost:4000',
        finality: 'finalized',
      },
    },
  },
  contracts: {
    MyFactory: {
      abi: FactoryAbi,
      chain: 'ethereum',
      address: '0x...',
      startBlock: 10000000,
    },
    MyChild: {
      abi: ChildAbi,
      chain: 'ethereum',
      address: factory({
        address: '0x...',
        event: PairCreatedEvent,
        parameter: 'child',
      }),
      startBlock: 10000000,
    },
  },
});
```

## Handlers

Kyomei uses a Ponder-compatible handler API:

```typescript
import type { EventHandler } from '@kyomei/config';

export const handleSwap: EventHandler<SwapEvent> = async (context) => {
  const { event, block, db, rpc } = context;

  // Cached RPC call (responses stored in DB)
  const reserves = await rpc.readContract({
    address: context.log.address,
    abi: PairAbi,
    functionName: 'getReserves',
  });

  // Database operations
  await db.insert('swaps').values({
    pair: context.log.address,
    amount0: event.amount0In,
    blockNumber: block.number,
  });
};
```

## CLI Commands

```bash
# Development with hot reload
kyomei dev -vvvv

# Production
kyomei start

# Database migrations
kyomei migrate --status
kyomei migrate --up
kyomei migrate --down

# Backups
kyomei backup --create
kyomei backup --list
kyomei backup --restore backup.sql.gz
```

## Running Services Separately

```bash
# Run only syncer
kyomei start --syncer

# Run only processor
kyomei start --processor

# Run only API
kyomei start --api

# Run only crons
kyomei start --crons
```

## eRPC Integration

Kyomei integrates with [eRPC](https://github.com/erpc/erpc) for:
- Automatic failover between RPC endpoints
- Request caching with reorg awareness
- Rate limiting and circuit breakers

## Docker Compose

```bash
# Start all services
docker-compose -f docker/docker-compose.yml up -d

# This starts:
# - TimescaleDB (port 5432)
# - LocalStack S3 (port 4566)
# - eRPC proxy (port 4000)
```

## License

MIT
