import { Annotations, Token } from "aws-cdk-lib";
import type { Distribution } from "aws-cdk-lib/aws-cloudfront";

/** Owned by `aws-cdk-lib`: emitted by any OAC origin granted `AccessLevel.LIST`. */
export const LIST_BUCKET_SECURITY_RISK_WARNING_ID =
  "@aws-cdk/aws-cloudfront-origins:listBucketSecurityRisk";

/**
 * Acknowledges CDK's list-bucket warning on this distribution when it has a
 * concrete `defaultRootObject` — the mitigation the warning asks for. Absent,
 * empty or unresolved, the warning stays. Call after the `Distribution` exists:
 * origins warn inside its constructor, and `acknowledgeWarning` removes those
 * and suppresses any added later.
 */
export function acknowledgeListBucketRisk(
  distribution: Distribution,
  defaultRootObject: string | undefined,
): void {
  if (!defaultRootObject || Token.isUnresolved(defaultRootObject)) return;
  Annotations.of(distribution).acknowledgeWarning(LIST_BUCKET_SECURITY_RISK_WARNING_ID);
}
