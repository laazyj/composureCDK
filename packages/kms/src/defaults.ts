import { Duration, RemovalPolicy } from "aws-cdk-lib";
import type { KeyProps } from "aws-cdk-lib/aws-kms";

/**
 * Secure, AWS-recommended defaults applied to every KMS key built with
 * {@link createKeyBuilder}. Each property can be individually overridden via
 * the builder's fluent API.
 */
export const KEY_DEFAULTS: Partial<KeyProps> = {
  /**
   * Rotate the key material automatically. AWS KMS generates new backing
   * material on a schedule (yearly by default) and retains the previous
   * material so existing ciphertext stays decryptable — rotation is
   * transparent to callers and to the resources encrypted with the key.
   *
   * Rotation is only valid for symmetric encryption keys. When `keySpec` is
   * set to an asymmetric or HMAC spec, `build()` drops this default rather
   * than letting CDK reject the combination (ADR-0009).
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_protect_data_rest_key_mgmt.html
   * @see https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html
   */
  enableKeyRotation: true,

  /**
   * Retain the key when the stack is deleted. A KMS key is not recoverable
   * once its deletion completes, and every ciphertext it protects — table
   * items, objects, snapshots — becomes permanently unreadable with it.
   * Retaining orphans the key from the stack instead, leaving the data
   * recoverable and the key deletable by a deliberate, separate action.
   *
   * This matches the CDK `Key` construct's own default; it is stated
   * explicitly here so the guarantee is visible and stable across CDK
   * versions.
   *
   * @see https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html
   */
  removalPolicy: RemovalPolicy.RETAIN,

  /**
   * Wait the maximum 30 days before a scheduled key deletion takes effect.
   * The waiting period is the only window in which `CancelKeyDeletion` can
   * undo the request, so the longest one gives the most time to notice — via
   * the `KMSKeyPendingDeletion` EventBridge event or CloudTrail — that a key
   * still protecting live data is on its way out.
   *
   * @see https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html#deleting-keys-how-it-works
   */
  pendingWindow: Duration.days(30),
};
