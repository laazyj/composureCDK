import { type AwsSdkCall, type PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import { resolve, type Resolvable } from "@composurecdk/core";

/**
 * A single AWS SDK call to run for one of the custom resource's lifecycle
 * events (`onCreate` / `onUpdate` / `onDelete`).
 *
 * Mirrors the CDK {@link AwsSdkCall} shape, except that `parameters` is
 * {@link Resolvable} — it may be a concrete record or a {@link Ref} into a
 * sibling `compose()` component, so a call can depend on another builder's
 * output. The ref is resolved against the build context in
 * {@link AwsCustomResourceBuilder.build}.
 */
export interface SdkCallConfig {
  /** The AWS service, e.g. `"SES"` or `"@aws-sdk/client-ses"`. */
  service: string;

  /** The service action, e.g. `"setActiveReceiptRuleSet"`. */
  action: string;

  /**
   * Parameters passed to the SDK call. A concrete record, or a {@link Ref}
   * resolved against the build context so the call can reference a sibling
   * component's output.
   */
  parameters?: Resolvable<Record<string, unknown>>;

  /**
   * The physical resource id of the custom resource. Keep it stable across
   * updates — returning a different id makes CloudFormation treat the resource
   * as replaced and fire a `Delete` for the previous id.
   */
  physicalResourceId?: PhysicalResourceId;

  /** Response-field paths to make available via `getResponseField(...)`. */
  outputPaths?: string[];

  /** Regex of error codes to swallow rather than fail the deployment on. */
  ignoreErrorCodesMatching?: string;

  /** Region to make the call in, if different from the stack's region. */
  region?: string;
}

/**
 * Resolves a {@link SdkCallConfig} into a concrete CDK {@link AwsSdkCall},
 * resolving its {@link Resolvable} `parameters` against the build context.
 */
export function resolveCall(config: SdkCallConfig, context: Record<string, object>): AwsSdkCall {
  const { parameters, ...rest } = config;
  return {
    ...rest,
    ...(parameters !== undefined ? { parameters: resolve(parameters, context) } : {}),
  };
}
