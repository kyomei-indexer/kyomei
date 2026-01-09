import { describe, it, expect, beforeEach } from "vitest";
import { EventDecoder } from "./EventDecoder.ts";
import type { Abi } from "abitype";

describe("EventDecoder", () => {
  const ERC20Abi: Abi = [
    {
      type: "event",
      name: "Transfer",
      inputs: [
        { type: "address", name: "from", indexed: true },
        { type: "address", name: "to", indexed: true },
        { type: "uint256", name: "value", indexed: false },
      ],
    },
    {
      type: "event",
      name: "Approval",
      inputs: [
        { type: "address", name: "owner", indexed: true },
        { type: "address", name: "spender", indexed: true },
        { type: "uint256", name: "value", indexed: false },
      ],
    },
  ];

  let decoder: EventDecoder;

  beforeEach(() => {
    decoder = new EventDecoder();
    decoder.registerContract("ERC20", ERC20Abi);
  });

  describe("registerContract", () => {
    it("should register contract ABI", () => {
      const newDecoder = new EventDecoder();
      newDecoder.registerContract("Token", ERC20Abi);

      expect(newDecoder.getRegisteredContracts()).toContain("Token");
    });

    it("should handle multiple contracts", () => {
      const newDecoder = new EventDecoder();
      newDecoder.registerContract("Token1", ERC20Abi);
      newDecoder.registerContract("Token2", ERC20Abi);

      expect(newDecoder.getRegisteredContracts()).toContain("Token1");
      expect(newDecoder.getRegisteredContracts()).toContain("Token2");
    });
  });

  describe("unregisterContract", () => {
    it("should unregister contract", () => {
      const newDecoder = new EventDecoder();
      newDecoder.registerContract("Token", ERC20Abi);

      expect(newDecoder.getRegisteredContracts()).toContain("Token");

      newDecoder.unregisterContract("Token");

      expect(newDecoder.getRegisteredContracts()).not.toContain("Token");
    });
  });

  describe("getRegisteredContracts", () => {
    it("should return list of registered contracts", () => {
      const contracts = decoder.getRegisteredContracts();

      expect(contracts).toContain("ERC20");
    });

    it("should return empty array when no contracts", () => {
      const newDecoder = new EventDecoder();

      expect(newDecoder.getRegisteredContracts()).toEqual([]);
    });
  });

  describe("decode", () => {
    it("should decode known event", () => {
      // Transfer(address,address,uint256) topic0
      const transferTopic =
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as `0x${string}`;

      const log = {
        blockNumber: 1000n,
        blockHash: "0x1234" as `0x${string}`,
        transactionHash: "0x5678" as `0x${string}`,
        transactionIndex: 0,
        logIndex: 0,
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`,
        topic0: transferTopic,
        topic1:
          "0x000000000000000000000000deadbeef00000000000000000000000000000001" as `0x${string}`,
        topic2:
          "0x000000000000000000000000deadbeef00000000000000000000000000000002" as `0x${string}`,
        topic3: null,
        data: "0x0000000000000000000000000000000000000000000000000000000000000064" as `0x${string}`,
        removed: false,
      };

      const decoded = decoder.decode(log);

      expect(decoded).toBeDefined();
      expect(decoded?.eventName).toBe("Transfer");
    });

    it("should return null for unknown topic", () => {
      const log = {
        blockNumber: 1000n,
        blockHash: "0x1234" as `0x${string}`,
        transactionHash: "0x5678" as `0x${string}`,
        transactionIndex: 0,
        logIndex: 0,
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`,
        topic0: "0xunknown0000000000000000000000000000000000000000000000000000" as `0x${string}`,
        topic1: null,
        topic2: null,
        topic3: null,
        data: "0x" as `0x${string}`,
        removed: false,
      };

      const decoded = decoder.decode(log);

      expect(decoded).toBeNull();
    });

    it("should return null for log without topic0", () => {
      const log = {
        blockNumber: 1000n,
        blockHash: "0x1234" as `0x${string}`,
        transactionHash: "0x5678" as `0x${string}`,
        transactionIndex: 0,
        logIndex: 0,
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`,
        topic0: null,
        topic1: null,
        topic2: null,
        topic3: null,
        data: "0x" as `0x${string}`,
        removed: false,
      };

      const decoded = decoder.decode(log as any);

      expect(decoded).toBeNull();
    });
  });
});
