/**
 * 32-byte hash value object (for block hashes, tx hashes)
 */
export class Hash {
  private readonly _value: `0x${string}`;

  private constructor(value: `0x${string}`) {
    this._value = value;
  }

  /**
   * Create a Hash from a string
   */
  static from(value: string): Hash {
    if (!Hash.isValid(value)) {
      throw new Error(`Invalid hash: ${value}. Must be a 66-character hex string.`);
    }
    return new Hash(value.toLowerCase() as `0x${string}`);
  }

  /**
   * Validate a hash string
   */
  static isValid(value: string): value is `0x${string}` {
    return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
  }

  /**
   * Create a Hash from a string, returning null if invalid
   */
  static tryFrom(value: string): Hash | null {
    try {
      return Hash.from(value);
    } catch {
      return null;
    }
  }

  /**
   * Get the hash value
   */
  get value(): `0x${string}` {
    return this._value;
  }

  /**
   * Check equality with another Hash
   */
  equals(other: Hash): boolean {
    return this._value === other._value;
  }

  /**
   * Check equality with a string
   */
  equalsString(other: string): boolean {
    try {
      return this.equals(Hash.from(other));
    } catch {
      return false;
    }
  }

  /**
   * String representation
   */
  toString(): string {
    return this._value;
  }

  /**
   * Get short representation (0x1234...abcd)
   */
  toShortString(): string {
    return `${this._value.slice(0, 6)}...${this._value.slice(-4)}`;
  }

  /**
   * Zero hash
   */
  static readonly ZERO = Hash.from(
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  );
}
