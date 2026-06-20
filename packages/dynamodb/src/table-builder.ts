import { type ITable, Table, TableEncryption, type TableProps } from "aws-cdk-lib/aws-dynamodb";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { TableAlarmConfig } from "./table-alarm-config.js";
import { createTableAlarms } from "./table-alarms.js";
import { TABLE_DEFAULTS } from "./defaults.js";
import type { TableBuilderResultBase } from "./table-result.js";

/**
 * Configuration properties for the DynamoDB table builder.
 *
 * Extends the CDK {@link TableProps} with additional builder-specific options.
 */
export interface TableBuilderProps extends TableProps {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds for server-side errors and read/write throttling. Individual
   * alarms can be customized or disabled. Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification methods are
   * user-specific. Access alarms from the build result or use an `afterBuild`
   * hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#DynamoDB
   */
  recommendedAlarms?: TableAlarmConfig | false;
}

/**
 * The build output of an {@link ITableBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role. Shares the
 * stream/alarms surface with {@link TableV2BuilderResult} via
 * {@link TableBuilderResultBase}, narrowing `table` to the classic
 * {@link Table} construct.
 */
export interface TableBuilderResult extends TableBuilderResultBase {
  /** The classic DynamoDB {@link Table} construct created by the builder. */
  table: Table;
}

/**
 * A fluent builder for configuring and creating an AWS DynamoDB table.
 *
 * Wraps the classic {@link Table} construct (`AWS::DynamoDB::Table`). For new
 * tables, prefer {@link createTableV2Builder} ({@link TableV2}) — AWS recommends
 * it, and it lets you add cross-region replicas later without replacing the
 * table. Reach for this classic builder when you need an `importSource` (S3 bulk
 * import, V1-only) or parity with existing classic tables. Note the two are
 * different CloudFormation resources and cannot be migrated in place.
 *
 * Each configuration property from the CDK {@link TableProps} is exposed as an
 * overloaded method: call with a value to set it (returns the builder for
 * chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates a
 * DynamoDB table with the configured properties — merged with secure,
 * AWS-recommended {@link TABLE_DEFAULTS} — and returns a {@link TableBuilderResult}.
 *
 * The builder also creates AWS-recommended CloudWatch alarms by default. Alarms
 * can be customized or disabled via the `recommendedAlarms` property. Custom
 * alarms can be added via the {@link addAlarm} method.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.Table.html
 *
 * @example
 * ```ts
 * import { AttributeType, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
 *
 * const orders = createTableBuilder()
 *   .partitionKey({ name: "pk", type: AttributeType.STRING })
 *   .sortKey({ name: "sk", type: AttributeType.STRING })
 *   .stream(StreamViewType.NEW_AND_OLD_IMAGES);
 * ```
 */
export type ITableBuilder = ITaggedBuilder<TableBuilderProps, TableBuilder>;

class TableBuilder implements Lifecycle<TableBuilderResult> {
  props: Partial<TableBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<ITable>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<ITable>) => AlarmDefinitionBuilder<ITable>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<ITable>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: TableBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string): TableBuilderResult {
    const { recommendedAlarms: alarmConfig, ...tableProps } = this.props;

    const mergedProps = mergeTableDefaults(tableProps);

    const table = new Table(scope, id, mergedProps);

    const alarms = createTableAlarms(scope, id, table, alarmConfig, this.#customAlarms);

    return { table, tableStreamArn: table.tableStreamArn, alarms };
  }
}

/**
 * Merges {@link TABLE_DEFAULTS} under the user's props, then resolves the two
 * cases where a default is mutually exclusive with a sibling the user set
 * (ADR-0009): the `billingMode` default yields to provisioned capacity, and
 * the `encryption` default yields to a customer-managed key.
 */
function mergeTableDefaults(props: Partial<TableProps>): TableProps {
  const merged = { ...TABLE_DEFAULTS, ...props };

  // billingMode (default PAY_PER_REQUEST) is mutually exclusive with
  // readCapacity / writeCapacity. If the user set capacity but not the mode,
  // drop the on-demand default so CDK falls back to PROVISIONED. Setting both
  // explicitly is left for CDK to reject.
  const userSetCapacity = props.readCapacity !== undefined || props.writeCapacity !== undefined;
  if (userSetCapacity && props.billingMode === undefined) {
    delete merged.billingMode;
  }

  // encryption (default AWS_MANAGED) is mutually exclusive with a user-supplied
  // encryptionKey, which CDK only accepts under CUSTOMER_MANAGED. Providing a
  // key is an unambiguous request for customer-managed encryption, so infer the
  // mode rather than forcing the user to set both.
  if (props.encryptionKey !== undefined && props.encryption === undefined) {
    merged.encryption = TableEncryption.CUSTOMER_MANAGED;
  }

  return merged;
}

/**
 * Creates a new {@link ITableBuilder} for configuring an AWS DynamoDB table.
 *
 * This is the entry point for defining a DynamoDB table component. The returned
 * builder exposes every {@link TableBuilderProps} property as a fluent
 * setter/getter and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS DynamoDB table.
 *
 * @example
 * ```ts
 * import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
 *
 * const orders = createTableBuilder().partitionKey({
 *   name: "orderId",
 *   type: AttributeType.STRING,
 * });
 *
 * // Use standalone:
 * const result = orders.build(stack, "Orders");
 *
 * // Or compose into a system, wiring the stream into a Lambda:
 * const system = compose(
 *   { orders, processor: createFunctionBuilder() },
 *   { orders: [], processor: ["orders"] },
 * );
 * ```
 */
export function createTableBuilder(): ITableBuilder {
  return taggedBuilder<TableBuilderProps, TableBuilder>(TableBuilder);
}
