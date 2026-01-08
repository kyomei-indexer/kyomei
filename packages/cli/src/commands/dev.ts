import { loadConfig } from "@kyomei/config";
import { createLogger } from "@kyomei/core";
import { createConnection, MigrationRunner } from "@kyomei/database";

/**
 * Dev command options
 */
interface DevOptions {
  config?: string;
  verbose: number;
  syncer?: boolean;
  processor?: boolean;
  api?: boolean;
  crons?: boolean;
}

/**
 * Development server command
 */
export async function devCommand(options: DevOptions): Promise<void> {
  const logger = createLogger({
    verbosity: options.verbose,
    timestamps: true,
    progress: true,
  });

  logger.info("Starting Kyomei development server...");

  try {
    // Load configuration
    const config = await loadConfig({
      configPath: options.config,
    });

    logger.debug("Configuration loaded", {
      chains: Object.keys(config.chains).join(", "),
      contracts: Object.keys(config.contracts).join(", "),
    });

    // Connect to database
    const { db, client } = createConnection({
      connectionString: config.database.connectionString,
      maxConnections: config.database.poolSize,
    });

    // Run migrations
    logger.info("Running database migrations...");
    const migrationRunner = new MigrationRunner(db);
    const applied = await migrationRunner.up();

    if (applied.length > 0) {
      logger.info(`Applied ${applied.length} migrations`, {
        migrations: applied.join(", "),
      });
    } else {
      logger.debug("Database is up to date");
    }

    // Determine which services to run
    const runAll =
      !options.syncer && !options.processor && !options.api && !options.crons;
    const services = {
      syncer: runAll || Boolean(options.syncer),
      processor: runAll || Boolean(options.processor),
      api: runAll || Boolean(options.api),
      crons: runAll || Boolean(options.crons),
    };

    logger.info("Services to run:", services);

    // Import and initialize the runner
    const { ServiceRunner } = await import("@kyomei/runner");
    const runner = new ServiceRunner({
      config,
      db,
      logger,
      services,
    });

    // Handle shutdown
    const shutdown = async () => {
      logger.info("Shutting down...");
      await runner.stop();
      await client.end();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start services
    await runner.start();

    logger.info("Development server running. Press Ctrl+C to stop.");
  } catch (error) {
    logger.error("Failed to start development server", {
      error: error as Error,
    });
    process.exit(1);
  }
}
