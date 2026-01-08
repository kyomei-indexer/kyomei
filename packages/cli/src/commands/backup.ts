import { execSync } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@kyomei/config";
import { createLogger } from "@kyomei/core";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * Backup command options
 */
interface BackupOptions {
  config?: string;
  create?: boolean;
  list?: boolean;
  restore?: string;
  download?: string;
}

/**
 * Backup management command
 */
export async function backupCommand(options: BackupOptions): Promise<void> {
  const logger = createLogger({
    level: "info",
    timestamps: true,
  });

  try {
    // Load configuration
    const config = await loadConfig({
      configPath: options.config,
    });

    if (!config.backup) {
      logger.error("No backup configuration found in config file");
      process.exit(1);
    }

    const s3 = new S3Client({
      endpoint: config.backup.storage.endpoint,
      region: config.backup.storage.region,
      credentials: {
        accessKeyId: config.backup.storage.accessKeyId,
        secretAccessKey: config.backup.storage.secretAccessKey,
      },
      forcePathStyle: config.backup.storage.forcePathStyle,
    });

    const bucket = config.backup.storage.bucket;

    if (options.list) {
      // List backups
      logger.info("Listing backups...");
      const response = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: "kyomei-backup-",
        })
      );

      if (!response.Contents || response.Contents.length === 0) {
        console.log("\nNo backups found.\n");
      } else {
        console.log("\nAvailable Backups:");
        console.log("─".repeat(80));
        for (const obj of response.Contents) {
          const size = obj.Size
            ? `${(obj.Size / 1024 / 1024).toFixed(2)} MB`
            : "unknown";
          const modified = obj.LastModified?.toISOString() ?? "unknown";
          console.log(
            `${obj.Key?.padEnd(50)} ${size.padStart(10)} ${modified}`
          );
        }
        console.log("─".repeat(80));
        console.log(`Total: ${response.Contents.length} backups\n`);
      }
    } else if (options.create) {
      // Create backup
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `kyomei-backup-${timestamp}.sql.gz`;
      const tempDir = "/tmp/kyomei-backup";
      const tempFile = join(tempDir, filename);

      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }

      logger.info("Creating backup...");

      // Parse connection string
      const url = new URL(config.database.connectionString);
      const pgDumpEnv = {
        PGPASSWORD: url.password,
      };

      const schemas = config.backup.schemas.map((s) => `-n ${s}`).join(" ");

      // Run pg_dump
      execSync(
        `pg_dump -h ${url.hostname} -p ${url.port} -U ${
          url.username
        } -d ${url.pathname.slice(1)} ${schemas} | gzip > ${tempFile}`,
        { env: { ...process.env, ...pgDumpEnv } }
      );

      logger.info("Uploading to S3...");

      // Upload to S3
      const fileStream = createReadStream(tempFile);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: filename,
          Body: fileStream,
          ContentType: "application/gzip",
        })
      );

      // Cleanup
      execSync(`rm ${tempFile}`);

      logger.info(`Backup created: ${filename}`);
    } else if (options.download) {
      // Download backup
      const filename = options.download;
      const outputDir = "./backup";
      const outputFile = join(outputDir, filename);

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      logger.info(`Downloading ${filename}...`);

      const response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: filename,
        })
      );

      if (response.Body) {
        const writeStream = createWriteStream(outputFile);
        // @ts-ignore - Body is a Readable stream
        response.Body.pipe(writeStream);

        await new Promise<void>((resolve, reject) => {
          writeStream.on("finish", () => resolve());
          writeStream.on("error", reject);
        });

        logger.info(`Downloaded to: ${outputFile}`);
      }
    } else if (options.restore) {
      // Restore backup
      const filename = options.restore;
      const localFile = existsSync(filename)
        ? filename
        : join("./backup", filename);

      if (!existsSync(localFile)) {
        logger.error(`Backup file not found: ${filename}`);
        logger.info(
          "Download it first with: kyomei backup --download <filename>"
        );
        process.exit(1);
      }

      logger.warn(
        "This will REPLACE existing data. Continue? (Ctrl+C to cancel)"
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));

      logger.info("Restoring backup...");

      // Parse connection string
      const url = new URL(config.database.connectionString);
      const pgEnv = {
        PGPASSWORD: url.password,
      };

      // Restore
      execSync(
        `gunzip -c ${localFile} | psql -h ${url.hostname} -p ${url.port} -U ${
          url.username
        } -d ${url.pathname.slice(1)}`,
        { env: { ...process.env, ...pgEnv } }
      );

      logger.info("Backup restored successfully");
    } else {
      logger.info(
        "Usage: kyomei backup [--create|--list|--download <file>|--restore <file>]"
      );
    }
  } catch (error) {
    logger.error("Backup operation failed", { error: error as Error });
    process.exit(1);
  }
}
