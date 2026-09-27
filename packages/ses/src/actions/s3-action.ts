import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { S3, type S3Props } from "aws-cdk-lib/aws-ses-actions";
import { combine, type Ref, type Resolvable } from "@composurecdk/core";

/** The SES service principal, granted access by resource-facing actions. */
const SES_PRINCIPAL = new ServicePrincipal("ses.amazonaws.com");

/**
 * Options for {@link s3Action} — every CDK {@link S3Props} field except
 * `bucket`, which is the helper's positional argument.
 *
 * `kmsKey` and `topic` read their inner type from CDK's own prop rather than
 * naming `IKey` / `ITopic`, so they keep tracking the installed `aws-cdk-lib`
 * (ADR-0018).
 */
export interface S3ActionOptions extends Omit<S3Props, "bucket" | "kmsKey" | "topic"> {
  /**
   * Customer-managed KMS key SES uses to encrypt mail before writing it to the
   * bucket. When supplied, the action grants `ses.amazonaws.com` the encrypt
   * permissions the key needs — encryption at rest works out of the box.
   */
  readonly kmsKey?: Resolvable<NonNullable<S3Props["kmsKey"]>>;
  /** SNS topic notified when the mail is delivered to the bucket. */
  readonly topic?: Resolvable<NonNullable<S3Props["topic"]>>;
}

/**
 * Stores received mail in an S3 bucket. CDK's underlying action injects the
 * bucket policy that lets SES write objects; this helper additionally wires the
 * KMS key grant when one is supplied, so the action is self-contained.
 *
 * `bucket`, `kmsKey`, and `topic` each accept a {@link Resolvable}, so they can
 * be sibling components referenced by `ref()` inside a `compose()`d system.
 * `bucket` reads its inner type from CDK's own prop rather than naming
 * `IBucket`, so it keeps tracking the installed `aws-cdk-lib` (ADR-0018).
 */
export function s3Action(
  bucket: Resolvable<S3Props["bucket"]>,
  options: S3ActionOptions = {},
): Ref<IReceiptRuleAction> {
  const { objectKeyPrefix, kmsKey, topic } = options;
  return combine({ bucket, kmsKey, topic }, (resolved): IReceiptRuleAction => {
    // `kmsKey` is the one tracked value here that is *used* rather than
    // forwarded, so it carries a cost the others do not: when CDK migrates
    // `S3Props.kmsKey` to a ref interface, that type loses `grantEncrypt` and
    // this call stops compiling. That is the right place for it to surface —
    // our build, not a consumer's synth — but it will need the structural read
    // `logGroupArnOf` uses in `@composurecdk/lambda`, and recovering a
    // grantable key from a ref needs a scope this callback does not have.
    if (resolved.kmsKey) resolved.kmsKey.grantEncrypt(SES_PRINCIPAL);
    return new S3({
      bucket: resolved.bucket,
      ...(objectKeyPrefix !== undefined && { objectKeyPrefix }),
      ...(resolved.kmsKey && { kmsKey: resolved.kmsKey }),
      ...(resolved.topic && { topic: resolved.topic }),
    });
  });
}
