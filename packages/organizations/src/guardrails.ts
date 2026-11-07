import { createStatementBuilder, type StatementBuilder } from "@composurecdk/iam";
import { collapse } from "./policy-content.js";

/**
 * Curated `Deny` statements for the common deny-list service control
 * policies. Each factory returns a fresh statement builder. See the package
 * README for usage and the reasoning behind the set.
 *
 * @module
 */

/**
 * Actions `restrictRegions` leaves out of its region check by default: the
 * global services, whose requests are served from one region (usually
 * `us-east-1`) whichever region a caller uses. Denying them outside the
 * allowed regions would break identity, DNS, CDN, billing and support for
 * the whole account.
 *
 * Services that look global but are regional, such as KMS and CloudTrail,
 * stay subject to the region check.
 *
 * @see https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples_general.html#example-scp-deny-region
 */
export const GLOBAL_SERVICE_ACTIONS: readonly string[] = Object.freeze([
  // Identity, organization and federation
  "iam:*",
  "organizations:*",
  "sts:*",
  "signin:*",
  // DNS
  "route53:*",
  "route53domains:*",
  // CDN and edge
  "cloudfront:*",
  "cloudfront-keyvaluestore:*",
  // Global networking
  "globalaccelerator:*",
  "networkmanager:*",
  // WAF and DDoS protection for CloudFront
  "waf:*",
  "wafv2:*",
  "shield:*",
  // Support, health, advisory and compliance reports
  "support:*",
  "health:*",
  "trustedadvisor:*",
  "artifact:*",
  // Billing, cost, budgets, payments and pricing
  "account:*",
  "billing:*",
  "budgets:*",
  "ce:*",
  "cur:*",
  "savingsplans:*",
  "freetier:*",
  "tax:*",
  "payments:*",
  "aws-portal:*",
  "invoicing:*",
  "pricing:*",
  "consolidatedbilling:*",
  // Notifications
  "notifications:*",
  "notifications-contacts:*",
  "chatbot:*",
]);

/**
 * Denies `organizations:LeaveOrganization`. An account that leaves the
 * organization also leaves its SCPs, consolidated billing and any
 * organization-wide CloudTrail and GuardDuty coverage.
 *
 * @see https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples_general.html#example-scp-leave-org
 */
export function denyLeaveOrganization(): StatementBuilder {
  return createStatementBuilder()
    .sid("DenyLeaveOrg")
    .deny()
    .actions(["organizations:LeaveOrganization"])
    .resources(["*"]);
}

/**
 * Denies creating IAM users, access keys and console passwords, so access
 * goes through IAM Identity Center and roles rather than long-lived
 * credentials. Existing users and keys are not touched.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_identities_unique.html
 */
export function denyIamUsers(): StatementBuilder {
  return createStatementBuilder()
    .sid("DenyIamUserCreation")
    .deny()
    .actions(["iam:CreateUser", "iam:CreateAccessKey", "iam:CreateLoginProfile"])
    .resources(["*"]);
}

/**
 * Denies turning off, deleting or quietly narrowing CloudTrail, AWS Config
 * and GuardDuty: the services whose logs and findings make up an account's
 * audit trail.
 *
 * Beyond stopping and deleting, it covers the quieter ways to blind them:
 * `cloudtrail:UpdateTrail` and `cloudtrail:PutEventSelectors` can redirect a
 * trail or stop it recording events, and GuardDuty's member account can
 * leave its administrator through either the current or the deprecated
 * action name.
 *
 * @see https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples_cloudtrail.html
 * @see https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples_config.html
 * @see https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples_guardduty.html
 */
export function denyDisablingSecurityServices(): StatementBuilder {
  return createStatementBuilder()
    .sid("DenyDisableLogging")
    .deny()
    .actions([
      "cloudtrail:StopLogging",
      "cloudtrail:DeleteTrail",
      "cloudtrail:UpdateTrail",
      "cloudtrail:PutEventSelectors",
      "config:StopConfigurationRecorder",
      "config:DeleteConfigurationRecorder",
      "config:DeleteDeliveryChannel",
      "guardduty:DeleteDetector",
      "guardduty:DisassociateFromAdministratorAccount",
      "guardduty:DisassociateFromMasterAccount",
      "guardduty:StopMonitoringMembers",
    ])
    .resources(["*"]);
}

/** Options for {@link restrictRegions}. */
export interface RestrictRegionsOptions {
  /**
   * Further actions to leave out of the region check, added to
   * {@link GLOBAL_SERVICE_ACTIONS}. Use it for a global service missing from
   * that list, or for a cross-region call your workloads make.
   */
  exemptActions?: string[];
}

/**
 * Denies every action requested outside `allowedRegions`, except the global
 * services in {@link GLOBAL_SERVICE_ACTIONS} and any `exemptActions`.
 *
 * @param allowedRegions - Region codes, e.g. `["eu-west-2", "us-east-1"]`.
 * @throws If `allowedRegions` is empty: the statement would deny every
 *   regional action everywhere.
 * @see https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples_general.html#example-scp-deny-region
 */
export function restrictRegions(
  allowedRegions: string[],
  options: RestrictRegionsOptions = {},
): StatementBuilder {
  requireSome("restrictRegions", "allowedRegions", allowedRegions);
  return createStatementBuilder()
    .sid("DenyOtherRegions")
    .deny()
    .notActions([...new Set([...GLOBAL_SERVICE_ACTIONS, ...(options.exemptActions ?? [])])])
    .resources(["*"])
    .conditions({
      StringNotEquals: {
        "aws:RequestedRegion": collapse([...allowedRegions]),
      },
    });
}

/**
 * Denies launching EC2 instances of any type not in `allowedTypes`. Entries
 * may use wildcards, so `"t4g.*"` allows a whole family without listing each
 * size.
 *
 * @param allowedTypes - Instance types or patterns, e.g. `["t3.micro", "t4g.*"]`.
 * @throws If `allowedTypes` is empty: the statement would deny every launch.
 * @see https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples_ec2.html
 */
export function restrictInstanceTypes(allowedTypes: string[]): StatementBuilder {
  requireSome("restrictInstanceTypes", "allowedTypes", allowedTypes);
  return createStatementBuilder()
    .sid("DenyDisallowedInstanceTypes")
    .deny()
    .actions(["ec2:RunInstances"])
    .resources(["arn:aws:ec2:*:*:instance/*"])
    .conditions({ StringNotLike: { "ec2:InstanceType": [...allowedTypes] } });
}

function requireSome(guardrail: string, param: string, values: string[]): void {
  if (values.length === 0) {
    throw new Error(`guardrails.${guardrail}: ${param} must name at least one value.`);
  }
}
