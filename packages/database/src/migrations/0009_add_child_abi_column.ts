import type { Database } from '../connection.ts';
import { sql } from 'drizzle-orm';

/**
 * Migration 0009: Add child_abi column to factory_children table
 * Allows storing custom ABIs for factory-created child contracts
 */

export async function up(db: Database): Promise<void> {
  // Add child_abi column for storing custom child ABIs
  await db.execute(sql`
    ALTER TABLE kyomei_sync.factory_children
    ADD COLUMN IF NOT EXISTS child_abi TEXT
  `);
}

export async function down(db: Database): Promise<void> {
  // Remove child_abi column
  await db.execute(sql`
    ALTER TABLE kyomei_sync.factory_children
    DROP COLUMN IF EXISTS child_abi
  `);
}

export const migration = { up, down };
