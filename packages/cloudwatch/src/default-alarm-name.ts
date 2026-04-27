import { Stack } from "aws-cdk-lib";
import type { IConstruct } from "constructs";
import { type AlarmName, joinAlarmName } from "./alarm-name.js";

/**
 * Builds a human-readable, stack-scoped {@link AlarmName} from the alarm's
 * scope, base id, and key.
 *
 * Format: `${stackName}/${kebab(id)}/${kebab(key)}`. Slashes are valid in
 * CloudWatch alarm names and render hierarchy clearly in the console.
 *
 * Used by {@link createAlarms} as the fallback whenever an explicit
 * `alarmName` is not supplied on the {@link AlarmDefinition}.
 */
export function defaultAlarmName(scope: IConstruct, id: string, key: string): AlarmName {
  const stackName = Stack.of(scope).stackName;
  return joinAlarmName([stackName, id, key]);
}
