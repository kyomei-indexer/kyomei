import { z } from 'zod';

// ============================================================================
// Source Configuration Schemas
// ============================================================================

const rpcSourceSchema = z.object({
  type: z.literal('rpc'),
  url: z.string().url(),
  finality: z.union([z.number().positive(), z.literal('finalized')]),
});

const erpcSourceSchema = z.object({
  type: z.literal('erpc'),
  url: z.string().url(),
  finality: z.union([z.number().positive(), z.literal('finalized')]),
  projectId: z.string().optional(),
});

const hyperSyncSourceSchema = z.object({
  type: z.literal('hypersync'),
  url: z.string().url().optional(),
  /** API token for HyperSync (optional for public endpoints) */
  apiToken: z.string().optional(),
  fallbackRpc: z.string().url().optional(),
});

const streamSourceSchema = z.object({
  type: z.literal('stream'),
  provider: z.literal('quicknode'),
  webhookPath: z.string().startsWith('/'),
  secret: z.string().min(1),
});

const sourceConfigSchema = z.discriminatedUnion('type', [
  rpcSourceSchema,
  erpcSourceSchema,
  hyperSyncSourceSchema,
  streamSourceSchema,
]);

// ============================================================================
// Address Configuration Schemas
// ============================================================================

const addressSchema = z.custom<`0x${string}`>(
  (val) => typeof val === 'string' && /^0x[a-fA-F0-9]{40}$/.test(val),
  { message: 'Invalid Ethereum address' }
);

const factoryConfigSchema = z.object({
  type: z.literal('factory'),
  address: addressSchema,
  event: z.object({
    type: z.literal('event'),
    name: z.string(),
    inputs: z.array(z.any()),
  }),
  parameter: z.string(),
});

const addressConfigSchema = z.union([
  addressSchema,
  z.array(addressSchema).min(1),
  factoryConfigSchema,
]);

// ============================================================================
// Sync Configuration Schema
// ============================================================================

const syncConfigSchema = z.object({
  /** Number of parallel workers for historical sync (default: 1) */
  parallelWorkers: z.number().positive().int().max(32).optional(),
  /** Blocks per request to RPC/HyperSync (default: 1000 for RPC, 10000 for HyperSync) */
  blockRangePerRequest: z.number().positive().int().max(1000000).optional(),
  /** Total blocks per worker chunk (default: 100000) */
  blocksPerWorker: z.number().positive().int().optional(),
  /** Batch size for event storage (default: 1000) */
  eventBatchSize: z.number().positive().int().optional(),
});

// ============================================================================
// Chain Configuration Schema
// ============================================================================

const chainConfigSchema = z.object({
  id: z.number().positive().int(),
  source: sourceConfigSchema,
  finalityBlocks: z.number().positive().int().optional(),
  pollingInterval: z.number().positive().int().optional(),
  sync: syncConfigSchema.optional(),
});

// ============================================================================
// Contract Configuration Schema
// ============================================================================

const contractConfigSchema = z.object({
  abi: z.array(z.any()).min(1),
  chain: z.string().min(1),
  address: addressConfigSchema,
  startBlock: z.number().nonnegative().int(),
  endBlock: z.number().nonnegative().int().optional(),
  maxBlockRange: z.number().positive().int().optional(),
});

// ============================================================================
// Cron Configuration Schema
// ============================================================================

const blockCronTriggerSchema = z.object({
  type: z.literal('block'),
  interval: z.number().positive().int(),
  offset: z.number().nonnegative().int().optional(),
});

const timeCronTriggerSchema = z.object({
  type: z.literal('time'),
  cron: z.string().min(1),
  timezone: z.string().optional(),
});

const cronTriggerSchema = z.discriminatedUnion('type', [
  blockCronTriggerSchema,
  timeCronTriggerSchema,
]);

const cronSchemaConfigSchema = z.object({
  type: z.enum(['chain', 'dedicated']),
  chain: z.string().optional(),
});

const cronConfigSchema = z.object({
  name: z.string().min(1),
  chain: z.string().min(1),
  trigger: cronTriggerSchema,
  handler: z.string().min(1),
  schema: cronSchemaConfigSchema.optional(),
  enabled: z.boolean().optional(),
});

// ============================================================================
// Backup Configuration Schema
// ============================================================================

const s3ConfigSchema = z.object({
  endpoint: z.string().url(),
  bucket: z.string().min(1),
  region: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().optional(),
});

const backupScheduleConfigSchema = z.object({
  enabled: z.boolean(),
  cron: z.string().min(1),
  retentionDays: z.number().positive().int().optional(),
});

const backupConfigSchema = z.object({
  storage: s3ConfigSchema,
  schemas: z.array(z.string().min(1)).min(1),
  schedule: backupScheduleConfigSchema.optional(),
  compressionLevel: z.number().min(1).max(9).optional(),
});

// ============================================================================
// Database Configuration Schema
// ============================================================================

const databaseConfigSchema = z.object({
  connectionString: z.string().min(1),
  syncSchema: z.string().optional(),
  appSchema: z.string().optional(),
  cronsSchema: z.string().optional(),
  poolSize: z.number().positive().int().optional(),
  schemaVersion: z.string().regex(/^v\d+$/, 'Schema version must be in format v1, v2, etc.'),
});

// ============================================================================
// Logging Configuration Schema
// ============================================================================

const logLevelSchema = z.enum(['error', 'warn', 'info', 'debug', 'trace']);

const loggingConfigSchema = z.object({
  level: logLevelSchema,
  timestamps: z.boolean().optional(),
  json: z.boolean().optional(),
  progress: z.boolean().optional(),
});

// ============================================================================
// API Configuration Schema
// ============================================================================

const apiConfigSchema = z.object({
  port: z.number().positive().int().optional(),
  host: z.string().optional(),
  graphql: z
    .object({
      enabled: z.boolean().optional(),
      path: z.string().optional(),
    })
    .optional(),
});

// ============================================================================
// Main Kyomei Configuration Schema
// ============================================================================

export const kyomeiConfigSchema = z
  .object({
    database: databaseConfigSchema,
    chains: z.record(z.string(), chainConfigSchema),
    contracts: z.record(z.string(), contractConfigSchema),
    crons: z.array(cronConfigSchema).optional(),
    backup: backupConfigSchema.optional(),
    logging: loggingConfigSchema.optional(),
    api: apiConfigSchema.optional(),
  })
  .superRefine((config, ctx) => {
    // Validate that all contract chain references exist
    for (const [contractName, contract] of Object.entries(config.contracts)) {
      if (!(contract.chain in config.chains)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Contract "${contractName}" references unknown chain "${contract.chain}"`,
          path: ['contracts', contractName, 'chain'],
        });
      }
    }

    // Validate that all cron chain references exist
    if (config.crons) {
      for (const [index, cron] of config.crons.entries()) {
        if (!(cron.chain in config.chains)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Cron "${cron.name}" references unknown chain "${cron.chain}"`,
            path: ['crons', index, 'chain'],
          });
        }
      }
    }
  });

export type KyomeiConfigInput = z.input<typeof kyomeiConfigSchema>;
export type KyomeiConfigOutput = z.output<typeof kyomeiConfigSchema>;

// Export individual schemas for reuse
export {
  sourceConfigSchema,
  addressConfigSchema,
  chainConfigSchema,
  contractConfigSchema,
  cronConfigSchema,
  backupConfigSchema,
  databaseConfigSchema,
  loggingConfigSchema,
  apiConfigSchema,
  syncConfigSchema,
};
