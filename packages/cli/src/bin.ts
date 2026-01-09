#!/usr/bin/env node
import { program } from 'commander';
import { devCommand } from './commands/dev.ts';
import { startCommand } from './commands/start.ts';
import { migrateCommand } from './commands/migrate.ts';
import { backupCommand } from './commands/backup.ts';

program
  .name('kyomei')
  .description('Kyomei EVM Indexer CLI')
  .version('0.0.1');

// Dev command - run with hot reload
program
  .command('dev')
  .description('Start development server with hot reload')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Increase verbosity', (_, prev) => prev + 1, 1)
  .option('--syncer', 'Run syncer only')
  .option('--processor', 'Run processor only')
  .option('--api', 'Run API only')
  .option('--crons', 'Run crons only')
  .action(devCommand);

// Start command - production mode
program
  .command('start')
  .description('Start production server')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Increase verbosity', (_, prev) => prev + 1, 1)
  .option('--syncer', 'Run syncer only')
  .option('--processor', 'Run processor only')
  .option('--api', 'Run API only')
  .option('--crons', 'Run crons only')
  .action(startCommand);

// Migrate command
program
  .command('migrate')
  .description('Run database migrations')
  .option('-c, --config <path>', 'Path to config file')
  .option('--up', 'Run pending migrations (default)')
  .option('--down', 'Rollback last migration')
  .option('--reset', 'Reset all migrations')
  .option('--status', 'Show migration status')
  .action(migrateCommand);

// Backup command
program
  .command('backup')
  .description('Manage database backups')
  .option('-c, --config <path>', 'Path to config file')
  .option('--create', 'Create a new backup')
  .option('--list', 'List available backups')
  .option('--restore <file>', 'Restore from backup')
  .option('--download <file>', 'Download backup from S3')
  .action(backupCommand);

program.parse();
