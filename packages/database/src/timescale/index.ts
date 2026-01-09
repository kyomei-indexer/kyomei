// Hypertable management
export {
  createHypertable,
  enableCompression,
  setRetentionPolicy,
  createContinuousAggregate,
  isHypertable,
  getHypertableStats,
  queryTimeBucket,
  queryLatest,
  queryTimeRangeStats,
  queryOHLC,
} from "./hypertable.ts";

export type {
  HypertableStats,
  TimeBucketRow,
  TimeBucketInterval,
  AggregateFunction,
  TimeBucketQueryOptions,
  OHLCResult,
} from "./hypertable.ts";

// Table builder
export {
  buildTimescaleTable,
  initializeHypertable,
  generateHypertableSQL,
  createHypertableFromDef,
} from "./builder.ts";

export type {
  ColumnType,
  ColumnDef,
  HypertableConfig,
  TimescaleTableDef,
} from "./builder.ts";
