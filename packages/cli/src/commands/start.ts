import path from "node:path";
import { existsSync } from "node:fs";
import { createJiti } from "jiti";
import { loadConfig } from "@kyomei/config";
import { createLogger } from "@kyomei/core";
import { createConnection, testConnection, MigrationRunner, SchemaManager } from "@kyomei/database";
import type { HandlerRegistration } from "@kyomei/processor";

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
    logger.info("Connecting to database...");
    const { db, client } = createConnection({
      connectionString: config.database.connectionString,
      maxConnections: config.database.poolSize,
    });

    // Test connection with helpful error messages
    const connectionResult = await testConnection(db, config.database.connectionString);
    if (!connectionResult.success) {
      logger.error(`Database connection failed: ${connectionResult.error}`);
      if (connectionResult.details) {
        for (const line of connectionResult.details.split('\n')) {
          logger.error(line.trim());
        }
      }
      await client.end();
      process.exit(1);
    }
    logger.info("Database connected");

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

    // Load and apply app schema from schema.ts
    const schemaVersion = config.database.schemaVersion ?? "v1";
    const configDir = options.config
      ? path.dirname(path.resolve(options.config))
      : process.cwd();
    const schemaFile = path.join(configDir, "schema.ts");

    if (existsSync(schemaFile)) {
      logger.info("Loading app schema...");
      try {
        const jiti = createJiti(import.meta.url, {
          interopDefault: true,
          moduleCache: false,
        });

        const schemaModule = (await jiti.import(schemaFile)) as {
          createAppSchema?: (version: string) => {
            schemaName: string;
            tables: Record<string, unknown>;
          };
        };

        if (schemaModule.createAppSchema) {
          const appSchema = schemaModule.createAppSchema(schemaVersion);
          const schemaManager = new SchemaManager(db);
          await schemaManager.initialize();

          const result = await schemaManager.migrateSchema(
            {
              schemaName: config.database.appSchema ?? "kyomei_app",
              tables: appSchema.tables as Record<string, never>,
            },
            schemaVersion
          );

          if (result.created) {
            logger.info(`Created app schema with version ${schemaVersion}`);
          } else if (result.migrated) {
            logger.info(
              `Migrated app schema from ${result.previousVersion} to ${schemaVersion}`
            );
          } else {
            logger.debug(`App schema ${schemaVersion} is up to date`);
          }
        }
      } catch (error) {
        logger.warn("Failed to load app schema", { error: error as Error });
      }
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

    // Load handler registrations from user's entry point
    let handlerRegistrations: HandlerRegistration[] = [];
    if (services.processor) {
      try {
        // Try to find and load the user's index.ts which should import handlers
        const configDir = options.config
          ? path.dirname(path.resolve(options.config))
          : process.cwd();
        const entryPoint = path.join(configDir, "src", "index.ts");

        if (!existsSync(entryPoint)) {
          logger.warn(`Entry point not found: ${entryPoint}`);
        } else {
          logger.debug(`Loading handlers from ${entryPoint}`);

          // Use jiti to load TypeScript files
          const jiti = createJiti(import.meta.url, {
            interopDefault: true,
            moduleCache: false,
          });

          const userModule = (await jiti.import(entryPoint)) as {
            kyomei?: { getRegistrations?: () => HandlerRegistration[] };
          };

          // Look for kyomei instance with getRegistrations method
          if (
            userModule.kyomei &&
            typeof userModule.kyomei.getRegistrations === "function"
          ) {
            handlerRegistrations = userModule.kyomei.getRegistrations();
            logger.info(
              `Loaded ${handlerRegistrations.length} handler registrations`
            );
          } else {
            logger.warn(
              "No kyomei instance found in entry point. Make sure to export kyomei from src/index.ts"
            );
          }
        }
      } catch (error) {
        logger.warn("Failed to load handlers", { error: error as Error });
      }
    }

    // Import and initialize the runner
    const { ServiceRunner } = await import("@kyomei/runner");
    const runner = new ServiceRunner({
      config,
      db,
      client,
      logger,
      services,
      handlerRegistrations,
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
