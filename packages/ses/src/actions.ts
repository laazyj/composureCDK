import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type IKey } from "aws-cdk-lib/aws-kms";
import { type IFunction } from "aws-cdk-lib/aws-lambda";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import {
  AddHeader,
  Bounce,
  type BounceTemplate,
  type EmailEncoding,
  Lambda,
  type LambdaInvocationType,
  S3,
  Sns,
  Stop,
} from "aws-cdk-lib/aws-ses-actions";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { combine, isRef, type Ref, type Resolvable } from "@composurecdk/core";

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

/** Options for {@link lambdaAction}. */
export interface LambdaActionOptions {
  /** Whether SES invokes the function asynchronously (`Event`) or waits (`RequestResponse`). */
  readonly invocationType?: LambdaInvocationType;
  /** SNS topic notified when the function is invoked. */
  readonly topic?: Resolvable<ITopic>;
}

/**
 * Invokes a Lambda function for the received mail. The function and the
 * notification topic each accept a {@link Resolvable}, so they can wire to
 * sibling components via `ref()`.
 */
export function lambdaAction(
  fn: Resolvable<IFunction>,
  options: LambdaActionOptions = {},
): Ref<IReceiptRuleAction> {
  const { invocationType, topic } = options;
  return combine(
    { fn, topic },
    (resolved): IReceiptRuleAction =>
      new Lambda({
        function: resolved.fn,
        ...(invocationType !== undefined && { invocationType }),
        ...(resolved.topic && { topic: resolved.topic }),
      }),
  );
}

/** Options for {@link snsAction}. */
export interface SnsActionOptions {
  /** Encoding SES uses for the message published to the topic. */
  readonly encoding?: EmailEncoding;
}

/**
 * Publishes the received mail to an SNS topic. The topic accepts a
 * {@link Resolvable}, so it can wire to a sibling component via `ref()`.
 */
export function snsAction(
  topic: Resolvable<ITopic>,
  options: SnsActionOptions = {},
): Resolvable<IReceiptRuleAction> {
  const build = (resolved: ITopic): IReceiptRuleAction =>
    new Sns({
      topic: resolved,
      ...(options.encoding !== undefined && { encoding: options.encoding }),
    });
  return isRef(topic) ? topic.map(build) : build(topic);
}

/** Options for {@link bounceAction}. */
export interface BounceActionOptions {
  /** The bounce message SES returns to the sender. */
  readonly template: BounceTemplate;
  /** The email address the bounce is reported as originating from. */
  readonly sender: string;
  /** SNS topic notified when the bounce is sent. Accepts a {@link Resolvable}. */
  readonly topic?: Resolvable<ITopic>;
}

/** Rejects the received mail by returning a bounce response to the sender. */
export function bounceAction(options: BounceActionOptions): Resolvable<IReceiptRuleAction> {
  const { template, sender, topic } = options;
  const build = (resolved?: ITopic): IReceiptRuleAction =>
    new Bounce({ template, sender, ...(resolved !== undefined && { topic: resolved }) });
  if (topic === undefined) return build();
  return isRef(topic) ? topic.map(build) : build(topic);
}

/**
 * Terminates evaluation of the rule set, optionally notifying an SNS topic
 * (which accepts a {@link Resolvable}).
 */
export function stopAction(topic?: Resolvable<ITopic>): Resolvable<IReceiptRuleAction> {
  const build = (resolved?: ITopic): IReceiptRuleAction =>
    new Stop(resolved !== undefined ? { topic: resolved } : undefined);
  if (topic === undefined) return build();
  return isRef(topic) ? topic.map(build) : build(topic);
}

/** Adds a custom header to the received mail. */
export function addHeaderAction(name: string, value: string): IReceiptRuleAction {
  return new AddHeader({ name, value });
}
