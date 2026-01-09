import { describe, it, expect } from "vitest";
import { kyomeiConfigSchema } from "./schema.ts";

describe("kyomeiConfigSchema", () => {
  describe("database config", () => {
    it("should validate valid database config", () => {
      const config = {
        database: {
          connectionString: "postgresql://user:pass@localhost:5432/db",
          schemaVersion: "v1",
        },
        chains: {},
        contracts: {},
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should reject invalid connection string", () => {
      const config = {
        database: {
          connectionString: "",
          schemaVersion: "v1",
        },
        chains: {},
        contracts: {},
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject missing schemaVersion", () => {
      const config = {
        database: {
          connectionString: "postgresql://localhost/db",
        },
        chains: {},
        contracts: {},
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe("chain config", () => {
    it("should validate HyperSync source", () => {
      const config = {
        database: {
          connectionString: "postgresql://localhost/db",
          schemaVersion: "v1",
        },
        chains: {
          mainnet: {
            id: 1,
            source: {
              type: "hypersync",
              url: "https://eth.hypersync.xyz",
            },
          },
        },
        contracts: {},
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should validate RPC source with finality", () => {
      const config = {
        database: {
          connectionString: "postgresql://localhost/db",
          schemaVersion: "v1",
        },
        chains: {
          mainnet: {
            id: 1,
            source: {
              type: "rpc",
              url: "https://eth.rpc.example.com",
              finality: "finalized",
            },
          },
        },
        contracts: {},
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should reject invalid chain id", () => {
      const config = {
        database: {
          connectionString: "postgresql://localhost/db",
          schemaVersion: "v1",
        },
        chains: {
          mainnet: {
            id: -1,
            source: { type: "hypersync" },
          },
        },
        contracts: {},
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe("contract config", () => {
    it("should accept empty contracts", () => {
      const config = {
        database: {
          connectionString: "postgresql://localhost/db",
          schemaVersion: "v1",
        },
        chains: {},
        contracts: {},
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("cron config", () => {
    it("should accept empty crons", () => {
      const config = {
        database: {
          connectionString: "postgresql://localhost/db",
          schemaVersion: "v1",
        },
        chains: {},
        contracts: {},
        crons: [],
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("backup config", () => {
    it("should accept config without backup", () => {
      const config = {
        database: {
          connectionString: "postgresql://localhost/db",
          schemaVersion: "v1",
        },
        chains: {},
        contracts: {},
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("api config", () => {
    it("should validate custom API config", () => {
      const config = {
        database: {
          connectionString: "postgresql://localhost/db",
          schemaVersion: "v1",
        },
        chains: {},
        contracts: {},
        api: {
          port: 3000,
          host: "localhost",
          graphql: {
            enabled: true,
            path: "/api/graphql",
          },
        },
      };

      const result = kyomeiConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("logging config", () => {
    it("should validate logging levels", () => {
      const levels = ["trace", "debug", "info", "warn", "error"];

      for (const level of levels) {
        const config = {
          database: {
            connectionString: "postgresql://localhost/db",
            schemaVersion: "v1",
          },
          chains: {},
          contracts: {},
          logging: { level },
        };

        const result = kyomeiConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });
  });
});
