/**
 * Where coding agents find ComposureCDK's rules, for error messages that name
 * the rule a failure breaks. It names the package rather than an install path,
 * because where `@composurecdk/core` lands depends on the package manager.
 *
 * Internal: not exported from the package barrel.
 */
const AGENT_RULES =
  "docs/agent-rules.md in @composurecdk/core (https://github.com/laazyj/composureCDK/blob/main/packages/core/docs/agent-rules.md)";

/** A sentence pointing at one rule, to end an error message with. */
export function seeRule(id: string): string {
  return ` See rule ${id} in ${AGENT_RULES}.`;
}
