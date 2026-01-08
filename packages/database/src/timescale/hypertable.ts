import type { Database } from "../connection.js";
import { sql } from "drizzle-orm";

/**
 * TimescaleDB utilities for hypertable management
 */

// ============================================================================
// Result Types
// ============================================================================

/**
 * Hypertable statistics
 */
export interface HypertableStats {
  totalChunks: number;
  totalSize: string;
  compressedChunks: number;
  uncompressedSize: string;
  compressedSize: string;
}

/**
 * Time bucket result row
 */
export interface TimeBucketRow<T extends Record<string, unknown>> {
  bucket: Date;
  data: T;
}

/**
 * Hypertable query count result
 */
interface CountResult {
  count: string | number;
}

/**
 * Chunk info result
 */
interface ChunkStatsRow {
  total_chunks: string | number;
  total_size: string;
  compressed_chunks: string | number;
  uncompressed_size: string;
  compressed_size: string;
}

// ============================================================================
// Hypertable Creation
// ============================================================================

/**
 * Create a hypertable from an existing table
 * TimescaleDB automatically partitions by time
 */
export async function createHypertable(
  db: Database,
  schema: string,
  table: string,
  timeColumn: string,
  options?: {
    chunkTimeInterval?: string;
    ifNotExists?: boolean;
    partitioningColumn?: string;
    numberOfPartitions?: number;
  }
): Promise<void> {
  const fullTableName = `${schema}.${table}`;
  const ifNotExists = options?.ifNotExists ? "if_not_exists => TRUE," : "";
  const chunkInterval = options?.chunkTimeInterval ?? "7 days";

  // Build space partitioning if specified
  let spacePartitioning = "";
  if (options?.partitioningColumn && options?.numberOfPartitions) {
    spacePartitioning = `, partitioning_column => '${options.partitioningColumn}', number_partitions => ${options.numberOfPartitions}`;
  }

  await db.execute(
    sql.raw(`
    SELECT create_hypertable(
      '${fullTableName}',
      '${timeColumn}',
      ${ifNotExists}
      chunk_time_interval => INTERVAL '${chunkInterval}'
      ${spacePartitioning}
    );
  `)
  );
}

/**
 * Enable compression on a hypertable
 */
export async function enableCompression(
  db: Database,
  schema: string,
  table: string,
  segmentBy: string[],
  orderBy: string[],
  options?: {
    compressAfter?: string;
  }
): Promise<void> {
  const fullTableName = `${schema}.${table}`;
  const segmentByStr = segmentBy.join(", ");
  const orderByStr = orderBy.join(", ");
  const compressAfter = options?.compressAfter ?? "7 days";

  // Enable compression
  await db.execute(
    sql.raw(`
    ALTER TABLE ${fullTableName} SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = '${segmentByStr}',
      timescaledb.compress_orderby = '${orderByStr}'
    );
  `)
  );

  // Add compression policy
  await db.execute(
    sql.raw(`
    SELECT add_compression_policy(
      '${fullTableName}',
      INTERVAL '${compressAfter}'
    );
  `)
  );
}

/**
 * Set retention policy on a hypertable
 */
export async function setRetentionPolicy(
  db: Database,
  schema: string,
  table: string,
  retentionInterval: string
): Promise<void> {
  const fullTableName = `${schema}.${table}`;

  await db.execute(
    sql.raw(`
    SELECT add_retention_policy(
      '${fullTableName}',
      INTERVAL '${retentionInterval}'
    );
  `)
  );
}

/**
 * Create continuous aggregate
 */
export async function createContinuousAggregate(
  db: Database,
  viewName: string,
  query: string,
  options?: {
    refreshInterval?: string;
    startOffset?: string;
    endOffset?: string;
    ifNotExists?: boolean;
  }
): Promise<void> {
  const ifNotExists = options?.ifNotExists ? "IF NOT EXISTS" : "";

  await db.execute(
    sql.raw(`
    CREATE MATERIALIZED VIEW ${ifNotExists} ${viewName}
    WITH (timescaledb.continuous) AS
    ${query}
    WITH NO DATA;
  `)
  );

  // Add refresh policy if specified
  if (options?.refreshInterval) {
    const startOffset = options?.startOffset ?? "1 day";
    const endOffset = options?.endOffset ?? "1 hour";

    await db.execute(
      sql.raw(`
      SELECT add_continuous_aggregate_policy(
        '${viewName}',
        start_offset => INTERVAL '${startOffset}',
        end_offset => INTERVAL '${endOffset}',
        schedule_interval => INTERVAL '${options.refreshInterval}'
      );
    `)
    );
  }
}

