import cron from 'node-cron';
import type { Database } from '@kyomei/database';
import { cronJobs, cronExecutions, cronCheckpoints } from '@kyomei/database';
import type { ILogger, IRpcClient } from '@kyomei/core';
import type { CronConfig, CronHandler, CronHandlerContext, DbContext } from '@kyomei/config';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Cron scheduler options
 */
export interface CronSchedulerOptions {
  db: Database;
  rpcClients: Map<string, IRpcClient>;
  chainIds: Map<string, number>;
  logger: ILogger;
  cronsSchema: string;
  appSchema: string;
}

/**
 * Registered cron job
 */
interface RegisteredCron {
  config: CronConfig;
  handler: CronHandler;
  task?: cron.ScheduledTask;
  lastBlock?: bigint;
}

/**
 * Cron scheduler service
 * Manages block-based and time-based cron jobs
 */
export class CronScheduler {
  private readonly db: Database;
  private readonly rpcClients: Map<string, IRpcClient>;
  private readonly chainIds: Map<string, number>;
  private readonly logger: ILogger;
  private readonly cronsSchema: string;
  private readonly appSchema: string;
  private readonly crons: Map<string, RegisteredCron> = new Map();
  private blockPollers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  constructor(options: CronSchedulerOptions) {
    this.db = options.db;
    this.rpcClients = options.rpcClients;
    this.chainIds = options.chainIds;
    this.logger = options.logger.child({ module: 'CronScheduler' });
    this.cronsSchema = options.cronsSchema;
    this.appSchema = options.appSchema;
  }

  /**
   * Register a cron job
   */
  async register(config: CronConfig, handler: CronHandler): Promise<void> {
    const chainId = this.chainIds.get(config.chain);
    if (!chainId) {
      throw new Error(`Unknown chain: ${config.chain}`);
    }

    // Store in database
    await this.db
      .insert(cronJobs)
      .values({
        name: config.name,
        chainId,
        triggerType: config.trigger.type,
        triggerConfig: JSON.stringify(config.trigger),
        handlerPath: config.handler,
        enabled: config.enabled ?? true,
      })
      .onConflictDoUpdate({
        target: cronJobs.name,
        set: {
          triggerType: config.trigger.type,
          triggerConfig: JSON.stringify(config.trigger),
          handlerPath: config.handler,
          enabled: config.enabled ?? true,
          updatedAt: new Date(),
        },
      });

    this.crons.set(config.name, {
      config,
      handler,
    });

    this.logger.info(`Registered cron: ${config.name}`, {
      chain: config.chain,
      type: config.trigger.type,
    });
  }

  /**
   * Start all registered cron jobs
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    this.logger.info('Starting cron scheduler');

    for (const [name, cron] of this.crons) {
      if (cron.config.enabled === false) continue;

      if (cron.config.trigger.type === 'time') {
        this.startTimeCron(name, cron);
      } else {
        await this.startBlockCron(name, cron);
      }
    }
  }

  /**
   * Stop all cron jobs
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // Stop time-based crons
    for (const [, cron] of this.crons) {
      cron.task?.stop();
    }

    // Stop block pollers
    for (const [, timer] of this.blockPollers) {
      clearInterval(timer);
    }
    this.blockPollers.clear();

    this.logger.info('Cron scheduler stopped');
  }

  /**
   * Start a time-based cron job
   */
  private startTimeCron(name: string, registered: RegisteredCron): void {
    const trigger = registered.config.trigger;
    if (trigger.type !== 'time') return;

    const task = cron.schedule(
      trigger.cron,
      async () => {
        await this.executeCron(name);
      },
      {
        timezone: trigger.timezone ?? 'UTC',
      }
    );

    registered.task = task;
    this.logger.debug(`Started time cron: ${name}`, { cron: trigger.cron });
  }

