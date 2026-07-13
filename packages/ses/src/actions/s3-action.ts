import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type IKey } from "aws-cdk-lib/aws-kms";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { S3 } from "aws-cdk-lib/aws-ses-actions";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { combine, type Ref, type Resolvable } from "@composurecdk/core";

/** The SES service principal, granted access by resource-facing actions. */
const SES_PRINCIPAL = new ServicePrincipal("ses.amazonaws.com");

/** Options for {@link s3Action}. */
export interface S3ActionOptions {
  /** Key prefix under which received mail objects are stored. */
  readonly objectKeyPrefix?: string;
  /**
   * Customer-managed KMS key SES uses to encrypt mail before writing it to the
   * bucket. When supplied, the action grants `ses.amazonaws.com` the encrypt
   * permissions the key needs — encryption at rest works out of the box.
   */
  readonly kmsKey?: Resolvable<IKey>;
  /** SNS topic notified when the mail is delivered to the bucket. */
  readonly topic?: Resolvable<ITopic>;
}

/**
 * Stores received mail in an S3 bucket. CDK's underlying action injects the
 * bucket policy that lets SES write objects; this helper additionally wires the
 * KMS key grant when one is supplied, so the action is self-contained.
 *
 * `bucket`, `kmsKey`, and `topic` each accept a {@link Resolvable}, so they can
 * be sibling components referenced by `ref()` inside a `compose()`d system.
 */
export function s3Action(
  bucket: Resolvable<IBucket>,
  options: S3ActionOptions = {},
): Ref<IReceiptRuleAction> {
  const { objectKeyPrefix, kmsKey, topic } = options;
  return combine({ bucket, kmsKey, topic }, (resolved): IReceiptRuleAction => {
    if (resolved.kmsKey) resolved.kmsKey.grantEncrypt(SES_PRINCIPAL);
    return new S3({
      bucket: resolved.bucket,
      ...(objectKeyPrefix !== undefined && { objectKeyPrefix }),
      ...(resolved.kmsKey && { kmsKey: resolved.kmsKey }),
      ...(resolved.topic && { topic: resolved.topic }),
    });
  });
}