// ============================================================================
// Hypertable Information
// ============================================================================

/**
 * Check if a table is a hypertable
 */
export async function isHypertable(
  db: Database,
  schema: string,
  table: string
): Promise<boolean> {
  const result = await db.execute(
    sql.raw(`
    SELECT COUNT(*) as count
    FROM timescaledb_information.hypertables
    WHERE hypertable_schema = '${schema}'
    AND hypertable_name = '${table}';
  `)
  );

  const rows = result as unknown as CountResult[];
  return Number(rows[0]?.count) > 0;
}

/**
 * Get hypertable statistics
 */
export async function getHypertableStats(
  db: Database,
  schema: string,
  table: string
): Promise<HypertableStats | null> {
  const result = await db.execute(
    sql.raw(`
    SELECT
      COUNT(c.chunk_name) as total_chunks,
      pg_size_pretty(SUM(total_bytes)) as total_size,
      COUNT(c.chunk_name) FILTER (WHERE c.is_compressed) as compressed_chunks,
      pg_size_pretty(COALESCE(SUM(before_compression_total_bytes), 0)) as uncompressed_size,
      pg_size_pretty(COALESCE(SUM(after_compression_total_bytes), 0)) as compressed_size
    FROM timescaledb_information.chunks c
    LEFT JOIN timescaledb_information.compressed_chunk_stats cs
      ON c.chunk_name = cs.chunk_name
    WHERE c.hypertable_schema = '${schema}'
    AND c.hypertable_name = '${table}';
  `)
  );

  const rows = result as unknown as ChunkStatsRow[];
  if (!rows || rows.length === 0) return null;

  const row = rows[0];
  return {
    totalChunks: Number(row.total_chunks),
    totalSize: row.total_size,
    compressedChunks: Number(row.compressed_chunks),
    uncompressedSize: row.uncompressed_size,
    compressedSize: row.compressed_size,
  };
}

// ============================================================================
// TimescaleDB Query Helpers
// ============================================================================

/**
 * Time bucket intervals
 */
export type TimeBucketInterval =
  | "1 minute"
  | "5 minutes"
  | "15 minutes"
  | "30 minutes"
  | "1 hour"
  | "4 hours"
  | "1 day"
  | "1 week"
  | "1 month";

/**
 * Aggregation functions
 */
export type AggregateFunction = "avg" | "sum" | "min" | "max" | "count" | "first" | "last";

/**
 * Time bucket query options
 */
export interface TimeBucketQueryOptions {
  schema: string;
  table: string;
  timeColumn: string;
  interval: TimeBucketInterval;
  aggregations: Array<{
    column: string;
    function: AggregateFunction;
    alias: string;
  }>;
  groupBy?: string[];
  where?: string;
  orderBy?: "ASC" | "DESC";
  limit?: number;
}

/**
 * Execute a time bucket aggregation query
 */
export async function queryTimeBucket<T extends Record<string, unknown>>(
  db: Database,
  options: TimeBucketQueryOptions
): Promise<Array<{ bucket: Date } & T>> {
  const {
    schema,
    table,
    timeColumn,
    interval,
    aggregations,
    groupBy = [],
    where,
    orderBy = "DESC",
    limit,
  } = options;

  const fullTableName = `${schema}.${table}`;

  // Build aggregation columns
  const aggColumns = aggregations
    .map((agg) => {
      if (agg.function === "first" || agg.function === "last") {
        return `${agg.function}(${agg.column}, ${timeColumn}) AS ${agg.alias}`;
      }
      return `${agg.function}(${agg.column}) AS ${agg.alias}`;
    })
    .join(", ");

  // Build GROUP BY clause
  const groupByColumns = groupBy.length > 0 ? `, ${groupBy.join(", ")}` : "";
  const groupByClause = `GROUP BY bucket${groupByColumns}`;

  // Build WHERE clause
  const whereClause = where ? `WHERE ${where}` : "";

  // Build LIMIT clause
  const limitClause = limit ? `LIMIT ${limit}` : "";

  const query = `
    SELECT
      time_bucket('${interval}', ${timeColumn}) AS bucket,
      ${aggColumns}
      ${groupByColumns}
    FROM ${fullTableName}
    ${whereClause}
    ${groupByClause}
    ORDER BY bucket ${orderBy}
    ${limitClause}
  `;

  const result = await db.execute(sql.raw(query));
  return result as unknown as Array<{ bucket: Date } & T>;
}

