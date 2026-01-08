import {
  pgTable,
  varchar,
  bigint,
  integer,
  numeric,
  timestamp,
  real,
  text,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Database } from "../connection.js";
import {
  createHypertable,
  enableCompression,
  setRetentionPolicy,
} from "./hypertable.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Column type definitions for TimescaleDB tables
 */
export type ColumnType =
  | "varchar"
  | "text"
  | "integer"
  | "bigint"
  | "numeric"
  | "real"
  | "boolean"
  | "timestamp"
  | "timestamptz";

/**
 * Column definition
 */
export interface ColumnDef {
  type: ColumnType;
  length?: number;
  precision?: number;
  scale?: number;
  notNull?: boolean;
  primaryKey?: boolean;
  default?: unknown;
}

/**
 * Hypertable configuration
 */
export interface HypertableConfig {
  /** Time column for partitioning (must be timestamp/timestamptz) */
  timeColumn: string;
  /** Chunk time interval (default: 7 days) */
  chunkInterval?: string;
  /** Space partitioning column */
  spaceColumn?: string;
  /** Number of space partitions */
  spacePartitions?: number;
  /** Compression settings */
  compression?: {
    /** Enable compression (default: true) */
    enabled: boolean;
    /** Segment by columns */
    segmentBy: string[];
    /** Order by columns */
    orderBy: string[];
    /** Compress chunks after this interval (default: 7 days) */
    after?: string;
  };
  /** Retention policy */
  retention?: {
    /** Drop data older than this interval */
    dropAfter: string;
  };
}

/**
 * TimescaleDB table definition
 */
export interface TimescaleTableDef {
  name: string;
  schema: string;
  columns: Record<string, ColumnDef>;
  indexes?: Array<{
    name: string;
    columns: string[];
    unique?: boolean;
  }>;
  hypertable: HypertableConfig;
}

// ============================================================================
// Table Builder
// ============================================================================

/**
 * Build a Drizzle table definition for a TimescaleDB hypertable
 * Note: This function returns a simplified table type for runtime use.
 * For full type safety, define tables directly using pgTable().
 */
export function buildTimescaleTable(
  tableName: string,
  columns: Record<string, ColumnDef>,
  indexes?: Array<{ name: string; columns: string[] }>
): ReturnType<typeof pgTable> {
  const columnBuilders: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(columns)) {
    let col: unknown;

    switch (def.type) {
      case "varchar":
        col = varchar(name, { length: def.length ?? 255 });
        break;
      case "text":
        col = text(name);
        break;
      case "integer":
        col = integer(name);
        break;
      case "bigint":
        col = bigint(name, { mode: "bigint" });
        break;
      case "numeric":
        col = numeric(name, {
          precision: def.precision ?? 30,
          scale: def.scale ?? 18,
        });
        break;
      case "real":
        col = real(name);
        break;
      case "boolean":
        col = boolean(name);
        break;
      case "timestamp":
        col = timestamp(name);
        break;
      case "timestamptz":
        col = timestamp(name, { withTimezone: true });
        break;
    }

    // Apply modifiers
    if (def.notNull && col && typeof col === "object" && "notNull" in col) {
      col = (col as { notNull: () => unknown }).notNull();
    }
    if (
      def.primaryKey &&
      col &&
      typeof col === "object" &&
      "primaryKey" in col
    ) {
      col = (col as { primaryKey: () => unknown }).primaryKey();
    }
    if (
      def.default !== undefined &&
      col &&
      typeof col === "object" &&
      "default" in col
    ) {
      col = (col as { default: (val: unknown) => unknown }).default(
        def.default
      );
    }

    columnBuilders[name] = col;
  }

  // Create table - indexes are created separately via SQL
  const table = pgTable(tableName, columnBuilders as Record<string, never>);

  // Store index definitions for later creation
  (table as Record<string, unknown>)._kyomeiIndexes = indexes;

  return table;
}

/**
 * Initialize a TimescaleDB hypertable from a table definition
 */
export async function initializeHypertable(
  db: Database,
  def: TimescaleTableDef
): Promise<void> {
  const { schema, name, hypertable } = def;

  // Create hypertable
  await createHypertable(db, schema, name, hypertable.timeColumn, {
    chunkTimeInterval: hypertable.chunkInterval,
    ifNotExists: true,
    partitioningColumn: hypertable.spaceColumn,
    numberOfPartitions: hypertable.spacePartitions,
  });

  // Enable compression if configured
  if (hypertable.compression?.enabled) {
    try {
      await enableCompression(
        db,
        schema,
        name,
        hypertable.compression.segmentBy,
        hypertable.compression.orderBy,
        { compressAfter: hypertable.compression.after }
      );
    } catch {
      // Compression may already be enabled
    }
  }

  // Set retention policy if configured
  if (hypertable.retention?.dropAfter) {
    try {
      await setRetentionPolicy(
        db,
        schema,
        name,
        hypertable.retention.dropAfter
      );
    } catch {
      // Retention policy may already exist
    }
  }
}

/**
 * Generate CREATE TABLE SQL for a hypertable
 */
