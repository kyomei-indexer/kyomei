import { describe, it, expect, vi, beforeEach } from "vitest";
import { Logger, createLogger } from "./Logger.ts";

describe("Logger", () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
    };
  });

  describe("constructor", () => {
    it("should create logger with level", () => {
      const logger = new Logger({ level: "info" });
      expect(logger.level).toBe("info");
    });

    it("should create logger with custom level", () => {
      const logger = new Logger({ level: "debug" });
      expect(logger.level).toBe("debug");
    });

    it("should create logger with timestamps", () => {
      const logger = new Logger({ level: "info", timestamps: true });
      expect(logger).toBeDefined();
    });
  });

  describe("child", () => {
    it("should create child logger with context", () => {
      const logger = new Logger({ level: "info" });
      const child = logger.child({ module: "test" });

      expect(child).toBeDefined();
      expect(child.level).toBe("info");
    });

    it("should inherit parent level", () => {
      const logger = new Logger({ level: "debug" });
      const child = logger.child({ module: "test" });

      expect(child.level).toBe("debug");
    });
  });

  describe("log levels", () => {
    it("should log at trace level", () => {
      const logger = new Logger({ level: "trace" });
      logger.trace("trace message");
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it("should log at debug level", () => {
      const logger = new Logger({ level: "debug" });
      logger.debug("debug message");
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it("should log at info level", () => {
      const logger = new Logger({ level: "info" });
      logger.info("info message");
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it("should log at warn level", () => {
      const logger = new Logger({ level: "warn" });
      logger.warn("warn message");
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it("should log at error level", () => {
      const logger = new Logger({ level: "error" });
      logger.error("error message");
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe("level filtering", () => {
    it("should not log below current level", () => {
      const logger = new Logger({ level: "warn" });
      logger.info("info message");
      logger.debug("debug message");
      logger.trace("trace message");

      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it("should log at and above current level", () => {
      const logger = new Logger({ level: "info" });
      logger.info("info message");

      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe("isLevelEnabled", () => {
    it("should return true for enabled levels", () => {
      const logger = new Logger({ level: "info" });

      expect(logger.isLevelEnabled("error")).toBe(true);
      expect(logger.isLevelEnabled("warn")).toBe(true);
      expect(logger.isLevelEnabled("info")).toBe(true);
    });

    it("should return false for disabled levels", () => {
      const logger = new Logger({ level: "warn" });

      expect(logger.isLevelEnabled("info")).toBe(false);
      expect(logger.isLevelEnabled("debug")).toBe(false);
      expect(logger.isLevelEnabled("trace")).toBe(false);
    });
  });

  describe("context", () => {
    it("should include context in log output", () => {
      const logger = new Logger({ level: "info" });
      logger.info("message", { key: "value" });

      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it("should merge child context", () => {
      const logger = new Logger({ level: "info" });
      const child = logger.child({ module: "test" });
      child.info("message", { extra: "context" });

      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe("startTimer", () => {
    it("should create a timer function", () => {
      const logger = new Logger({ level: "debug" });
      const stopTimer = logger.startTimer("test");

      expect(typeof stopTimer).toBe("function");
    });

    it("should log when timer is stopped", () => {
      const logger = new Logger({ level: "debug" });
      const stopTimer = logger.startTimer("test");

      // Clear previous calls
      consoleSpy.log.mockClear();

      stopTimer();

      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe("JSON mode", () => {
    it("should output JSON when configured", () => {
      const logger = new Logger({ level: "info", json: true });
      logger.info("test message");

      expect(consoleSpy.log).toHaveBeenCalled();
      // The output should be valid JSON
      const call = consoleSpy.log.mock.calls[0][0];
      expect(() => JSON.parse(call)).not.toThrow();
    });
  });
});

describe("createLogger", () => {
  it("should create a Logger instance", () => {
    const logger = createLogger({ level: "debug" });
    expect(logger).toBeDefined();
  });

  it("should convert verbosity to level", () => {
    const logger1 = createLogger({ verbosity: 1 });
    expect(logger1.level).toBe("error");

    const logger2 = createLogger({ verbosity: 2 });
    expect(logger2.level).toBe("warn");

    const logger3 = createLogger({ verbosity: 3 });
    expect(logger3.level).toBe("info");

    const logger4 = createLogger({ verbosity: 4 });
    expect(logger4.level).toBe("debug");

    const logger5 = createLogger({ verbosity: 5 });
    expect(logger5.level).toBe("trace");
  });

  it("should use info as default level", () => {
    const logger = createLogger({});
    expect(logger.level).toBe("info");
  });
});
