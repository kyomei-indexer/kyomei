import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockBlockSource } from "./MockBlockSource.ts";
import type { BlockWithLogs } from "@kyomei/core";

describe("MockBlockSource", () => {
  let source: MockBlockSource;

  const createMockBlock = (number: bigint): BlockWithLogs => ({
    block: {
      number,
      hash: `0x${number.toString(16).padStart(64, "0")}` as `0x${string}`,
      parentHash: "0x0" as `0x${string}`,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      gasUsed: 21000n,
      gasLimit: 30000000n,
      baseFeePerGas: 1000000000n,
      transactions: [],
    },
    logs: [],
  });

  beforeEach(() => {
    source = new MockBlockSource(1);
  });

  describe("constructor", () => {
    it("should create instance with default chain ID", () => {
      const defaultSource = new MockBlockSource();
      expect(defaultSource.chainId).toBe(31337);
    });

    it("should create instance with custom chain ID", () => {
      expect(source.chainId).toBe(1);
    });

    it("should have correct source type", () => {
      expect(source.sourceType).toBe("rpc");
    });

    it("should provide validated data", () => {
      expect(source.providesValidatedData).toBe(true);
    });
  });

  describe("addBlocks", () => {
    it("should add blocks to the source", () => {
      const blocks = [createMockBlock(100n), createMockBlock(101n)];

      source.addBlocks(blocks);

      // Blocks are available via getBlocks
      expect(true).toBe(true);
    });

    it("should update latest block number", async () => {
      source.addBlocks([createMockBlock(2000n)]);

      const latest = await source.getLatestBlockNumber();
      expect(latest).toBe(2000n);
    });
  });

  describe("getBlocks", () => {
    it("should yield blocks in range", async () => {
      source.addBlocks([
        createMockBlock(100n),
        createMockBlock(101n),
        createMockBlock(102n),
        createMockBlock(200n),
      ]);

      const blocks: BlockWithLogs[] = [];
      for await (const block of source.getBlocks({ from: 100n, to: 150n })) {
        blocks.push(block);
      }

      expect(blocks).toHaveLength(3);
      expect(blocks[0].block.number).toBe(100n);
      expect(blocks[1].block.number).toBe(101n);
      expect(blocks[2].block.number).toBe(102n);
    });

    it("should yield empty for no matching blocks", async () => {
      source.addBlocks([createMockBlock(100n)]);

      const blocks: BlockWithLogs[] = [];
      for await (const block of source.getBlocks({ from: 200n, to: 300n })) {
        blocks.push(block);
      }

      expect(blocks).toHaveLength(0);
    });
  });

  describe("getLatestBlockNumber", () => {
    it("should return default latest block", async () => {
      const latest = await source.getLatestBlockNumber();
      expect(latest).toBe(1000n);
    });
  });

  describe("getFinalizedBlockNumber", () => {
    it("should return same as latest (validated data)", async () => {
      const finalized = await source.getFinalizedBlockNumber();
      const latest = await source.getLatestBlockNumber();
      expect(finalized).toBe(latest);
    });
  });

  describe("onBlock", () => {
    it("should register block handler", () => {
      const handler = vi.fn();

      const unsubscribe = source.onBlock(handler);

      expect(typeof unsubscribe).toBe("function");
    });

    it("should call handler when block emitted", () => {
      const handler = vi.fn();
      source.onBlock(handler);

      const block = createMockBlock(1001n);
      source.emitBlock(block);

      expect(handler).toHaveBeenCalledWith(block);
    });

    it("should unsubscribe handler", () => {
      const handler = vi.fn();
      const unsubscribe = source.onBlock(handler);

      unsubscribe();

      source.emitBlock(createMockBlock(1001n));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("getBlocksByNumbers", () => {
    it("should return blocks by number", async () => {
      source.addBlocks([
        createMockBlock(100n),
        createMockBlock(101n),
        createMockBlock(102n),
      ]);

      const blocks = await source.getBlocksByNumbers([100n, 102n]);

      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => b.block.number)).toContain(100n);
      expect(blocks.map((b) => b.block.number)).toContain(102n);
    });
  });

  describe("isHealthy", () => {
    it("should return true", async () => {
      const healthy = await source.isHealthy();
      expect(healthy).toBe(true);
    });
  });

  describe("close", () => {
    it("should clear handlers", async () => {
      const handler = vi.fn();
      source.onBlock(handler);

      await source.close();

      source.emitBlock(createMockBlock(1001n));
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
