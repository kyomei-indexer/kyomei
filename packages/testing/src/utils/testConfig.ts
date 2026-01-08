import type { KyomeiConfig } from '@kyomei/config';

/**
 * Create a minimal test configuration
 */
export function createTestConfig(overrides?: Partial<KyomeiConfig>): KyomeiConfig {
  return {
    database: {
      connectionString:
        process.env.TEST_DATABASE_URL ??
        'postgresql://kyomei_test:kyomei_test@localhost:5433/kyomei_test',
      syncSchema: 'kyomei_sync',
      appSchema: 'kyomei_app',
      cronsSchema: 'kyomei_crons',
      poolSize: 5,
      schemaVersion: 'v1',
    },
    chains: {
      testchain: {
        id: 31337, // Hardhat/Anvil default
        source: {
          type: 'rpc',
          url: 'http://localhost:8545',
          finality: 1,
        },
        pollingInterval: 1000,
      },
    },
    contracts: {},
    logging: {
      level: 'debug',
      timestamps: true,
      progress: false,
    },
    ...overrides,
  };
}
