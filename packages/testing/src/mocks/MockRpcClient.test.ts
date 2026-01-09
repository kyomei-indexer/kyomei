import { describe, it, expect, beforeEach } from "vitest";
import { MockRpcClient } from "./MockRpcClient.ts";
import type { Block, Log } from "@kyomei/core";

describe("MockRpcClient", () => {
  let client: MockRpcClient;

  beforeEach(() => {
    client = new MockRpcClient(1);
  });

  describe("constructor", () => {
    it("should create instance with default chain ID", () => {
      const defaultClient = new MockRpcClient();
      expect(defaultClient.chainId).toBe(31337);
    });

    it("should create instance with custom chain ID", () => {
      expect(client.chainId).toBe(1);
    });

    it("should have mock URL", () => {
      expect(client.url).toBe("mock://localhost");
    });
  });

  describe("getBlockNumber", () => {
    it("should return default block number", async () => {
      const blockNumber = await client.getBlockNumber();
      expect(blockNumber).toBe(1000n);
    });

    it("should return updated block number", async () => {
      client.setBlockNumber(5000n);
      const blockNumber = await client.getBlockNumber();
      expect(blockNumber).toBe(5000n);
    });
  });

  describe("getFinalizedBlockNumber", () => {
    it("should return finalized block (10 behind latest)", async () => {
      client.setBlockNumber(1000n);
      const finalized = await client.getFinalizedBlockNumber();
      expect(finalized).toBe(990n);
    });
  });

  describe("getBlock", () => {
    it("should return added block", async () => {
      const block: Block = {
        number: 100n,
        hash: "0x1234" as `0x${string}`,
        parentHash: "0x0000" as `0x${string}`,
        timestamp: 1234567890n,
        gasUsed: 21000n,
        gasLimit: 30000000n,
        baseFeePerGas: 1000000000n,
        transactions: [],
      };

      client.addBlock(block);

      const result = await client.getBlock(100n);
      expect(result).toEqual(block);
    });

    it("should return null for unknown block", async () => {
      const result = await client.getBlock(999999n);
      expect(result).toBeNull();
    });
  });

  describe("getBlockByHash", () => {
    it("should return block by hash", async () => {
      const block: Block = {
        number: 100n,
        hash: "0xabcdef" as `0x${string}`,
        parentHash: "0x0000" as `0x${string}`,
        timestamp: 1234567890n,
        gasUsed: 21000n,
        gasLimit: 30000000n,
        baseFeePerGas: 1000000000n,
        transactions: [],
      };

      client.addBlock(block);

      const result = await client.getBlockByHash("0xabcdef" as `0x${string}`);
      expect(result).toEqual(block);
    });

    it("should return null for unknown hash", async () => {
      const result = await client.getBlockByHash("0xunknown" as `0x${string}`);
      expect(result).toBeNull();
    });
  });

  describe("getLogs", () => {
    it("should return logs in block range", async () => {
      const logs: Log[] = [
        {
          blockNumber: 100n,
          blockHash: "0x1234" as `0x${string}`,
          transactionHash: "0x5678" as `0x${string}`,
          transactionIndex: 0,
          logIndex: 0,
          address: "0xtoken" as `0x${string}`,
          topics: ["0xtopic" as `0x${string}`],
          data: "0x" as `0x${string}`,
          removed: false,
        },
        {
          blockNumber: 200n,
          blockHash: "0x2345" as `0x${string}`,
          transactionHash: "0x6789" as `0x${string}`,
          transactionIndex: 0,
          logIndex: 0,
          address: "0xtoken" as `0x${string}`,
          topics: ["0xtopic" as `0x${string}`],
          data: "0x" as `0x${string}`,
          removed: false,
        },
      ];

      client.addLogs(logs);

      const result = await client.getLogs({
        fromBlock: 50n,
        toBlock: 150n,
      });

      expect(result).toHaveLength(1);
      expect(result[0].blockNumber).toBe(100n);
    });

    it("should filter logs by address", async () => {
      const logs: Log[] = [
        {
          blockNumber: 100n,
          blockHash: "0x1234" as `0x${string}`,
          transactionHash: "0x5678" as `0x${string}`,
          transactionIndex: 0,
          logIndex: 0,
          address: "0xtoken1" as `0x${string}`,
          topics: [],
          data: "0x" as `0x${string}`,
          removed: false,
        },
        {
          blockNumber: 100n,
          blockHash: "0x1234" as `0x${string}`,
          transactionHash: "0x5678" as `0x${string}`,
          transactionIndex: 0,
          logIndex: 1,
          address: "0xtoken2" as `0x${string}`,
          topics: [],
          data: "0x" as `0x${string}`,
          removed: false,
        },
      ];

      client.addLogs(logs);

      const result = await client.getLogs({
        fromBlock: 0n,
        toBlock: 200n,
        address: "0xtoken1" as `0x${string}`,
      });

      expect(result).toHaveLength(1);
      expect(result[0].address).toBe("0xtoken1");
    });
  });

  describe("getBalance", () => {
    it("should return set balance", async () => {
      client.setBalance("0xuser", 1000000000000000000n);

      const balance = await client.getBalance("0xuser" as `0x${string}`);
      expect(balance).toBe(1000000000000000000n);
    });

    it("should return 0 for unknown address", async () => {
      const balance = await client.getBalance("0xunknown" as `0x${string}`);
      expect(balance).toBe(0n);
    });

    it("should be case-insensitive", async () => {
      client.setBalance("0xUSER", 100n);

      const balance = await client.getBalance("0xuser" as `0x${string}`);
      expect(balance).toBe(100n);
    });
  });

  describe("readContract", () => {
    it("should return set contract data", async () => {
      client.setContractData("0xtoken:name", "Test Token");

      const result = await client.readContract<string>({
        address: "0xtoken" as `0x${string}`,
        abi: [],
        functionName: "name",
      });

      expect(result).toBe("Test Token");
    });

    it("should throw for missing contract data", async () => {
      await expect(
        client.readContract({
          address: "0xtoken" as `0x${string}`,
          abi: [],
          functionName: "unknown",
        })
      ).rejects.toThrow("No mock data");
    });
  });

  describe("batch", () => {
    it("should execute batch calls", async () => {
      client.setBlockNumber(12345n);
      client.setBalance("0xuser", 9999n);

      const results = await client.batch([
        { method: "eth_blockNumber", params: [] },
        { method: "eth_getBalance", params: ["0xuser", "latest"] },
      ]);

      expect(results).toHaveLength(2);
    });
  });

  describe("isHealthy", () => {
    it("should return true", async () => {
      const healthy = await client.isHealthy();
      expect(healthy).toBe(true);
    });
  });
});
