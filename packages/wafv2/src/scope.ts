import { Annotations, Stack, Token } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

/** Where a web ACL can be used: CloudFront distributions, or regional resources. */
export type WebAclScope = "REGIONAL" | "CLOUDFRONT";

const CLOUDFRONT_REGION = "us-east-1";
const REGION_ANNOTATION = "@composurecdk/wafv2:cloudfront-region";
const SOURCE =
  "https://docs.aws.amazon.com/waf/latest/developerguide/how-aws-waf-works-resources.html";

/**
 * Throws when a CLOUDFRONT web ACL's stack is in a known region other than
 * `us-east-1`, and warns when the region cannot be known at synth.
 *
 * Env-agnostic stacks fall back to `CDK_DEFAULT_REGION`, which the CDK toolkit
 * uses to fill the deploy region, as `@composurecdk/route53`'s query logging
 * does.
 *
 * @internal
 */
export function checkCloudFrontRegion(scope: IConstruct, id: string): void {
  const stackRegion = Stack.of(scope).region;
  const region = Token.isUnresolved(stackRegion) ? process.env.CDK_DEFAULT_REGION : stackRegion;
  if (region === undefined || region === "") {
    Annotations.of(scope).addWarningV2(
      REGION_ANNOTATION,
      `WebAclBuilder "${id}" has scope CLOUDFRONT, which AWS WAF only accepts in ` +
        `${CLOUDFRONT_REGION}. This stack is env-agnostic and CDK_DEFAULT_REGION is not ` +
        `set, so the region cannot be checked at synth. Pin env: { region: ` +
        `"${CLOUDFRONT_REGION}" } on the stack to silence this warning.`,
    );
    return;
  }
  if (region !== CLOUDFRONT_REGION) {
    throw new Error(
      `WebAclBuilder "${id}" has scope CLOUDFRONT, but its stack is in "${region}". ` +
        `AWS WAF only creates CloudFront web ACLs in ${CLOUDFRONT_REGION}. Deploy this ` +
        `web ACL from a ${CLOUDFRONT_REGION} stack and pass its ARN to the distribution's ` +
        `webAclId. See ${SOURCE}.`,
    );
  }
}
