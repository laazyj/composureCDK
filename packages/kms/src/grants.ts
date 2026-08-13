import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { IKey, Key } from "aws-cdk-lib/aws-kms";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps one of {@link IKey}'s native grant methods as a capability helper. */
const capability =
  (apply: (key: IKey, grantee: IGrantable) => void) =>
  (key: Resolvable<IKey>): Grant<IGrantable> =>
    grantVia(key, apply);

/**
 * The sign/verify grant methods only reached {@link IKey} after this package's
 * aws-cdk-lib floor, so these two capabilities name their action instead of
 * delegating. Each is a single well-known action on the construct's own ARN —
 * the narrow form ADR-0013's addendum permits where no delegate is reachable,
 * and exactly what `Key.grantSign` / `Key.grantVerify` pass internally.
 */
const SIGN_ACTION = "kms:Sign";
const VERIFY_ACTION = "kms:Verify";

/**
 * Consumer-side grant helpers for a KMS key. Pass one to a grantee builder's
 * `grant(...)` — e.g.
 * `handler.grant(keyGrants.decrypt(ref("tableKey", (r) => r.key)))`.
 *
 * Each delegates to the key's native `grant*` method, which writes the
 * permission into both the grantee's identity policy and the key policy. See
 * ADR-0013.
 *
 * A grant on the encrypted **resource** usually covers its key already —
 * `tableGrants.read` and `bucketGrants.write`, for instance, extend to the
 * resource's `encryptionKey` when CDK knows about it. Reach for these helpers
 * for the cases it cannot infer: a principal that decrypts ciphertext it
 * fetched elsewhere, an envelope-encryption client calling `GenerateDataKey`
 * directly, or a key shared with a resource the grantee has no grant on.
 *
 * @see https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-overview.html
 */
export const keyGrants = {
  /** Encrypt (`kms:Encrypt`, `ReEncrypt*`, `GenerateDataKey*`). */
  encrypt: capability((key, grantee) => {
    key.grantEncrypt(grantee);
  }),
  /** Decrypt (`kms:Decrypt`). */
  decrypt: capability((key, grantee) => {
    key.grantDecrypt(grantee);
  }),
  /** Combined encrypt and decrypt — what a resource reading and writing its own ciphertext needs. */
  encryptDecrypt: capability((key, grantee) => {
    key.grantEncryptDecrypt(grantee);
  }),
  /** Sign with an asymmetric key (`kms:Sign`). */
  sign: capability((key, grantee) => {
    key.grant(grantee, SIGN_ACTION);
  }),
  /** Verify a signature from an asymmetric key (`kms:Verify`). */
  verify: capability((key, grantee) => {
    key.grant(grantee, VERIFY_ACTION);
  }),
  /** Combined sign and verify. */
  signVerify: capability((key, grantee) => {
    key.grant(grantee, SIGN_ACTION, VERIFY_ACTION);
  }),
  /** Generate an HMAC (`kms:GenerateMac`). */
  generateMac: capability((key, grantee) => {
    key.grantGenerateMac(grantee);
  }),
  /** Verify an HMAC (`kms:VerifyMac`). */
  verifyMac: capability((key, grantee) => {
    key.grantVerifyMac(grantee);
  }),
  /**
   * Administer the key — describe, tag, enable/disable, schedule deletion —
   * without any permission to use it cryptographically. Reserve it for an
   * operator or automation role; workloads want {@link keyGrants.encryptDecrypt}.
   *
   * Takes a concrete {@link Key} rather than an {@link IKey}: `grantAdmin` is
   * declared on the class, and the alternative — the library carrying its own
   * copy of AWS's admin action set — is what ADR-0013 rules out. A
   * `createKeyBuilder` result satisfies it (`KeyBuilderResult.key` is a `Key`);
   * an imported key does not, so administer that one on the construct.
   */
  admin: (key: Resolvable<Key>): Grant<IGrantable> =>
    grantVia(key, (k: Key, grantee: IGrantable) => {
      k.grantAdmin(grantee);
    }),
};
