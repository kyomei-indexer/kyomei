import { describe, it, expect, vi } from "vitest";
import { Kyomei, createKyomei, kyomeiFromConfig } from "./Kyomei.ts";
import type { Abi } from "abitype";

describe("Kyomei", () => {
  const TestAbi = [
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
  ] as const satisfies Abi;

  const FactoryAbi = [
    {
      type: "event",
      name: "PairCreated",
      inputs: [
        { type: "address", name: "token0", indexed: true },
        { type: "address", name: "token1", indexed: true },
        { type: "address", name: "pair", indexed: false },
        { type: "uint256", name: "pairIndex", indexed: false },
      ],
    },
  ] as const satisfies Abi;

  const contracts = {
    Token: { abi: TestAbi },
    Factory: { abi: FactoryAbi },
  } as const;

  describe("constructor", () => {
    it("should create instance with contracts", () => {
      const kyomei = new Kyomei(contracts);

      expect(kyomei.getContracts()).toBe(contracts);
    });
  });

  describe("on", () => {
    it("should register a sequential handler", () => {
      const kyomei = new Kyomei(contracts);
      const handler = vi.fn();

      kyomei.on("Token:Transfer", handler);

      const registrations = kyomei.getRegistrations();
      expect(registrations).toHaveLength(1);
      expect(registrations[0].contractName).toBe("Token");
      expect(registrations[0].eventName).toBe("Transfer");
      expect(registrations[0].mode).toBe("sequential");
    });

    it("should allow chaining", () => {
      const kyomei = new Kyomei(contracts);

      const result = kyomei
        .on("Token:Transfer", vi.fn())
        .on("Token:Approval", vi.fn());

      expect(result).toBe(kyomei);
      expect(kyomei.getRegistrations()).toHaveLength(2);
    });

    it("should throw for invalid event key format", () => {
      const kyomei = new Kyomei(contracts);

      expect(() => {
        // @ts-expect-error - testing invalid input
        kyomei.on("InvalidKey", vi.fn());
      }).toThrow("Invalid event key");
    });

    it("should throw for unknown contract", () => {
      const kyomei = new Kyomei(contracts);

      expect(() => {
        // @ts-expect-error - testing invalid input
        kyomei.on("Unknown:Transfer", vi.fn());
      }).toThrow("Unknown contract");
    });
  });

  describe("onParallel", () => {
    it("should register a parallel handler", () => {
      const kyomei = new Kyomei(contracts);
      const handler = vi.fn();

      kyomei.onParallel("Token:Transfer", handler);

      const registrations = kyomei.getRegistrations();
      expect(registrations).toHaveLength(1);
      expect(registrations[0].mode).toBe("parallel");
    });

    it("should allow mixing sequential and parallel handlers", () => {
      const kyomei = new Kyomei(contracts);

      kyomei
        .on("Token:Transfer", vi.fn())
        .onParallel("Token:Approval", vi.fn());

      const registrations = kyomei.getRegistrations();
      expect(registrations).toHaveLength(2);
      expect(registrations[0].mode).toBe("sequential");
      expect(registrations[1].mode).toBe("parallel");
    });
  });

  describe("getRegistrations", () => {
    it("should return a copy of registrations", () => {
      const kyomei = new Kyomei(contracts);
      kyomei.on("Token:Transfer", vi.fn());

      const reg1 = kyomei.getRegistrations();
      const reg2 = kyomei.getRegistrations();

      expect(reg1).not.toBe(reg2);
      expect(reg1).toEqual(reg2);
    });
  });

  describe("getAbi", () => {
    it("should return contract ABI", () => {
      const kyomei = new Kyomei(contracts);

      const abi = kyomei.getAbi("Token");

      expect(abi).toBe(TestAbi);
    });
  });
});

describe("createKyomei", () => {
  it("should create a Kyomei instance", () => {
    const contracts = {
      Token: {
        abi: [
          {
            type: "event" as const,
            name: "Transfer",
            inputs: [],
          },
        ],
      },
    };

    const kyomei = createKyomei(contracts);

    expect(kyomei).toBeInstanceOf(Kyomei);
    expect(kyomei.getContracts()).toBe(contracts);
  });
});

describe("kyomeiFromConfig", () => {
  it("should create Kyomei from config structure", () => {
    const config = {
      contracts: {
        Token: {
          abi: [
            {
              type: "event" as const,
              name: "Transfer",
              inputs: [],
            },
          ],
          chain: "mainnet",
          address: "0x1234567890123456789012345678901234567890",
        },
        Factory: {
          abi: [
            {
              type: "event" as const,
              name: "Created",
              inputs: [],
            },
          ],
          chain: "mainnet",
          address: "0x0987654321098765432109876543210987654321",
        },
      },
    };

    const kyomei = kyomeiFromConfig(config);

    expect(kyomei).toBeInstanceOf(Kyomei);
    expect(Object.keys(kyomei.getContracts())).toContain("Token");
    expect(Object.keys(kyomei.getContracts())).toContain("Factory");
  });
});

describe("type inference", () => {
  it("should provide correct types for event args", () => {
    const TestAbi = [
      {
        type: "event",
        name: "Transfer",
        inputs: [
          { type: "address", name: "from", indexed: true },
          { type: "address", name: "to", indexed: true },
          { type: "uint256", name: "value", indexed: false },
        ],
      },
    ] as const satisfies Abi;

    const kyomei = createKyomei({
      Token: { abi: TestAbi },
    });

    // This test mainly ensures TypeScript compiles correctly
    kyomei.on("Token:Transfer", async ({ event }) => {
      // TypeScript should infer these types
      const _from: `0x${string}` = event.args.from;
      const _to: `0x${string}` = event.args.to;
      const _value: bigint = event.args.value;

      expect(_from).toBeDefined();
      expect(_to).toBeDefined();
      expect(_value).toBeDefined();
    });

    expect(kyomei.getRegistrations()).toHaveLength(1);
  });
});
