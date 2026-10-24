import { Arn, ArnFormat, Aws, Stack } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

type Environment = Pick<Stack, "partition" | "region" | "account">;

/**
 * The partition, Region and account of `scope`'s stack, or the `AWS::`
 * pseudo-parameters without a scope. @internal
 */
export function environmentOf(scope: IConstruct | undefined): Environment {
  return scope === undefined
    ? { partition: Aws.PARTITION, region: Aws.REGION, account: Aws.ACCOUNT_ID }
    : Stack.of(scope);
}

/** A `bedrock` ARN with a slash-separated resource name. @internal */
export function bedrockArn(
  partition: string,
  resource: string,
  resourceName: string,
  region: string,
  account = "",
): string {
  return Arn.format({
    partition,
    service: "bedrock",
    region,
    account,
    resource,
    resourceName,
    arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
  });
}
