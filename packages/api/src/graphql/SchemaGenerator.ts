import { sql } from "drizzle-orm";
import type { Database } from "@kyomei/database";

// ============================================================================
// Types
// ============================================================================

/**
 * Field definition for schema generation
 */
export interface FieldDefinition {
  name: string;
  type: string;
  nullable: boolean;
}

/**
 * Table schema for generation
 */
export interface TableSchema {
  name: string;
  fields: FieldDefinition[];
}

/**
 * PostgreSQL column info from information_schema
 */
interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

/**
 * Database row type for queries
 */
type DatabaseRow = Record<string, unknown>;

/**
 * Resolver function type
 */
type ResolverFn = (
  parent: unknown,
  args: Record<string, unknown>,
  context: unknown
) => Promise<unknown> | unknown;

/**
 * Resolvers object type
 * Index signature added for Mercurius compatibility
 */
interface Resolvers {
  [key: string]: unknown;
  Query: Record<string, ResolverFn>;
  BigInt: {
    __serialize: (value: bigint) => string;
    __parseValue: (value: string) => bigint;
    __parseLiteral: (ast: { value: string }) => bigint;
  };
  JSON: {
    __serialize: (value: unknown) => unknown;
    __parseValue: (value: unknown) => unknown;
    __parseLiteral: (ast: { value: unknown }) => unknown;
  };
}

/**
 * Pagination args type
 */
interface PaginationArgs {
  first?: number;
  after?: string;
  orderBy?: string;
  orderDirection?: string;
  where?: Record<string, unknown>;
}

/**
 * Connection edge type
 */
interface Edge<T> {
  node: T;
  cursor: string;
}

/**
 * Page info type
 */
interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

/**
 * Connection type for pagination
 */
interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
  totalCount: number;
}

// ============================================================================
// Schema Generator
// ============================================================================

/**
 * GraphQL schema generator
 * Dynamically creates GraphQL schema from database tables
 */
export class SchemaGenerator {
  constructor(
    private readonly db: Database,
    private readonly schema: string
  ) {}

  /**
   * Generate GraphQL schema and resolvers from database
   */
  async generate(): Promise<{ schema: string; resolvers: Resolvers }> {
    const tables = await this.getTableSchemas();
    const schema = this.buildSchema(tables);
    const resolvers = this.buildResolvers(tables);

    return { schema, resolvers };
  }

  /**
   * Get table schemas from database
   */
  private async getTableSchemas(): Promise<TableSchema[]> {
    const result = await this.db.execute(
      sql.raw(`
      SELECT 
        t.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable
      FROM information_schema.tables t
      JOIN information_schema.columns c 
        ON t.table_name = c.table_name 
        AND t.table_schema = c.table_schema
      WHERE t.table_schema = '${this.schema}'
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name, c.ordinal_position
    `)
    );

    const tableMap = new Map<string, FieldDefinition[]>();
    const rows = result as unknown as ColumnInfo[];

    for (const row of rows) {
      const tableName = row.table_name;
      const field: FieldDefinition = {
        name: row.column_name,
        type: this.sqlToGraphQLType(row.data_type),
        nullable: row.is_nullable === "YES",
      };

      if (!tableMap.has(tableName)) {
        tableMap.set(tableName, []);
      }
      tableMap.get(tableName)!.push(field);
    }

    return Array.from(tableMap.entries()).map(([name, fields]) => ({
      name,
      fields,
    }));
  }

  /**
   * Build GraphQL schema string
   */
  private buildSchema(tables: TableSchema[]): string {
    const types = tables.map((table) => this.buildType(table)).join("\n\n");
    const queries = tables.map((table) => this.buildQueryFields(table)).join("\n");

    return `
      scalar BigInt
      scalar JSON

      ${types}

      type PageInfo {
        hasNextPage: Boolean!
        hasPreviousPage: Boolean!
        startCursor: String
        endCursor: String
      }

      ${tables.map((t) => this.buildConnectionType(t)).join("\n\n")}

      type Query {
        ${queries}
        _meta: Meta
      }

      type Meta {
        status: String!
        block: BlockMeta
      }

      type BlockMeta {
        number: BigInt!
        timestamp: BigInt!
      }
    `;
  }

  /**
   * Build GraphQL type for a table
   */
  private buildType(table: TableSchema): string {
    const typeName = this.toPascalCase(table.name);
    const fields = table.fields
      .map((f) => `  ${this.toCamelCase(f.name)}: ${f.type}${f.nullable ? "" : "!"}`)
      .join("\n");

    return `type ${typeName} {\n${fields}\n}`;
  }

  /**
   * Build connection type for pagination
   */
  private buildConnectionType(table: TableSchema): string {
    const typeName = this.toPascalCase(table.name);

    return `
      type ${typeName}Connection {
        edges: [${typeName}Edge!]!
        pageInfo: PageInfo!
        totalCount: Int!
      }

      type ${typeName}Edge {
        node: ${typeName}!
        cursor: String!
      }
    `;
  }

