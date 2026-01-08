import { getAddress, isAddress } from 'viem';

/**
 * Ethereum address value object
 * Ensures addresses are always checksummed and valid
 */
export class Address {
  private readonly _value: `0x${string}`;

  private constructor(value: `0x${string}`) {
    this._value = value;
  }

  /**
   * Create an Address from a string
   */
  static from(value: string): Address {
    if (!isAddress(value)) {
      throw new Error(`Invalid Ethereum address: ${value}`);
    }
    // Always store as checksummed
    return new Address(getAddress(value) as `0x${string}`);
  }

  /**
   * Create an Address from a string, returning null if invalid
   */
  static tryFrom(value: string): Address | null {
    try {
      return Address.from(value);
    } catch {
      return null;
    }
  }

  /**
   * Get the checksummed address
   */
  get value(): `0x${string}` {
    return this._value;
  }

  /**
   * Get the lowercase address (for comparisons and storage)
   */
  get lowercase(): `0x${string}` {
    return this._value.toLowerCase() as `0x${string}`;
  }

  /**
   * Check equality with another Address
   */
  equals(other: Address): boolean {
    return this._value.toLowerCase() === other._value.toLowerCase();
  }

  /**
   * Check equality with a string
   */
  equalsString(other: string): boolean {
    try {
      return this.equals(Address.from(other));
    } catch {
      return false;
    }
  }

  /**
   * String representation (checksummed)
   */
  toString(): string {
    return this._value;
  }

  /**
   * Zero address
   */
  static readonly ZERO = Address.from('0x0000000000000000000000000000000000000000');

  /**
   * Dead address (commonly used for burns)
   */
  static readonly DEAD = Address.from('0x000000000000000000000000000000000000dEaD');
}