export function generateHypertableSQL(def: TimescaleTableDef): string {
  const { schema, name, columns, indexes, hypertable } = def;
  const fullTableName = `${schema}.${name}`;

  // Generate column definitions
  const columnDefs: string[] = [];
  for (const [colName, col] of Object.entries(columns)) {
    let colDef = `${colName} ${mapColumnType(col)}`;
    if (col.notNull) colDef += " NOT NULL";
    if (col.primaryKey) colDef += " PRIMARY KEY";
    if (col.default !== undefined) {
      colDef += ` DEFAULT ${formatDefault(col.default)}`;
    }
    columnDefs.push(colDef);
  }

  // Generate index definitions
  const indexDefs: string[] = [];
  if (indexes) {
    for (const idx of indexes) {
      const unique = idx.unique ? "UNIQUE " : "";
      indexDefs.push(
        `CREATE ${unique}INDEX IF NOT EXISTS ${
          idx.name
        } ON ${fullTableName} (${idx.columns.join(", ")})`
      );
    }
  }

  // Build SQL statements
  const statements = [
    `CREATE SCHEMA IF NOT EXISTS ${schema}`,
    `CREATE TABLE IF NOT EXISTS ${fullTableName} (\n  ${columnDefs.join(
      ",\n  "
    )}\n)`,
    ...indexDefs,
    `SELECT create_hypertable('${fullTableName}', '${
      hypertable.timeColumn
    }', if_not_exists => TRUE, chunk_time_interval => INTERVAL '${
      hypertable.chunkInterval ?? "7 days"
    }')`,
  ];

  // Add compression
  if (hypertable.compression?.enabled) {
    statements.push(
      `ALTER TABLE ${fullTableName} SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = '${hypertable.compression.segmentBy.join(
          ", "
        )}',
        timescaledb.compress_orderby = '${hypertable.compression.orderBy.join(
          ", "
        )}'
      )`,
      `SELECT add_compression_policy('${fullTableName}', INTERVAL '${
        hypertable.compression.after ?? "7 days"
      }')`
    );
  }

  // Add retention
  if (hypertable.retention?.dropAfter) {
    statements.push(
      `SELECT add_retention_policy('${fullTableName}', INTERVAL '${hypertable.retention.dropAfter}')`
    );
  }

  return statements.join(";\n\n") + ";";
}

/**
 * Execute hypertable creation SQL
 */
export async function createHypertableFromDef(
  db: Database,
  def: TimescaleTableDef
): Promise<void> {
  const { schema, name, columns, indexes, hypertable } = def;
  const fullTableName = `${schema}.${name}`;

  // Create schema
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${schema}`));

  // Generate column definitions
  const columnDefs: string[] = [];
  for (const [colName, col] of Object.entries(columns)) {
    let colDef = `${colName} ${mapColumnType(col)}`;
    if (col.notNull) colDef += " NOT NULL";
    if (col.primaryKey) colDef += " PRIMARY KEY";
    if (col.default !== undefined) {
      colDef += ` DEFAULT ${formatDefault(col.default)}`;
    }
    columnDefs.push(colDef);
  }

  // Create table
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${fullTableName} (\n  ${columnDefs.join(
        ",\n  "
      )}\n)`
    )
  );

  // Create indexes
  if (indexes) {
    for (const idx of indexes) {
      const unique = idx.unique ? "UNIQUE " : "";
      await db.execute(
        sql.raw(
          `CREATE ${unique}INDEX IF NOT EXISTS ${
            idx.name
          } ON ${fullTableName} (${idx.columns.join(", ")})`
        )
      );
    }
  }

  // Convert to hypertable
  try {
    await db.execute(
      sql.raw(
        `SELECT create_hypertable('${fullTableName}', '${
          hypertable.timeColumn
        }', if_not_exists => TRUE, chunk_time_interval => INTERVAL '${
          hypertable.chunkInterval ?? "7 days"
        }')`
      )
    );
  } catch {
    // Table may already be a hypertable
  }

  // Enable compression
  if (hypertable.compression?.enabled) {
    try {
      await db.execute(
        sql.raw(`
          ALTER TABLE ${fullTableName} SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = '${hypertable.compression.segmentBy.join(
              ", "
            )}',
            timescaledb.compress_orderby = '${hypertable.compression.orderBy.join(
              ", "
            )}'
          )
        `)
      );
      await db.execute(
        sql.raw(
          `SELECT add_compression_policy('${fullTableName}', INTERVAL '${
            hypertable.compression.after ?? "7 days"
          }')`
        )
      );
    } catch {
      // Compression may already be enabled
    }
  }

  // Set retention
  if (hypertable.retention?.dropAfter) {
    try {
      await db.execute(
        sql.raw(
          `SELECT add_retention_policy('${fullTableName}', INTERVAL '${hypertable.retention.dropAfter}')`
        )
      );
    } catch {
      // Retention policy may already exist
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function mapColumnType(col: ColumnDef): string {
  switch (col.type) {
    case "varchar":
      return `VARCHAR(${col.length ?? 255})`;
    case "text":
      return "TEXT";
    case "integer":
      return "INTEGER";
    case "bigint":
      return "BIGINT";
    case "numeric":
      return `NUMERIC(${col.precision ?? 30}, ${col.scale ?? 18})`;
    case "real":
      return "REAL";
    case "boolean":
      return "BOOLEAN";
    case "timestamp":
      return "TIMESTAMP";
    case "timestamptz":
      return "TIMESTAMPTZ";
    default:
      return "TEXT";
  }
}

function formatDefault(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value}'`;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return String(value);
}
