import { describe, it, expect } from "vitest";
import { AbiParser } from "./AbiParser.ts";
import type { Abi } from "abitype";

describe("AbiParser", () => {
  const testAbi: Abi = [
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
    {
      type: "function",
      name: "transfer",
      inputs: [
        { type: "address", name: "to" },
        { type: "uint256", name: "amount" },
      ],
      outputs: [{ type: "bool" }],
      stateMutability: "nonpayable",
    },
  ];

  const parser = new AbiParser();

  describe("parseEvents", () => {
    it("should parse events from ABI", () => {
      const events = parser.parseEvents(testAbi);

      expect(events).toHaveLength(2);
      expect(events.map((e) => e.name)).toContain("Transfer");
      expect(events.map((e) => e.name)).toContain("Approval");
    });

    it("should ignore non-event items", () => {
      const events = parser.parseEvents(testAbi);

      expect(events.every((e) => e.name !== "transfer")).toBe(true);
    });

    it("should generate event signatures", () => {
      const events = parser.parseEvents(testAbi);
      const transfer = events.find((e) => e.name === "Transfer");

      expect(transfer?.signature).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it("should parse event inputs", () => {
      const events = parser.parseEvents(testAbi);
      const transfer = events.find((e) => e.name === "Transfer");

      expect(transfer?.inputs).toHaveLength(3);
      expect(transfer?.inputs[0].name).toBe("from");
      expect(transfer?.inputs[0].indexed).toBe(true);
      expect(transfer?.inputs[2].indexed).toBe(false);
    });
  });

  describe("getEvent", () => {
    it("should return event by name", () => {
      const event = parser.getEvent(testAbi, "Transfer");

      expect(event).toBeDefined();
      expect(event?.name).toBe("Transfer");
      expect(event?.inputs).toHaveLength(3);
    });

    it("should return null for unknown event", () => {
      const event = parser.getEvent(testAbi, "Unknown");

      expect(event).toBeNull();
    });

    it("should return null for function name", () => {
      const event = parser.getEvent(testAbi, "transfer");

      expect(event).toBeNull();
    });
  });

  describe("getEventSignatureString", () => {
    it("should generate signature string", () => {
      const events = parser.parseEvents(testAbi);
      const transfer = events.find((e) => e.name === "Transfer");

      expect(transfer?.signatureString).toBe(
        "Transfer(address,address,uint256)"
      );
    });
  });
});
