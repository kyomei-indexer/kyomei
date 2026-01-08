import Fastify, { type FastifyInstance } from "fastify";
import mercurius, { type IResolvers } from "mercurius";
import type { Database } from "@kyomei/database";
import type { ILogger } from "@kyomei/core";
import { SchemaGenerator } from "../graphql/SchemaGenerator.js";
import { sql } from "drizzle-orm";

/**
 * API server options
 */
export interface ApiServerOptions {
  db: Database;
  appSchema: string;
  logger: ILogger;
  host?: string;
  port?: number;
  graphqlPath?: string;
}

/**
 * Ponder-compatible GraphQL API server
 */
export class ApiServer {
  private readonly db: Database;
  private readonly appSchema: string;
  private readonly logger: ILogger;
  private readonly host: string;
  private readonly port: number;
  private readonly graphqlPath: string;
  private server: FastifyInstance | null = null;
  private schemaGenerator: SchemaGenerator;

  constructor(options: ApiServerOptions) {
    this.db = options.db;
    this.appSchema = options.appSchema;
    this.logger = options.logger.child({ module: "ApiServer" });
    this.host = options.host ?? "0.0.0.0";
    this.port = options.port ?? 42069;
    this.graphqlPath = options.graphqlPath ?? "/graphql";
    this.schemaGenerator = new SchemaGenerator(this.db, this.appSchema);
  }

  /**
   * Start the API server
   */
  async start(): Promise<void> {
    this.server = Fastify({
      logger: false,
    });

    // Health check endpoint
    this.server.get("/health", async () => {
      return { status: "ok", timestamp: new Date().toISOString() };
    });

    // Status endpoint
    this.server.get("/status", async () => {
      const tables = await this.getTables();
      return {
        status: "ok",
        schema: this.appSchema,
        tables: tables.length,
        timestamp: new Date().toISOString(),
      };
    });

    // Generate GraphQL schema from database tables
    const { schema, resolvers } = await this.schemaGenerator.generate();

    // Register GraphQL
    // Note: Type assertion needed for Mercurius IResolvers compatibility
    await this.server.register(mercurius, {
      schema,
      resolvers: resolvers as unknown as IResolvers,
      path: this.graphqlPath,
      graphiql: true,
      ide: "graphiql",
    });

    // Start server
    await this.server.listen({ host: this.host, port: this.port });

    this.logger.info(`API server started on http://${this.host}:${this.port}`);
    this.logger.info(
      `GraphQL endpoint: http://${this.host}:${this.port}${this.graphqlPath}`
    );
    this.logger.info(
      `GraphiQL: http://${this.host}:${this.port}${this.graphqlPath}`
    );
  }

  /**
   * Stop the API server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
      this.logger.info("API server stopped");
    }
  }

  /**
   * Get all tables in the app schema
   */
  private async getTables(): Promise<string[]> {
    const result = await this.db.execute(
      sql.raw(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = '${this.appSchema}'
      ORDER BY table_name
    `)
    );

    return (result as any[]).map((row) => row.table_name);
  }

  /**
   * Get the Fastify instance
   */
  getInstance(): FastifyInstance | null {
    return this.server;
  }
}
