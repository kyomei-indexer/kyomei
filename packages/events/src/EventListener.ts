import type postgres from 'postgres';
import type { SyncEvent } from './types.ts';

/**
 * Event listener using PostgreSQL LISTEN
 * Consumer side for event-driven sync-to-processor communication
 */
export class EventListener {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * Listen to a channel and handle incoming events
   */
  async listen(
    channel: string,
    handler: (event: SyncEvent) => void
  ): Promise<void> {
    await this.sql.listen(channel, (payload) => {
      try {
        const parsed = JSON.parse(payload);

        // Parse bigint strings back to bigint
        const event: SyncEvent = {
          ...parsed,
          blockNumber: BigInt(parsed.blockNumber),
          timestamp: new Date(parsed.timestamp),
        };

        handler(event);
      } catch (error) {
        console.warn('Failed to parse notification:', error);
      }
    });
  }
}
