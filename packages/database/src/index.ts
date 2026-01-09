// Connection
export {
  createConnection,
  closeConnection,
  testConnection,
} from "./connection.ts";
export type { Database, Schema, ConnectionOptions } from "./connection.ts";

// Re-export Drizzle ORM utilities for convenience
export { sql, eq, and, or, gt, gte, lt, lte, ne, like, ilike, inArray, notInArray, isNull, isNotNull, desc, asc } from "drizzle-orm";
export {
  pgTable,
  pgSchema,
  varchar,
  text,
  integer,
  bigint,
  numeric,
  real,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
export type {
  PgTable,
  PgColumn,
  PgTableWithColumns,
} from "drizzle-orm/pg-core";

// Schemas
export * from "./schemas/index.ts";

// Schema Management
export { SchemaManager } from "./schema/index.ts";
export type { SchemaDefinition, TableDefinition } from "./schema/index.ts";

// Repositories
export * from "./repositories/index.ts";

// Migrations
export { MigrationRunner, migrations } from "./migrations/index.ts";

// TimescaleDB utilities
export * from "./timescale/index.ts";
