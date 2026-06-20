import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type ITable, TableV2, type TablePropsV2 } from "aws-cdk-lib/aws-dynamodb";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { TableAlarmConfig } from "./table-alarm-config.js";
import { createTableAlarms } from "./table-alarms.js";
import { TABLE_V2_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the DynamoDB {@link TableV2} builder.
 *
 * Extends the CDK {@link TablePropsV2} with additional builder-specific options.
 */
export interface TableV2BuilderProps extends TablePropsV2 {
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
 * The build output of an {@link ITableV2Builder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface TableV2BuilderResult {
  /** The DynamoDB {@link TableV2} construct created by the builder. */
  table: TableV2;

  /**
   * The table's DynamoDB Streams ARN, or `undefined` when no stream is
   * configured. Surfaced directly so a downstream consumer (e.g. a Lambda
   * `DynamoEventSource`) can be wired via `ref()`.
   */
  tableStreamArn?: string;

  /**
   * CloudWatch alarms created for the table, keyed by alarm name — both the
   * AWS-recommended alarms and any added via {@link ITableV2Builder.addAlarm}.
   * No alarm actions are configured.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating an AWS {@link TableV2} — the
 * `AWS::DynamoDB::GlobalTable` resource, AWS's recommended construct for new
 * tables.
 *
 * A single-region `TableV2` bills the same as a classic {@link Table} but
 * future-proofs the one irreversible part of the choice: you can add
 * cross-region replicas later without replacing the table. `ITableV2 extends
 * ITable`, so a built table works everywhere an `ITable` is expected (grants,
 * `DynamoEventSource`) — composition wiring is unaffected.
 *
 * Each configuration property from the CDK {@link TablePropsV2} is exposed as an
 * overloaded method: call with a value to set it (returns the builder for
 * chaining), or call with no arguments to read the current value. Note the V2
 * prop shape differs from the classic one — e.g. billing is a single
 * `.billing(Billing.onDemand())` helper, encryption is
 * `.encryption(TableEncryptionV2.awsManagedKey())`, and the stream is
 * `.dynamoStream(StreamViewType…)`.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates a
 * table with the configured properties — merged with secure, AWS-recommended
 * {@link TABLE_V2_DEFAULTS} — and returns a {@link TableV2BuilderResult}.
 *
 * The builder also creates AWS-recommended CloudWatch alarms by default. Alarms
 * can be customized or disabled via the `recommendedAlarms` property. Custom
 * alarms can be added via the {@link addAlarm} method.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.TableV2.html
 *
 * @example
 * ```ts
 * import { AttributeType, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
 *
 * const orders = createTableV2Builder()
 *   .partitionKey({ name: "pk", type: AttributeType.STRING })
 *   .sortKey({ name: "sk", type: AttributeType.STRING })
 *   .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES);
 * ```
 */
export type ITableV2Builder = ITaggedBuilder<TableV2BuilderProps, TableV2Builder>;

class TableV2Builder implements Lifecycle<TableV2BuilderResult> {
  props: Partial<TableV2BuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<ITable>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<ITable>) => AlarmDefinitionBuilder<ITable>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<ITable>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: TableV2Builder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string): TableV2BuilderResult {
    const { recommendedAlarms: alarmConfig, ...tableProps } = this.props;

    // TableV2's billing and encryption defaults are single helper objects with
    // no flat sibling props, so a same-key spread is sufficient — unlike the
    // classic builder, there are no mutually-exclusive defaults to yield
    // (ADR-0009).
    const mergedProps = { ...TABLE_V2_DEFAULTS, ...tableProps } as TablePropsV2;

    const table = new TableV2(scope, id, mergedProps);

    const alarms = createTableAlarms(scope, id, table, alarmConfig, this.#customAlarms);

    // Unlike the classic Table (whose getter is undefined without a stream),
    // TableV2.tableStreamArn always returns the CFN attribute token even when no
    // stream is configured. Guard on the actual `dynamoStream` prop so the
    // result stays honest — a downstream `ref()` consumer checking
    // `result.tableStreamArn` should only see an ARN when a stream truly exists.
    const tableStreamArn = mergedProps.dynamoStream ? table.tableStreamArn : undefined;

    return { table, tableStreamArn, alarms };
  }
}

/**
 * Creates a new {@link ITableV2Builder} for configuring an AWS {@link TableV2}.
 *
 * This is the entry point for defining a `TableV2` (`AWS::DynamoDB::GlobalTable`)
 * component — AWS's recommended construct for new tables. The returned builder
 * exposes every {@link TableV2BuilderProps} property as a fluent setter/getter
 * and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS DynamoDB {@link TableV2}.
 *
 * @example
 * ```ts
 * import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
 *
 * const orders = createTableV2Builder().partitionKey({
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
export function createTableV2Builder(): ITableV2Builder {
  return taggedBuilder<TableV2BuilderProps, TableV2Builder>(TableV2Builder);
}