  /**
   * Build query fields for a table
   */
  private buildQueryFields(table: TableSchema): string {
    const typeName = this.toPascalCase(table.name);
    const pluralName = this.pluralize(this.toCamelCase(table.name));

    return `
        ${this.toCamelCase(table.name)}(id: ID!): ${typeName}
        ${pluralName}(
          first: Int
          after: String
          last: Int
          before: String
          orderBy: String
          orderDirection: String
          where: JSON
        ): ${typeName}Connection!
    `;
  }

  /**
   * Build resolvers for all tables
   */
  private buildResolvers(tables: TableSchema[]): Resolvers {
    const Query: Record<string, ResolverFn> = {
      _meta: async () => ({
        status: "synced",
        block: {
          number: BigInt(0),
          timestamp: BigInt(Date.now() / 1000),
        },
      }),
    };

    for (const table of tables) {
      const singularName = this.toCamelCase(table.name);
      const pluralName = this.pluralize(singularName);

      // Single item resolver
      Query[singularName] = async (_: unknown, args: Record<string, unknown>) => {
        const id = args.id as string;
        const result = await this.db.execute(
          sql.raw(
            `SELECT * FROM ${this.schema}.${table.name} WHERE id = '${id}' LIMIT 1`
          )
        );
        const rows = result as DatabaseRow[];
        const row = rows[0];
        return row ? this.transformRow(row) : null;
      };

      // List resolver with pagination
      Query[pluralName] = async (
        _: unknown,
        args: Record<string, unknown>
      ): Promise<Connection<DatabaseRow>> => {
        const paginationArgs = args as PaginationArgs;
        const limit = paginationArgs.first ?? 100;
        const orderBy = paginationArgs.orderBy ?? "id";
        const orderDir =
          paginationArgs.orderDirection?.toUpperCase() === "DESC" ? "DESC" : "ASC";

        // Build where clause
        let whereClause = "";
        if (paginationArgs.where && Object.keys(paginationArgs.where).length > 0) {
          const conditions = Object.entries(paginationArgs.where)
            .map(([key, value]) => `${key} = '${String(value)}'`)
            .join(" AND ");
          whereClause = `WHERE ${conditions}`;
        }

        // Get total count
        const countResult = await this.db.execute(
          sql.raw(
            `SELECT COUNT(*) as count FROM ${this.schema}.${table.name} ${whereClause}`
          )
        );
        const countRows = countResult as unknown as Array<{ count: string }>;
        const totalCount = Number(countRows[0]?.count ?? 0);

        // Get items
        const result = await this.db.execute(
          sql.raw(`
            SELECT * FROM ${this.schema}.${table.name}
            ${whereClause}
            ORDER BY ${orderBy} ${orderDir}
            LIMIT ${limit + 1}
          `)
        );

        const allRows = result as DatabaseRow[];
        const rows = allRows.slice(0, limit);
        const hasNextPage = allRows.length > limit;

        return {
          edges: rows.map((row, index) => ({
            node: this.transformRow(row),
            cursor: Buffer.from(`cursor:${index}`).toString("base64"),
          })),
          pageInfo: {
            hasNextPage,
            hasPreviousPage: false,
            startCursor:
              rows.length > 0 ? Buffer.from("cursor:0").toString("base64") : null,
            endCursor:
              rows.length > 0
                ? Buffer.from(`cursor:${rows.length - 1}`).toString("base64")
                : null,
          },
          totalCount,
        };
      };
    }

    return {
      Query,
      BigInt: {
        __serialize: (value: bigint) => value.toString(),
        __parseValue: (value: string) => BigInt(value),
        __parseLiteral: (ast: { value: string }) => BigInt(ast.value),
      },
      JSON: {
        __serialize: (value: unknown) => value,
        __parseValue: (value: unknown) => value,
        __parseLiteral: (ast: { value: unknown }) => ast.value,
      },
    };
  }

  /**
   * Transform database row to GraphQL format
   */
  private transformRow(row: DatabaseRow): DatabaseRow {
    const transformed: DatabaseRow = {};

    for (const [key, value] of Object.entries(row)) {
      const camelKey = this.toCamelCase(key);
      transformed[camelKey] = value;
    }

    return transformed;
  }

  /**
   * Convert SQL type to GraphQL type
   */
  private sqlToGraphQLType(sqlType: string): string {
    const type = sqlType.toLowerCase();

    if (type.includes("int") && type !== "integer") return "BigInt";
    if (type === "integer" || type === "smallint") return "Int";
    if (type === "bigint") return "BigInt";
    if (type.includes("numeric") || type.includes("decimal")) return "BigInt";
    if (type === "boolean") return "Boolean";
    if (type.includes("float") || type === "real" || type === "double") return "Float";
    if (type === "json" || type === "jsonb") return "JSON";

    return "String";
  }

  /**
   * Convert snake_case to camelCase
   */
  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  }

  /**
   * Convert snake_case to PascalCase
   */
  private toPascalCase(str: string): string {
    const camel = this.toCamelCase(str);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
  }

  /**
   * Simple pluralization
   */
  private pluralize(str: string): string {
    if (str.endsWith("s")) return str + "es";
    if (str.endsWith("y")) return str.slice(0, -1) + "ies";
    return str + "s";
  }
}
