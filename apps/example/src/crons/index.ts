/**
 * Cron jobs for Uniswap V2 indexer example
 *
 * Available crons:
 * - hourlyStats: Aggregates swap data every hour
 * - blockSnapshots: Takes block snapshots every 100 blocks
 * - priceFetcher: Fetches token prices every 5 minutes from CoinGecko
 */

export { hourlyStats } from './hourlyStats.js';
export { blockSnapshots } from './blockSnapshots.js';
export { priceFetcher } from './priceFetcher.js';
