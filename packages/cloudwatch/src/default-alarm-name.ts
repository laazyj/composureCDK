import { Stack } from "aws-cdk-lib";
import type { IConstruct } from "constructs";
import { stackNameSegments } from "@composurecdk/cloudformation";
import { type AlarmName, joinAlarmName } from "./alarm-name.js";

/**
 * Builds a human-readable, stack-scoped {@link AlarmName} from the alarm's
 * scope, base id, and key.
 *
 * Format: `${stack}/${path}/${kebab(id)}/${kebab(key)}`. Slashes are valid in
 * CloudWatch alarm names and render hierarchy clearly in the console. `stack`
 * is the stack's name or, inside a nested stack (named only at deploy time),
 * the top-level stack's name followed by each nested stack's construct id.
 * `path` is the kebab-cased ids of the constructs between that stack and
 * `scope`, so two builders sharing an `id` under different constructs get
 * distinct names; it is empty when `scope` is the stack itself.
 *
 * Used by {@link createAlarms} as the fallback whenever an explicit
 * `alarmName` is not supplied on the {@link AlarmDefinition}.
 */
export function defaultAlarmName(scope: IConstruct, id: string, key: string): AlarmName {
  const scopes = scope.node.scopes;
  const path = scopes.slice(scopes.indexOf(Stack.of(scope)) + 1).map((c) => c.node.id);
  return joinAlarmName([...stackNameSegments(scope), ...path, id, key]);
}
