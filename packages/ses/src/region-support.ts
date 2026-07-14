import { Annotations, Stack, Token } from "aws-cdk-lib";
import { type IConstruct } from "constructs";

/**
 * AWS Regions where Amazon SES supports **inbound email receiving**. Identity
 * verification and DKIM work in far more Regions, so this gate applies only to
 * the receiving constructs (rule sets, filters).
 *
 * Maintained against the Email receiving endpoints table — update it there when
 * AWS expands receiving to new Regions.
 *
 * @see https://docs.aws.amazon.com/general/latest/gr/ses.html#ses_inbound_endpoints
 */
export const SES_RECEIVING_REGIONS: ReadonlySet<string> = new Set([
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ca-central-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
]);

/**
 * Stable id for the synth-time warning emitted when a receiving construct is
 * created in a Region that cannot receive mail. Stable so users can suppress it
 * deliberately.
 */
export const RECEIVING_REGION_WARNING = "@composurecdk/ses:receiving-region";

/**
 * Emit a synth-time warning when the stack's resolved Region cannot receive
 * mail. Suppressed for environment-agnostic stacks, whose Region is an
 * unresolved token that cannot be checked.
 */
export function warnIfNotReceivingRegion(scope: IConstruct): void {
  const { region } = Stack.of(scope);
  if (Token.isUnresolved(region)) return;
  if (SES_RECEIVING_REGIONS.has(region)) return;
  Annotations.of(scope).addWarningV2(
    RECEIVING_REGION_WARNING,
    `SES email receiving is not available in ${region}. This resource will never ` +
      `receive mail. See https://docs.aws.amazon.com/general/latest/gr/ses.html#ses_inbound_endpoints`,
  );
}
