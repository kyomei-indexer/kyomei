import type { Abi } from 'viem';

/**
 * Uniswap V2 Factory ABI (partial - key events only)
 */
export const UniswapV2FactoryAbi = [
  {
    type: 'event',
    name: 'PairCreated',
    inputs: [
      { type: 'address', name: 'token0', indexed: true },
      { type: 'address', name: 'token1', indexed: true },
      { type: 'address', name: 'pair', indexed: false },
      { type: 'uint256', name: 'pairIndex', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'getPair',
    stateMutability: 'view',
    inputs: [
      { type: 'address', name: 'tokenA' },
      { type: 'address', name: 'tokenB' },
    ],
    outputs: [{ type: 'address', name: 'pair' }],
  },
  {
    type: 'function',
    name: 'allPairs',
    stateMutability: 'view',
    inputs: [{ type: 'uint256', name: '' }],
    outputs: [{ type: 'address', name: 'pair' }],
  },
  {
    type: 'function',
    name: 'allPairsLength',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256', name: '' }],
  },
] as const satisfies Abi;

/**
 * Uniswap V2 Pair ABI (partial - key events and functions)
 */
export const UniswapV2PairAbi = [
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { type: 'address', name: 'sender', indexed: true },
      { type: 'uint256', name: 'amount0In', indexed: false },
      { type: 'uint256', name: 'amount1In', indexed: false },
      { type: 'uint256', name: 'amount0Out', indexed: false },
      { type: 'uint256', name: 'amount1Out', indexed: false },
      { type: 'address', name: 'to', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Sync',
    inputs: [
      { type: 'uint112', name: 'reserve0', indexed: false },
      { type: 'uint112', name: 'reserve1', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Mint',
    inputs: [
      { type: 'address', name: 'sender', indexed: true },
      { type: 'uint256', name: 'amount0', indexed: false },
      { type: 'uint256', name: 'amount1', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Burn',
    inputs: [
      { type: 'address', name: 'sender', indexed: true },
      { type: 'uint256', name: 'amount0', indexed: false },
      { type: 'uint256', name: 'amount1', indexed: false },
      { type: 'address', name: 'to', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { type: 'address', name: 'from', indexed: true },
      { type: 'address', name: 'to', indexed: true },
      { type: 'uint256', name: 'value', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'token0',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: '' }],
  },
  {
    type: 'function',
    name: 'token1',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: '' }],
  },
  {
    type: 'function',
    name: 'getReserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint112', name: 'reserve0' },
      { type: 'uint112', name: 'reserve1' },
      { type: 'uint32', name: 'blockTimestampLast' },
    ],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256', name: '' }],
  },
] as const satisfies Abi;

/**
 * ERC20 ABI (partial - for token metadata)
 */
export const ERC20Abi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string', name: '' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string', name: '' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8', name: '' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256', name: '' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256', name: '' }],
  },
] as const satisfies Abi;
