import { loadConfig } from '@kyomei/config';
import { createLogger } from '@kyomei/core';
import { createConnection, MigrationRunner } from '@kyomei/database';

/**
 * Migrate command options
 */
interface MigrateOptions {
  config?: string;
  up?: boolean;
  down?: boolean;
  reset?: boolean;
  status?: boolean;
}

/**
 * Database migration command
 */
export async function migrateCommand(options: MigrateOptions): Promise<void> {
  const logger = createLogger({
    level: 'info',
    timestamps: true,
  });

  try {
    // Load configuration
    const config = await loadConfig({
      configPath: options.config,
    });

    // Connect to database
    const { db, client } = createConnection({
      connectionString: config.database.connectionString,
    });

    const runner = new MigrationRunner(db);

    if (options.status) {
      // Show status
      const status = await runner.status();
      console.log('\nMigration Status:');
      console.log('─'.repeat(60));

      for (const migration of status) {
        const statusIcon = migration.applied ? '✓' : '○';
        const appliedAt = migration.appliedAt
          ? migration.appliedAt.toISOString()
          : 'not applied';
        console.log(`${statusIcon} ${migration.name.padEnd(40)} ${appliedAt}`);
      }

      console.log('─'.repeat(60));
      const applied = status.filter((m) => m.applied).length;
      const pending = status.filter((m) => !m.applied).length;
      console.log(`Applied: ${applied}, Pending: ${pending}\n`);
    } else if (options.down) {
      // Rollback
      logger.info('Rolling back last migration...');
      const rolled = await runner.down();
      if (rolled) {
        logger.info(`Rolled back: ${rolled}`);
      } else {
        logger.info('No migrations to rollback');
      }
    } else if (options.reset) {
      // Reset
      logger.warn('Resetting all migrations...');
      await runner.reset();
      logger.info('All migrations reset');
    } else {
      // Run pending (default)
      logger.info('Running pending migrations...');
      const applied = await runner.up();
      if (applied.length > 0) {
        logger.info(`Applied ${applied.length} migrations:`);
        for (const name of applied) {
          logger.info(`  - ${name}`);
        }
      } else {
        logger.info('Database is up to date');
      }
    }

    await client.end();
  } catch (error) {
    logger.error('Migration failed', { error: error as Error });
    process.exit(1);
  }
}
