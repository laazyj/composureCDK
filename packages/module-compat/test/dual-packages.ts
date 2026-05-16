/**
 * Packages migrated to dual ESM/CJS publishing (tshy — see ADR-0007). Each
 * entry names a known runtime export that the resolution tests probe for.
 *
 * This list grows as the tshy rollout proceeds; every entry must have a
 * matching `peerDependency` in this package's `package.json` so npm links the
 * built package into `node_modules`.
 */
export const DUAL_PACKAGES = [{ name: "@composurecdk/cloudwatch", probe: "createAlarms" }] as const;
