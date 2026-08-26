import { internal } from "./configs/internal.js";
import { recommended } from "./configs/recommended.js";
import { meta, plugin } from "./plugin.js";
import { rules } from "./rules/index.js";

export const configs = { recommended, internal };
export { meta, rules };

export default { ...plugin, configs };
