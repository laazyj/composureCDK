import { Grant, type IGrantable } from "aws-cdk-lib/aws-iam";
import { type IEmailIdentity } from "aws-cdk-lib/aws-ses";
import { type Grant as DeferredGrant, grantVia, type Resolvable } from "@composurecdk/core";

/**
 * The IAM actions CDK's `EmailIdentity.grantSendEmail` grants. `sendFrom` cannot
 * delegate to that method (it needs a `ses:FromAddress` condition the native
 * grant does not accept), so it reproduces the action set here. This list must
 * stay in lock-step with `grantSendEmail` — a drift-guard test asserts `send`
 * and `sendFrom` grant identical actions.
 */
const SEND_ACTIONS = ["ses:SendEmail", "ses:SendRawEmail"];

/**
 * Consumer-side grant helpers for an SES email identity. Pass one to a grantee
 * builder's `grant(...)` — e.g.
 * `sender.grant(identityGrants.send(ref("identity", (r) => r.emailIdentity)))`.
 *
 * Sending is authorised on the **identity** resource, not the configuration set
 * (which has no ARN). See ADR-0013.
 */
export const identityGrants = {
  /**
   * Grant permission to send email as this identity (`ses:SendEmail` +
   * `ses:SendRawEmail`), scoped to the identity's ARN. Delegates to the
   * construct's native `grantSendEmail`.
   */
  send: (identity: Resolvable<IEmailIdentity>): DeferredGrant<IGrantable> =>
    grantVia(identity, (resolved, grantee: IGrantable) => {
      resolved.grantSendEmail(grantee);
    }),

  /**
   * Grant sending scoped to specific `From` addresses via a `ses:FromAddress`
   * condition (StringLike, so wildcards like `alerts+*@example.com` work) — the
   * least-privilege posture for a role that should only ever send from known
   * addresses (Well-Architected Security Pillar). A leaked credential then can't
   * send as arbitrary addresses on the identity.
   *
   * @see https://docs.aws.amazon.com/ses/latest/dg/sending-authorization-policy-examples.html
   */
  sendFrom: (
    identity: Resolvable<IEmailIdentity>,
    fromAddresses: string[],
  ): DeferredGrant<IGrantable> =>
    grantVia(identity, (resolved, grantee: IGrantable) => {
      Grant.addToPrincipal({
        grantee,
        actions: SEND_ACTIONS,
        resourceArns: [resolved.emailIdentityArn],
        conditions: { StringLike: { "ses:FromAddress": fromAddresses } },
      });
    }),
};
