/**
 * Handler Registration
 *
 * Importing this file registers all event handlers with the Kyomei instance.
 * The handlers are automatically discovered by importing these modules.
 */

// Import handlers to register them
import "./Factory.js";
import "./Pair.js";

// Re-export kyomei from config
export { kyomei } from "../../kyomei.config.ts";
