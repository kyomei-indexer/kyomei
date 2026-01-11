/**
 * Sync event types for communication between Syncer and Processor
 */
export type SyncEventType =
  | 'block_range_synced'
  | 'live_block_synced'
  | 'factory_child_discovered';

/**
 * Sync event payload
 */
export interface SyncEvent {
  type: SyncEventType;
  chainId: number;
  blockNumber: bigint;
  timestamp: Date;
}