/**
 * Get the latest N rows from a hypertable
 */
export async function queryLatest<T extends Record<string, unknown>>(
  db: Database,
  schema: string,
  table: string,
  timeColumn: string,
  limit: number = 100,
  where?: string
): Promise<T[]> {
  const fullTableName = `${schema}.${table}`;
  const whereClause = where ? `WHERE ${where}` : "";

  const query = `
    SELECT *
    FROM ${fullTableName}
    ${whereClause}
    ORDER BY ${timeColumn} DESC
    LIMIT ${limit}
  `;

  const result = await db.execute(sql.raw(query));
  return result as unknown as T[];
}

/**
 * Get time range statistics
 */
export async function queryTimeRangeStats<T extends Record<string, unknown>>(
  db: Database,
  options: {
    schema: string;
    table: string;
    timeColumn: string;
    startTime: Date;
    endTime: Date;
    aggregations: Array<{
      column: string;
      function: AggregateFunction;
      alias: string;
    }>;
    groupBy?: string[];
  }
): Promise<T[]> {
  const {
    schema,
    table,
    timeColumn,
    startTime,
    endTime,
    aggregations,
    groupBy = [],
  } = options;

  const fullTableName = `${schema}.${table}`;

  // Build aggregation columns
  const aggColumns = aggregations
    .map((agg) => {
      if (agg.function === "first" || agg.function === "last") {
        return `${agg.function}(${agg.column}, ${timeColumn}) AS ${agg.alias}`;
      }
      return `${agg.function}(${agg.column}) AS ${agg.alias}`;
    })
    .join(", ");

  // Build GROUP BY clause
  const groupByClause =
    groupBy.length > 0 ? `GROUP BY ${groupBy.join(", ")}` : "";

  const query = `
    SELECT
      ${groupBy.length > 0 ? groupBy.join(", ") + ", " : ""}
      ${aggColumns}
    FROM ${fullTableName}
    WHERE ${timeColumn} >= '${startTime.toISOString()}'
      AND ${timeColumn} < '${endTime.toISOString()}'
    ${groupByClause}
  `;

  const result = await db.execute(sql.raw(query));
  return result as unknown as T[];
}

/**
 * OHLC (Open, High, Low, Close) query for price data
 */
export interface OHLCResult {
  bucket: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export async function queryOHLC(
  db: Database,
  options: {
    schema: string;
    table: string;
    timeColumn: string;
    priceColumn: string;
    interval: TimeBucketInterval;
    volumeColumn?: string;
    where?: string;
    limit?: number;
  }
): Promise<OHLCResult[]> {
  const {
    schema,
    table,
    timeColumn,
    priceColumn,
    interval,
    volumeColumn,
    where,
    limit,
  } = options;

  const fullTableName = `${schema}.${table}`;
  const whereClause = where ? `WHERE ${where}` : "";
  const limitClause = limit ? `LIMIT ${limit}` : "";
  const volumeSelect = volumeColumn ? `, SUM(${volumeColumn}) AS volume` : "";

  const query = `
    SELECT
      time_bucket('${interval}', ${timeColumn}) AS bucket,
      first(${priceColumn}, ${timeColumn}) AS open,
      MAX(${priceColumn}) AS high,
      MIN(${priceColumn}) AS low,
      last(${priceColumn}, ${timeColumn}) AS close
      ${volumeSelect}
    FROM ${fullTableName}
    ${whereClause}
    GROUP BY bucket
    ORDER BY bucket DESC
    ${limitClause}
  `;

  const result = await db.execute(sql.raw(query));
  return result as unknown as OHLCResult[];
}
