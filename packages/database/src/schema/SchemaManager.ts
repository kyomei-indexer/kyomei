import { sql } from "drizzle-orm";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";
import type { Database } from "../connection.js";

/**
 * Schema metadata stored in the database
 */
interface SchemaMetadata {
  schemaName: string;
  version: string;
  createdAt: Date;
  migratedAt: Date;
  tables: string[];
}

/**
 * Table definition for schema management
 */
export interface TableDefinition {
  name: string;
  table: PgTable<TableConfig>;
}

/**
 * Schema definition with tables
 */
export interface SchemaDefinition {
  schemaName: string;
  tables: Record<string, PgTable<TableConfig>>;
}

/**
 * Manages schema versioning and migrations
 */
export class SchemaManager {
  private readonly metadataSchema = "kyomei_meta";
  private readonly metadataTable = "schema_versions";

  constructor(private readonly db: Database) {}

  /**
   * Initialize the schema manager metadata tables
   */
  async initialize(): Promise<void> {
    // Create metadata schema if not exists
    await this.db.execute(
      sql.raw(`CREATE SCHEMA IF NOT EXISTS ${this.metadataSchema}`)
    );

    // Create schema versions table
    await this.db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS ${this.metadataSchema}.${this.metadataTable} (
          schema_name VARCHAR(255) PRIMARY KEY,
          version VARCHAR(50) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          tables JSONB NOT NULL DEFAULT '[]'::jsonb
        )
      `)
    );
  }

  /**
   * Get current schema version
   */
  async getSchemaVersion(schemaName: string): Promise<string | null> {
    const result = await this.db.execute(
      sql.raw(`
        SELECT version FROM ${this.metadataSchema}.${this.metadataTable}
        WHERE schema_name = '${schemaName}'
      `)
    );

    const rows = result as unknown as Array<{ version: string }>;
    return rows[0]?.version ?? null;
  }

  /**
   * Create or migrate a schema to a new version
   */
  async migrateSchema(
    definition: SchemaDefinition,
    version: string
  ): Promise<{
    created: boolean;
    migrated: boolean;
    previousVersion: string | null;
  }> {
    const { schemaName } = definition;
    const currentVersion = await this.getSchemaVersion(schemaName);

    // Schema doesn't exist - create it
    if (currentVersion === null) {
      await this.createSchema(definition, version);
      return { created: true, migrated: false, previousVersion: null };
    }

    // Same version - nothing to do
    if (currentVersion === version) {
      return {
        created: false,
        migrated: false,
        previousVersion: currentVersion,
      };
    }

    // Different version - run migration
    await this.runMigration(definition, currentVersion, version);
    return { created: false, migrated: true, previousVersion: currentVersion };
  }

  /**
   * Create a new schema with all tables
   */
  private async createSchema(
    definition: SchemaDefinition,
    version: string
  ): Promise<void> {
    const { schemaName, tables } = definition;

    // Create schema
    await this.db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`));

    // Create all tables using Drizzle
    for (const [tableName, table] of Object.entries(tables)) {
      // Extract SQL from the Drizzle table definition
      const createSQL = this.generateCreateTableSQL(
        schemaName,
        tableName,
        table
      );
      await this.db.execute(sql.raw(createSQL));
    }

    // Record schema version
    const tableNames = Object.keys(tables);
    await this.db.execute(
      sql.raw(`
        INSERT INTO ${this.metadataSchema}.${this.metadataTable}
        (schema_name, version, tables)
        VALUES ('${schemaName}', '${version}', '${JSON.stringify(
        tableNames
      )}'::jsonb)
        ON CONFLICT (schema_name) DO UPDATE
        SET version = '${version}',
            migrated_at = NOW(),
            tables = '${JSON.stringify(tableNames)}'::jsonb
      `)
    );
  }

  /**
   * Run migration between versions
   */
  private async runMigration(
    definition: SchemaDefinition,
    _fromVersion: string,
    toVersion: string
  ): Promise<void> {
    const { schemaName, tables } = definition;

    // Get existing tables
    const existingTables = await this.getExistingTables(schemaName);
    const newTableNames = Object.keys(tables);

    // Create new tables
    for (const tableName of newTableNames) {
      if (!existingTables.includes(tableName)) {
        const createSQL = this.generateCreateTableSQL(
          schemaName,
          tableName,
          tables[tableName]
        );
        await this.db.execute(sql.raw(createSQL));
      }
    }

    // Add new columns to existing tables
    for (const tableName of newTableNames) {
      if (existingTables.includes(tableName)) {
        await this.migrateTableColumns(
          schemaName,
          tableName,
          tables[tableName]
        );
      }
    }

    // Update version
    await this.db.execute(
      sql.raw(`
        UPDATE ${this.metadataSchema}.${this.metadataTable}
        SET version = '${toVersion}',
            migrated_at = NOW(),
            tables = '${JSON.stringify(newTableNames)}'::jsonb
        WHERE schema_name = '${schemaName}'
      `)
    );
  }

  /**
   * Get existing tables in a schema
   */
  private async getExistingTables(schemaName: string): Promise<string[]> {
    const result = await this.db.execute(
      sql.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = '${schemaName}'
        ORDER BY table_name
      `)
    );

    return (result as unknown as Array<{ table_name: string }>).map(
      (r) => r.table_name
    );
  }

  /**
   * Migrate columns for an existing table
   */
  private async migrateTableColumns(
    schemaName: string,
    tableName: string,
    table: PgTable<TableConfig>
  ): Promise<void> {
    // Get existing columns
    const existingColumns = await this.getExistingColumns(
      schemaName,
      tableName
    );

    // Get new columns from table definition
    const columns = this.getTableColumns(table);

    // Add new columns
    for (const column of columns) {
      if (!existingColumns.includes(column.name)) {
        const columnSQL = this.generateColumnSQL(column);
        await this.db.execute(
          sql.raw(
            `ALTER TABLE ${schemaName}.${tableName} ADD COLUMN ${columnSQL}`
          )
        );
      }
    }
  }

  /**
   * Get existing columns in a table
   */
  private async getExistingColumns(
    schemaName: string,
    tableName: string
  ): Promise<string[]> {
    const result = await this.db.execute(
      sql.raw(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND table_name = '${tableName}'
        ORDER BY ordinal_position
      `)
    );

    return (result as unknown as Array<{ column_name: string }>).map(
      (r) => r.column_name
    );
  }

  /**
   * Generate CREATE TABLE SQL from Drizzle table
   */
  private generateCreateTableSQL(
    schemaName: string,
    tableName: string,
    table: PgTable<TableConfig>
  ): string {
    const columns = this.getTableColumns(table);
    const columnDefs = columns
      .map((c) => this.generateColumnSQL(c))
      .join(",\n  ");

    // Get primary key
    const pkColumns = columns.filter((c) => c.primaryKey).map((c) => c.name);
    const pkConstraint =
      pkColumns.length > 0 ? `,\n  PRIMARY KEY (${pkColumns.join(", ")})` : "";

    return `CREATE TABLE IF NOT EXISTS ${schemaName}.${tableName} (\n  ${columnDefs}${pkConstraint}\n)`;
  }

  /**
   * Extract column definitions from Drizzle table
   */
  private getTableColumns(table: PgTable<TableConfig>): Array<{
    name: string;
    type: string;
    notNull: boolean;
    primaryKey: boolean;
    defaultValue: string | null;
  }> {
    const columns: Array<{
      name: string;
      type: string;
      notNull: boolean;
      primaryKey: boolean;
      defaultValue: string | null;
    }> = [];

    // Access the internal column structure
    const tableConfig = (
      table as unknown as { _: { columns: Record<string, unknown> } }
    )._;

    if (tableConfig?.columns) {
      for (const [key, col] of Object.entries(tableConfig.columns)) {
        const column = col as {
          name: string;
          dataType: string;
          notNull: boolean;
          primary: boolean;
          default?: unknown;
          columnType: string;
        };

        columns.push({
          name: column.name ?? key,
          type: this.mapDrizzleType(column.columnType, column.dataType),
          notNull: column.notNull ?? false,
          primaryKey: column.primary ?? false,
          defaultValue:
            column.default !== undefined
              ? this.formatDefaultValue(column.default)
              : null,
        });
      }
    }

    return columns;
  }

  /**
   * Map Drizzle column type to PostgreSQL type
   */
  private mapDrizzleType(columnType: string, dataType: string): string {
    const typeMap: Record<string, string> = {
      PgVarchar: "VARCHAR",
      PgText: "TEXT",
      PgInteger: "INTEGER",
      PgBigInt53: "BIGINT",
      PgBigInt64: "BIGINT",
      PgNumeric: "NUMERIC",
      PgReal: "REAL",
      PgDoublePrecision: "DOUBLE PRECISION",
      PgBoolean: "BOOLEAN",
      PgTimestamp: "TIMESTAMP",
      PgTimestampString: "TIMESTAMPTZ",
      PgDate: "DATE",
      PgJson: "JSON",
      PgJsonb: "JSONB",
      PgSerial: "SERIAL",
      PgBigSerial: "BIGSERIAL",
    };

    return typeMap[columnType] ?? dataType ?? "TEXT";
  }

  /**
   * Generate column SQL
   */
  private generateColumnSQL(column: {
    name: string;
    type: string;
    notNull: boolean;
    primaryKey: boolean;
    defaultValue: string | null;
  }): string {
    let sql = `${column.name} ${column.type}`;

    if (column.notNull && !column.primaryKey) {
      sql += " NOT NULL";
    }

    if (column.defaultValue !== null) {
      sql += ` DEFAULT ${column.defaultValue}`;
    }

    return sql;
  }

  /**
   * Format default value for SQL
   */
  private formatDefaultValue(value: unknown): string {
    if (value === null) return "NULL";
    if (typeof value === "string") return `'${value}'`;
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (value instanceof Date) return `'${value.toISOString()}'`;

    // Handle SQL expressions
    if (typeof value === "object" && value !== null) {
      const sqlExpr = value as { sql?: string };
      if (sqlExpr.sql) return sqlExpr.sql;
    }

    return String(value);
  }

  /**
   * Drop a schema (use with caution!)
   */
  async dropSchema(schemaName: string): Promise<void> {
    await this.db.execute(
      sql.raw(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
    );
    await this.db.execute(
      sql.raw(`
        DELETE FROM ${this.metadataSchema}.${this.metadataTable}
        WHERE schema_name = '${schemaName}'
      `)
    );
  }

  /**
   * List all managed schemas
   */
  async listSchemas(): Promise<SchemaMetadata[]> {
    const result = await this.db.execute(
      sql.raw(`
        SELECT schema_name, version, created_at, migrated_at, tables
        FROM ${this.metadataSchema}.${this.metadataTable}
        ORDER BY schema_name
      `)
    );

    return (
      result as unknown as Array<{
        schema_name: string;
        version: string;
        created_at: Date;
        migrated_at: Date;
        tables: string[];
      }>
    ).map((row) => ({
      schemaName: row.schema_name,
      version: row.version,
      createdAt: row.created_at,
      migratedAt: row.migrated_at,
      tables: row.tables,
    }));
  }
}
