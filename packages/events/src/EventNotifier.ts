import type postgres from 'postgres';
import type { SyncEvent } from './types.ts';

/**
 * Event notifier using PostgreSQL NOTIFY
 * Publisher side for event-driven sync-to-processor communication
 */
export class EventNotifier {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * Send notification to a channel
   */
  async notify(channel: string, payload: SyncEvent): Promise<void> {
    try {
      // Serialize bigint for JSON
      const serialized = JSON.stringify(payload, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );

      await this.sql.notify(channel, serialized);
    } catch (error) {
      // Log but don't throw - notifications are best-effort
      console.warn('Failed to send notification:', error);
    }
  }
}