  /**
   * Start a block-based cron job
   */
  private async startBlockCron(name: string, registered: RegisteredCron): Promise<void> {
    const trigger = registered.config.trigger;
    if (trigger.type !== 'block') return;

    const chainId = this.chainIds.get(registered.config.chain)!;
    const rpc = this.rpcClients.get(registered.config.chain);
    if (!rpc) {
      this.logger.error(`No RPC client for chain: ${registered.config.chain}`);
      return;
    }

    // Get last checkpoint
    const checkpoint = await this.db
      .select()
      .from(cronCheckpoints)
      .where(
        and(
          eq(cronCheckpoints.cronJobId, chainId), // Using chainId as jobId for simplicity
          eq(cronCheckpoints.chainId, chainId)
        )
      )
      .limit(1);

    registered.lastBlock = checkpoint[0]?.lastBlockNumber ?? 0n;

    // Poll for new blocks
    const pollInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        const currentBlock = await rpc.getBlockNumber();
        const lastBlock = registered.lastBlock ?? 0n;
        const interval = BigInt(trigger.interval);
        const offset = BigInt(trigger.offset ?? 0);

        // Calculate next execution block
        const nextBlock = lastBlock + interval;

        if (currentBlock >= nextBlock) {
          // Check if we should execute based on offset
          if ((nextBlock - offset) % interval === 0n) {
            await this.executeCron(name, currentBlock);
            registered.lastBlock = currentBlock;

            // Update checkpoint
            await this.updateBlockCheckpoint(name, chainId, currentBlock);
          }
        }
      } catch (error) {
        this.logger.error(`Block cron poll error: ${name}`, {
          error: error as Error,
        });
      }
    }, 5000); // Poll every 5 seconds

    this.blockPollers.set(name, pollInterval);
    this.logger.debug(`Started block cron: ${name}`, { interval: trigger.interval });
  }

  /**
   * Execute a cron job
   */
  private async executeCron(name: string, blockNumber?: bigint): Promise<void> {
    const registered = this.crons.get(name);
    if (!registered) return;

    const chainId = this.chainIds.get(registered.config.chain)!;
    const rpc = this.rpcClients.get(registered.config.chain);

    const startTime = Date.now();

    // Record execution start
    const execution = await this.db
      .insert(cronExecutions)
      .values({
        cronJobId: chainId,
        chainId,
        blockNumber,
        status: 'running',
      })
      .returning();

    try {
      const currentBlock = blockNumber ?? (rpc ? await rpc.getBlockNumber() : 0n);

      // Build context
      const context: CronHandlerContext = {
        db: this.buildDbContext(registered.config),
        rpc: this.buildRpcContext(rpc!),
        blockNumber: currentBlock,
        timestamp: new Date(),
        cronName: name,
        chainId,
      };

      await registered.handler(context);

      // Record success
      await this.db
        .update(cronExecutions)
        .set({
          status: 'success',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        })
        .where(eq(cronExecutions.id, execution[0].id));

      this.logger.debug(`Cron executed: ${name}`, {
        duration: `${Date.now() - startTime}ms`,
      });
    } catch (error) {
      // Record failure
      await this.db
        .update(cronExecutions)
        .set({
          status: 'failed',
          error: (error as Error).message,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        })
        .where(eq(cronExecutions.id, execution[0].id));

      this.logger.error(`Cron failed: ${name}`, { error: error as Error });
    }
  }

  /**
   * Update block checkpoint
   */
  private async updateBlockCheckpoint(
    name: string,
    chainId: number,
    blockNumber: bigint
  ): Promise<void> {
    // Get cron job ID
    const job = await this.db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.name, name))
      .limit(1);

    if (job.length === 0) return;

    await this.db
      .insert(cronCheckpoints)
      .values({
        cronJobId: job[0].id,
        chainId,
        lastBlockNumber: blockNumber,
      })
      .onConflictDoUpdate({
        target: [cronCheckpoints.cronJobId, cronCheckpoints.chainId],
        set: {
          lastBlockNumber: blockNumber,
          lastExecutedAt: new Date(),
        },
      });
  }

  /**
   * Build database context for cron handlers
   */
  private buildDbContext(config: CronConfig): DbContext {
    // Determine target schema
    const schema =
      config.schema?.type === 'chain'
        ? this.appSchema
        : this.cronsSchema;

    return {
      insert: (table: string) => ({
        values: async (data: object | object[]) => {
          const records = Array.isArray(data) ? data : [data];
          const columns = Object.keys(records[0]);
          const values = records
            .map(
              (r) =>
                `(${columns.map((c) => this.escapeValue((r as any)[c])).join(', ')})`
            )
            .join(', ');

          await this.db.execute(
            sql.raw(`
            INSERT INTO ${schema}.${table} (${columns.join(', ')})
            VALUES ${values}
            ON CONFLICT DO NOTHING
          `)
          );
        },
      }),
      update: (table: string) => ({
        set: (data: object) => ({
          where: async (condition: object) => {
            const setClause = Object.entries(data)
              .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
              .join(', ');
            const whereClause = Object.entries(condition)
              .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
              .join(' AND ');

            await this.db.execute(
              sql.raw(`
              UPDATE ${schema}.${table}
              SET ${setClause}
              WHERE ${whereClause}
            `)
            );
          },
        }),
      }),
      delete: (table: string) => ({
        where: async (condition: object) => {
          const whereClause = Object.entries(condition)
            .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
            .join(' AND ');

          await this.db.execute(
            sql.raw(`
            DELETE FROM ${schema}.${table}
            WHERE ${whereClause}
          `)
          );
        },
      }),
      find: <T>(table: string) => ({
        where: async (condition: object): Promise<T | null> => {
          const whereClause = Object.entries(condition)
            .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
            .join(' AND ');

          const result = await this.db.execute(
            sql.raw(`
            SELECT * FROM ${schema}.${table}
            WHERE ${whereClause}
            LIMIT 1
          `)
          );

          return (result as unknown[])[0] as T ?? null;
        },
        many: async (condition?: object): Promise<T[]> => {
          let query = `SELECT * FROM ${schema}.${table}`;

          if (condition && Object.keys(condition).length > 0) {
            const whereClause = Object.entries(condition)
              .map(([k, v]) => `${k} = ${this.escapeValue(v)}`)
              .join(' AND ');
            query += ` WHERE ${whereClause}`;
          }

          const result = await this.db.execute(sql.raw(query));
          return result as T[];
        },
      }),
      get: async <T>(table: string, id: string | number): Promise<T | null> => {
        const result = await this.db.execute(
          sql.raw(`
          SELECT * FROM ${schema}.${table}
          WHERE id = ${this.escapeValue(id)}
          LIMIT 1
        `)
        );

        return (result as unknown[])[0] as T ?? null;
      },
    };
  }

  /**
   * Build RPC context for cron handlers
   */
  private buildRpcContext(rpc: IRpcClient): CronHandlerContext['rpc'] {
    return {
      readContract: async (params) => rpc.readContract(params),
      getBalance: async (address) => rpc.getBalance(address),
      getBlock: async (blockNumber) => {
        const block = await rpc.getBlock(blockNumber ?? 0n);
        if (!block) throw new Error('Block not found');
        return {
          number: block.number,
          hash: block.hash,
          timestamp: block.timestamp,
          gasUsed: block.gasUsed,
          gasLimit: block.gasLimit,
        };
      },
      getTransactionReceipt: async (hash) => {
        const receipt = await rpc.getTransactionReceipt(hash);
        if (!receipt) throw new Error('Receipt not found');
        return {
          status: receipt.status,
          gasUsed: receipt.gasUsed,
          logs: [],
        };
      },
    };
  }

  /**
   * Escape a value for SQL
   */
  private escapeValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
}
