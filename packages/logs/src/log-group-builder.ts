import { LogGroup, type LogGroupProps } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { LOG_GROUP_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the CloudWatch log group builder.
 *
 * The CDK {@link LogGroupProps} surface, with `encryptionKey` widened so the
 * key can come from a composed component.
 */
export interface LogGroupBuilderProps extends Omit<LogGroupProps, "encryptionKey"> {
  /**
   * The customer-managed KMS key used to encrypt the log group.
   *
   * Accepts a concrete key or a {@link Resolvable} — typically a {@link Ref}
   * to a composed `@composurecdk/kms` key builder, so the key is a component
   * of the system rather than a construct built outside it.
   *
   * CloudWatch Logs encrypts every log group with a service-managed key by
   * default, so this prop opts into a customer-managed one. The key policy
   * must allow the `logs.<region>.amazonaws.com` service principal — CDK adds
   * that statement for a key it can see.
   *
   * The inner type is read from CDK's own prop rather than named as `IKey`, so
   * it tracks the `kms.IKey` → `kms.IKeyRef` migration in either direction —
   * see the table in `@composurecdk/kms`'s README.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/encrypt-log-data-kms.html
   */
  encryptionKey?: Resolvable<NonNullable<LogGroupProps["encryptionKey"]>>;
}

/**
 * The build output of a {@link ILogGroupBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface LogGroupBuilderResult {
  /** The CloudWatch log group construct created by the builder. */
  logGroup: LogGroup;
}

/**
 * A fluent builder for configuring and creating a CloudWatch log group.
 *
 * Each configuration property from the CDK {@link LogGroupProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * a log group with the configured properties and returns a
 * {@link LogGroupBuilderResult}.
 *
 * @example
 * ```ts
 * const logs = createLogGroupBuilder()
 *   .retention(RetentionDays.SIX_MONTHS);
 * ```
 */
export type ILogGroupBuilder = ITaggedBuilder<LogGroupBuilderProps, LogGroupBuilder>;

class LogGroupBuilder implements Lifecycle<LogGroupBuilderResult> {
  props: Partial<LogGroupBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): LogGroupBuilderResult {
    const { encryptionKey, ...logGroupProps } = this.props;

    const mergedProps = {
      ...LOG_GROUP_DEFAULTS,
      ...logGroupProps,
      ...(encryptionKey !== undefined ? { encryptionKey: resolve(encryptionKey, context) } : {}),
    };

    return {
      logGroup: new LogGroup(scope, id, mergedProps),
    };
  }
}

/**
 * Creates a new {@link ILogGroupBuilder} for configuring a CloudWatch log group.
 *
 * This is the entry point for defining a log group component. The returned
 * builder exposes every {@link LogGroupProps} property as a fluent setter/getter
 * and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for a CloudWatch log group.
 *
 * @example
 * ```ts
 * const logs = createLogGroupBuilder()
 *   .retention(RetentionDays.SIX_MONTHS);
 *
 * // Use standalone:
 * const result = logs.build(stack, "MyLogGroup");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { logs, api: createRestApiBuilder() },
 *   { logs: [], api: ["logs"] },
 * );
 * ```
 */
export function createLogGroupBuilder(): ILogGroupBuilder {
  return taggedBuilder<LogGroupBuilderProps, LogGroupBuilder>(LogGroupBuilder);
}
