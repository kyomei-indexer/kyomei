import { createJiti } from 'jiti';
import { kyomeiConfigSchema } from './schema.ts';
import type { KyomeiConfig } from './types.ts';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Partial<KyomeiConfig> = {
  database: {
    connectionString: '',
    syncSchema: 'kyomei_sync',
    appSchema: 'kyomei_app',
    cronsSchema: 'kyomei_crons',
    poolSize: 10,
    schemaVersion: 'v1',
  },
  logging: {
    level: 'info',
    timestamps: true,
    json: false,
    progress: true,
  },
  api: {
    port: 42069,
    host: '0.0.0.0',
    graphql: {
      enabled: true,
      path: '/graphql',
    },
  },
};

/**
 * Configuration file names to search for (in order)
 */
const CONFIG_FILE_NAMES = [
  'kyomei.config.ts',
  'kyomei.config.js',
  'kyomei.config.mts',
  'kyomei.config.mjs',
];

/**
 * Find configuration file in the given directory
 */
async function findConfigFile(cwd: string): Promise<string | undefined> {
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');

  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = join(cwd, fileName);
    if (existsSync(filePath)) {
      return filePath;
    }
  }

  return undefined;
}

/**
 * Load configuration from a file path
 * Uses jiti to support TypeScript config files
 */
async function loadConfigFile(filePath: string): Promise<unknown> {
  // Create jiti instance for TypeScript/ESM support
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
  });

  // Import the config file (works with .ts, .js, .mts, .mjs)
  const module = await jiti.import(filePath);

  // Support both default export and named export
  return (module as Record<string, unknown>).default ?? (module as Record<string, unknown>).config ?? module;
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };

  for (const key of Object.keys(override) as (keyof T)[]) {
    const baseValue = base[key];
    const overrideValue = override[key];

    if (
      typeof baseValue === 'object' &&
      baseValue !== null &&
      !Array.isArray(baseValue) &&
      typeof overrideValue === 'object' &&
      overrideValue !== null &&
      !Array.isArray(overrideValue)
    ) {
      result[key] = deepMerge(baseValue as object, overrideValue as object) as T[keyof T];
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Load and validate Kyomei configuration
 */
export async function loadConfig(options?: {
  /** Custom config file path */
  configPath?: string;
  /** Working directory to search for config (default: process.cwd()) */
  cwd?: string;
}): Promise<KyomeiConfig> {
  const cwd = options?.cwd ?? process.cwd();

  // Find or use provided config path
  let configPath = options?.configPath;
  if (!configPath) {
    configPath = await findConfigFile(cwd);
    if (!configPath) {
      throw new Error(
        `No configuration file found. Create one of: ${CONFIG_FILE_NAMES.join(', ')}`
      );
    }
  }

  // Load the config file
  let rawConfig: unknown;
  try {
    rawConfig = await loadConfigFile(configPath);
  } catch (error) {
    throw new Error(
      `Failed to load configuration from ${configPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Validate with Zod schema
  const parseResult = kyomeiConfigSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    const errors = parseResult.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  // Merge with defaults
  const config = deepMerge(DEFAULT_CONFIG, parseResult.data as KyomeiConfig) as KyomeiConfig;

  return config;
}

/**
 * Create a type-safe configuration helper
 *
 * Uses generics to preserve literal types (especially for ABIs)
 * so that event args can be properly inferred in handlers.
 */
export function defineConfig<T extends KyomeiConfig>(config: T): T {
  return config;
}

/**
 * Environment-aware configuration with overrides
 */
export function defineConfigWithEnv(
  config: KyomeiConfig,
  envOverrides?: Partial<Record<'development' | 'production' | 'test', Partial<KyomeiConfig>>>
): KyomeiConfig {
  const env = (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test';
  const override = envOverrides?.[env];

  if (override) {
    return deepMerge(config, override);
  }

  return config;
}
