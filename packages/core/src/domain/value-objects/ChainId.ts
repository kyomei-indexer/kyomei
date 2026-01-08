/**
 * Chain ID value object
 * Ensures chain ID is always a valid positive integer
 */
export class ChainId {
  private readonly _value: number;

  private constructor(value: number) {
    this._value = value;
  }

  /**
   * Create a ChainId from a number
   */
  static from(value: number): ChainId {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid chain ID: ${value}. Must be a positive integer.`);
    }
    return new ChainId(value);
  }

  /**
   * Create a ChainId from a bigint
   */
  static fromBigInt(value: bigint): ChainId {
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Invalid chain ID: ${value}. Must be a positive integer within safe range.`);
    }
    return new ChainId(Number(value));
  }

  /**
   * Get the chain ID as a number
   */
  get value(): number {
    return this._value;
  }

  /**
   * Get the chain ID as a bigint
   */
  toBigInt(): bigint {
    return BigInt(this._value);
  }

  /**
   * Check equality with another ChainId
   */
  equals(other: ChainId): boolean {
    return this._value === other._value;
  }

  /**
   * String representation
   */
  toString(): string {
    return this._value.toString();
  }

  /**
   * Common chain IDs
   */
  static readonly ETHEREUM_MAINNET = ChainId.from(1);
  static readonly OPTIMISM = ChainId.from(10);
  static readonly BSC = ChainId.from(56);
  static readonly GNOSIS = ChainId.from(100);
  static readonly POLYGON = ChainId.from(137);
  static readonly BASE = ChainId.from(8453);
  static readonly ARBITRUM_ONE = ChainId.from(42161);
  static readonly AVALANCHE = ChainId.from(43114);
  static readonly SEPOLIA = ChainId.from(11155111);
}
