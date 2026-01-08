import { loadConfig } from "@kyomei/config";
import { createLogger } from "@kyomei/core";
import { createConnection, MigrationRunner } from "@kyomei/database";

/**
 * Start command options
 */
interface StartOptions {
  config?: string;
  verbose: number;
  syncer?: boolean;
  processor?: boolean;
  api?: boolean;
  crons?: boolean;
}

/**
 * Production server command
 */
export async function startCommand(options: StartOptions): Promise<void> {
  const logger = createLogger({
    verbosity: options.verbose,
    timestamps: true,
    json: process.env.LOG_JSON === "true",
    progress: true,
  });

  logger.info("Starting Kyomei production server...");

  try {
    // Load configuration
    const config = await loadConfig({
      configPath: options.config,
    });

    // Connect to database
    const { db, client } = createConnection({
      connectionString: config.database.connectionString,
      maxConnections: config.database.poolSize,
    });

    // Verify migrations are up to date
    const migrationRunner = new MigrationRunner(db);
    const status = await migrationRunner.status();
    const pending = status.filter((m) => !m.applied);

    if (pending.length > 0) {
      logger.error(
        `${pending.length} pending migrations. Run 'kyomei migrate' first.`
      );
      process.exit(1);
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

    logger.info("Production server running.");
  } catch (error) {
    logger.error("Failed to start production server", {
      error: error as Error,
    });
    process.exit(1);
  }
}
