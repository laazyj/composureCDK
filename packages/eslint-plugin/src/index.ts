import { dualPublishing } from "./configs/dual-publishing.js";
import { internal } from "./configs/internal.js";
import { recommended } from "./configs/recommended.js";
import { meta, plugin } from "./plugin.js";
import { rules } from "./rules/index.js";

export const configs = { recommended, dualPublishing, internal };
export { meta, rules };

export default { ...plugin, configs };
