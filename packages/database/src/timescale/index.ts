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
} from "./hypertable.js";

export type {
  HypertableStats,
  TimeBucketRow,
  TimeBucketInterval,
  AggregateFunction,
  TimeBucketQueryOptions,
  OHLCResult,
} from "./hypertable.js";

// Table builder
export {
  buildTimescaleTable,
  initializeHypertable,
  generateHypertableSQL,
  createHypertableFromDef,
} from "./builder.js";

export type {
  ColumnType,
  ColumnDef,
  HypertableConfig,
  TimescaleTableDef,
} from "./builder.js";
