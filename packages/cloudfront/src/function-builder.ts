import { Function as CfFunction, type FunctionProps } from "aws-cdk-lib/aws-cloudfront";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { FunctionAlarmConfig } from "./alarm-config.js";
import { createFunctionAlarms } from "./function-alarms.js";
import { FUNCTION_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the CloudFront Function builder.
 *
 * Extends the CDK {@link FunctionProps} with additional builder-specific
 * options. The `code` property is still required — CloudFront Functions take
 * a single JS source string (via `FunctionCode.fromInline` or `fromFile`) and
 * are not bundled.
 */
export interface FunctionBuilderProps extends FunctionProps {
  /**
   * Configuration for recommended CloudWatch alarms.
   *
   * By default, the builder creates alarms for execution errors, validation
   * errors, and throttles. Individual alarms can be customized or disabled.
   * Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification methods
   * are user-specific. Access alarms from the build result or use an
   * `afterBuild` hook to apply actions.
   *
   * CloudFront Function metrics are only emitted to `us-east-1`. Alarms
   * created here live in the stack's region — if that is not `us-east-1`,
   * the alarms will not receive data.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-functions.html
   */
  recommendedAlarms?: FunctionAlarmConfig | false;
}

/**
 * The build output of an {@link IFunctionBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface FunctionBuilderResult {
  /** The CloudFront Function construct created by the builder. */
  function: CfFunction;

  /**
   * CloudWatch alarms created for the function, keyed by alarm name.
   *
   * Includes both recommended alarms and any custom alarms added via
   * {@link IFunctionBuilder.addAlarm}. Access individual alarms by key
   * (e.g., `result.alarms.executionErrors`).
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating a CloudFront Function.
 *
 * CloudFront Functions are lightweight JavaScript functions that run at the
 * edge for viewer-request / viewer-response events. They differ substantially
 * from Lambda: a custom JS runtime (`cloudfront-js-2.0`), a 1ms compute
 * budget, no network or filesystem access, and no CloudWatch Logs — only
 * metrics. The builder accordingly does not create a LogGroup.
 *
 * Each configuration property from the CDK {@link FunctionProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle} so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates a
 * CloudFront Function with the configured properties and returns a
 * {@link FunctionBuilderResult}.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html
 *
 * @example
 * ```ts
 * const rewrite = createFunctionBuilder()
 *   .code(FunctionCode.fromFile({ filePath: "src/edge/rewrite.js" }))
 *   .comment("Normalises viewer request URIs");
 * ```
 */
export type IFunctionBuilder = IBuilder<FunctionBuilderProps, FunctionBuilder>;

class FunctionBuilder implements Lifecycle<FunctionBuilderResult> {
  props: Partial<FunctionBuilderProps> = {};
  private readonly customAlarms: AlarmDefinitionBuilder<CfFunction>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<CfFunction>) => AlarmDefinitionBuilder<CfFunction>,
  ): this {
    this.customAlarms.push(configure(new AlarmDefinitionBuilder<CfFunction>(key)));
    return this;
  }

  build(scope: IConstruct, id: string): FunctionBuilderResult {
    if (!this.props.code) {
      throw new Error(
        `FunctionBuilder "${id}" requires code. ` +
          `Call .code() with FunctionCode.fromInline() or FunctionCode.fromFile().`,
      );
    }

    const { recommendedAlarms: alarmConfig, ...functionProps } = this.props;

    const mergedProps = {
      ...FUNCTION_DEFAULTS,
      ...functionProps,
    } as FunctionProps;

    const fn = new CfFunction(scope, id, mergedProps);

    const alarms = createFunctionAlarms(scope, id, fn, alarmConfig, this.customAlarms);

    return { function: fn, alarms };
  }
}

/**
 * Creates a new {@link IFunctionBuilder} for configuring a CloudFront Function.
 *
 * This is the entry point for defining a CloudFront Function component. The
 * returned builder exposes every {@link FunctionBuilderProps} property as a
 * fluent setter/getter and implements {@link Lifecycle} for use with
 * {@link compose}.
 *
 * @returns A fluent builder for a CloudFront Function.
 *
 * @example
 * ```ts
 * const rewrite = createFunctionBuilder()
 *   .code(FunctionCode.fromInline(`
 *     async function handler(event) {
 *       if (!event.request.uri.includes(".")) {
 *         event.request.uri = event.request.uri.replace(/\\/$/, "") + "/index.html";
 *       }
 *       return event.request;
 *     }
 *   `));
 *
 * // Use standalone:
 * const result = rewrite.build(stack, "Rewrite");
 *
 * // Or compose with a distribution:
 * const system = compose(
 *   {
 *     rewrite,
 *     site: createBucketBuilder(),
 *     cdn: createDistributionBuilder()
 *       .origin(ref("site", (r) => S3BucketOrigin.withOriginAccessControl(r.bucket)))
 *       .defaultBehavior({
 *         functionAssociations: [{
 *           function: ref<FunctionBuilderResult>("rewrite", (r) => r.function),
 *           eventType: FunctionEventType.VIEWER_REQUEST,
 *         }],
 *       }),
 *   },
 *   { rewrite: [], site: [], cdn: ["site", "rewrite"] },
 * );
 * ```
 */
export function createFunctionBuilder(): IFunctionBuilder {
  return Builder<FunctionBuilderProps, FunctionBuilder>(FunctionBuilder);
}
