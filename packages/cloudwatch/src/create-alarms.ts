import { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "./alarm-definition.js";
import { defaultAlarmName } from "./default-alarm-name.js";

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * Creates CDK {@link Alarm} constructs from fully-resolved {@link AlarmDefinition}s.
 *
 * Validates that all definition keys are unique before creating alarms. Each
 * alarm's `AlarmName` is taken verbatim from `def.alarmName` when supplied;
 * otherwise it is derived from the scope, `id`, and `def.key` via
 * {@link defaultAlarmName}.
 *
 * Each alarm's construct id is `${id}${Capitalize(key)}Alarm`, unless the
 * definition supplies an explicit `constructId`, which is used verbatim (e.g.
 * to preserve an existing logical ID when grandfathering).
 *
 * @param scope - CDK construct scope.
 * @param id - Base identifier; each alarm's construct id is `${id}${Capitalize(key)}Alarm`.
 * @param definitions - Fully-resolved alarm definitions.
 * @returns A record mapping each definition's key to its created Alarm.
 * @throws If duplicate keys are found, or a supplied `constructId` is empty.
 */
export function createAlarms(
  scope: IConstruct,
  id: string,
  definitions: AlarmDefinition[],
): Record<string, Alarm> {
  const alarms: Record<string, Alarm> = {};

  for (const def of definitions) {
    if (def.key in alarms) {
      throw new Error(
        `Duplicate alarm key "${def.key}". Custom alarms cannot use the same key as a recommended alarm. ` +
          `Disable the recommended alarm first, or use a different key.`,
      );
    }
    if (def.constructId === "") {
      throw new Error(`Alarm "${def.key}": constructId, when set, must be non-empty.`);
    }
    const constructId = def.constructId ?? `${id}${capitalize(def.key)}Alarm`;
    alarms[def.key] = def.metric.createAlarm(scope, constructId, {
      alarmName: def.alarmName ?? defaultAlarmName(scope, id, def.key),
      threshold: def.threshold,
      evaluationPeriods: def.evaluationPeriods,
      datapointsToAlarm: def.datapointsToAlarm,
      treatMissingData: def.treatMissingData,
      comparisonOperator: def.comparisonOperator,
      alarmDescription: def.description,
    });
  }

  return alarms;
}
