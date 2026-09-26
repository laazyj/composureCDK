import type { IConstruct } from "constructs";
import { stackNameSegments } from "@composurecdk/cloudformation";
import { type AlarmName, joinAlarmName } from "./alarm-name.js";

/**
 * Builds a human-readable, stack-scoped {@link AlarmName} from the alarm's
 * scope, base id, and key.
 *
 * Format: `${stack}/${kebab(id)}/${kebab(key)}`. Slashes are valid in
 * CloudWatch alarm names and render hierarchy clearly in the console. `stack`
 * is the stack's name or, inside a nested stack (named only at deploy time),
 * the top-level stack's name followed by each nested stack's construct id.
 *
 * Used by {@link createAlarms} as the fallback whenever an explicit
 * `alarmName` is not supplied on the {@link AlarmDefinition}.
 */
export function defaultAlarmName(scope: IConstruct, id: string, key: string): AlarmName {
  return joinAlarmName([...stackNameSegments(scope), id, key]);
}
