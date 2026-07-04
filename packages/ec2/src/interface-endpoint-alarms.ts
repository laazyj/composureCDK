import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import { type InterfaceVpcEndpoint } from "aws-cdk-lib/aws-ec2";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { InterfaceEndpointAlarmConfig } from "./interface-endpoint-alarm-config.js";
import { INTERFACE_ENDPOINT_ALARM_DEFAULTS } from "./interface-endpoint-alarm-defaults.js";

const PACKETS_DROPPED_PERIOD = Duration.minutes(1);
const PACKETS_DROPPED_PERIOD_LABEL = `${String(PACKETS_DROPPED_PERIOD.toMinutes())} minute`;

function endpointMetric(
  endpoint: InterfaceVpcEndpoint,
  metricName: string,
  statistic: string,
  period: Duration,
): Metric {
  return new Metric({
    namespace: "AWS/PrivateLinkEndpoints",
    metricName,
    dimensionsMap: { "VPC Endpoint Id": endpoint.vpcEndpointId },
    statistic,
    period,
  });
}

function resolveEndpointAlarmDefinitions(
  endpoint: InterfaceVpcEndpoint,
  config: InterfaceEndpointAlarmConfig | undefined,
): AlarmDefinition[] {
  const definitions: AlarmDefinition[] = [];

  if (config?.packetsDropped !== false) {
    const cfg = resolveAlarmConfig(
      config?.packetsDropped,
      INTERFACE_ENDPOINT_ALARM_DEFAULTS.packetsDropped,
    );
    definitions.push({
      key: "packetsDropped",
      alarmName: cfg.alarmName,
      metric: endpointMetric(endpoint, "PacketsDropped", Stats.SUM, PACKETS_DROPPED_PERIOD),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `VPC interface endpoint is dropping packets — possible endpoint service unhealthy, ` +
        `security group blocking traffic, or packets exceeding the 8,500-byte PrivateLink MTU. ` +
        `Threshold: > ${String(cfg.threshold)} (sum) over ` +
        `${String(cfg.evaluationPeriods)} x ${PACKETS_DROPPED_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for a VPC interface endpoint,
 * merging recommended definitions with any custom alarm builders.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#PrivateLinkEndpoints
 */
export function createInterfaceEndpointAlarms(
  scope: IConstruct,
  id: string,
  endpoint: InterfaceVpcEndpoint,
  config: InterfaceEndpointAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<InterfaceVpcEndpoint>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? INTERFACE_ENDPOINT_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveEndpointAlarmDefinitions(endpoint, config);
  const custom = customAlarms.map((b) => b.resolve(endpoint));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
