import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";

/**
 * The shared shape of a DynamoDB table builder's build output, independent of
 * which construct ({@link Table} or {@link TableV2}) produced it. Each builder
 * narrows the `table` field to its concrete construct type.
 *
 * Both builders feed the same downstream wiring — a `DynamoEventSource` consumes
 * the table via `ITable`, and `tableStreamArn` surfaces the stream for `ref()`
 * composition — so the common fields live here.
 */
export interface TableBuilderResultBase {
  /**
   * The table's DynamoDB Streams ARN, or `undefined` when no stream is
   * configured (the default).
   *
   * Neither the classic {@link Table} nor {@link TableV2} exposes a distinct
   * stream construct — the stream is an attribute of the table. This field
   * surfaces it directly so downstream components can wire a stream consumer
   * (e.g. a Lambda `DynamoEventSource`) via `ref()` without reaching into the
   * table. The table itself is what a `DynamoEventSource` consumes.
   *
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html
   */
  tableStreamArn?: string;

  /**
   * CloudWatch alarms created for the table, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added via
   * `addAlarm`. Access individual alarms by key (e.g. `result.alarms.systemErrors`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#DynamoDB
   */
  alarms: Record<string, Alarm>;
}
