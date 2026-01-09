/**
 * Kyomei Example - Uniswap V2 Indexer
 *
 * This example demonstrates:
 * - Type-safe event handlers with kyomei.on() API
 * - Factory pattern for dynamic contract tracking
 * - Cached RPC calls for contract reads
 * - Block-based and time-based cron jobs
 * - Custom GraphQL API with analytics queries
 *
 * Run with:
 *   pnpm dev    # Development mode with hot reload
 *   pnpm start  # Production mode
 *
 * GraphQL Playground:
 *   http://localhost:42069/graphql
 */

// Import handlers (this registers all event handlers)
import "./handlers/index.ts";

// Re-export kyomei
import { kyomei } from "../kyomei.config.ts";
export { kyomei };

// Handler registrations are accessed via kyomei.getRegistrations()

// ABIs
export * from "./abis/index.ts";

// API extensions
export { customSchema, customResolvers } from "./api/schema.ts";

// Crons
export * from "./crons/index.ts";
