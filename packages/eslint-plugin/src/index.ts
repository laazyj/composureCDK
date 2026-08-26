import { internal } from "./configs/internal.js";
import { recommended } from "./configs/recommended.js";
import { rules } from "./rules/index.js";

const meta = { name: "@composurecdk/eslint-plugin" };

export const configs = { recommended, internal };
export { meta, rules };

export default { meta, rules, configs };
