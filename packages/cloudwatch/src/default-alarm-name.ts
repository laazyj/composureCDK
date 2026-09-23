import { Stack } from "aws-cdk-lib";
import type { IConstruct } from "constructs";
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
  return joinAlarmName([...stackSegments(Stack.of(scope)), id, key]);
}

function stackSegments(stack: Stack): string[] {
  const parent = stack.nestedStackParent;
  return parent ? [...stackSegments(parent), stack.node.id] : [stack.stackName];
}
