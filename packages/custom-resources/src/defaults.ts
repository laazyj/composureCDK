import { type AwsCustomResourceProps } from "aws-cdk-lib/custom-resources";

/**
 * Defaults applied to every custom resource built with
 * {@link createAwsCustomResourceBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 */
export const AWS_CUSTOM_RESOURCE_DEFAULTS: Partial<AwsCustomResourceProps> = {
  /**
   * Use the AWS SDK already bundled with the provider Lambda runtime instead of
   * `npm install`-ing the latest SDK at deploy time. Installing at deploy time
   * is slower, non-deterministic, and can fail or time out; the CDK itself made
   * `false` the default for the same reasons.
   * @see https://github.com/aws/aws-cdk/pull/23591
   */
  installLatestAwsSdk: false,
};
