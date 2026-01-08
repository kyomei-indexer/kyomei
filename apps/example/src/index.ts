/**
 * Kyomei Example - Uniswap V2 Indexer
 *
 * This example demonstrates:
 * - Factory pattern for dynamic contract tracking
 * - Event handlers with Ponder-compatible API
 * - Cached RPC calls for contract reads
 * - Block-based and time-based cron jobs
 * - Database operations within handlers
 * - Custom GraphQL API with analytics queries
 * - Price fetching cron (every 5 minutes)
 *
 * Run with:
 *   pnpm dev    # Development mode with hot reload
 *   pnpm start  # Production mode
 *
 * GraphQL Playground:
 *   http://localhost:42069/graphql
 *
 * Example queries:
 *   - tokenPrices: Get current token prices
 *   - topPairs(limit: 10): Get top pairs by volume
 *   - priceChart(tokenAddress: "0x..."): Get price history
 *   - globalStats: Protocol-wide statistics
 */

// Handlers
export * from "./handlers/index.js";

// ABIs
export * from "./abis/index.js";

// API extensions
export { customSchema, customResolvers } from "./api/schema.js";

// Crons
export * from "./crons/index.js";
