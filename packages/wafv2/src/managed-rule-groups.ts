import { Token } from "aws-cdk-lib";
import type { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import type { WebAclRuleAction } from "./rule-builder.js";

/**
 * The rules in each of the AWS managed rule groups that carry no
 * subscription fee, by group name, as of this release. The names are what a
 * rule action override must match, case-sensitively. AWS adds rules to these
 * groups over time, so a name missing here is warned about, not rejected.
 *
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-use-case.html
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html
 */
export const AWS_MANAGED_RULE_GROUP_RULES = {
  AWSManagedRulesCommonRuleSet: [
    "NoUserAgent_HEADER",
    "UserAgent_BadBots_HEADER",
    "SizeRestrictions_QUERYSTRING",
    "SizeRestrictions_Cookie_HEADER",
    "SizeRestrictions_BODY",
    "SizeRestrictions_URIPATH",
    "EC2MetaDataSSRF_BODY",
    "EC2MetaDataSSRF_COOKIE",
    "EC2MetaDataSSRF_URIPATH",
    "EC2MetaDataSSRF_QUERYARGUMENTS",
    "GenericLFI_QUERYARGUMENTS",
    "GenericLFI_URIPATH",
    "GenericLFI_BODY",
    "RestrictedExtensions_URIPATH",
    "RestrictedExtensions_QUERYARGUMENTS",
    "GenericRFI_QUERYARGUMENTS",
    "GenericRFI_BODY",
    "GenericRFI_URIPATH",
    "CrossSiteScripting_COOKIE",
    "CrossSiteScripting_QUERYARGUMENTS",
    "CrossSiteScripting_BODY",
    "CrossSiteScripting_URIPATH",
  ],
  AWSManagedRulesAdminProtectionRuleSet: ["AdminProtection_URIPATH"],
  AWSManagedRulesKnownBadInputsRuleSet: [
    "JavaDeserializationRCE_HEADER",
    "JavaDeserializationRCE_BODY",
    "JavaDeserializationRCE_URIPATH",
    "JavaDeserializationRCE_QUERYSTRING",
    "Host_localhost_HEADER",
    "PROPFIND_METHOD",
    "ExploitablePaths_URIPATH",
    "Log4JRCE_HEADER",
    "Log4JRCE_QUERYSTRING",
    "Log4JRCE_BODY",
    "Log4JRCE_URIPATH",
    "ReactJSRCE_BODY",
    "ApacheMod_HTTP2",
    "Java4Shell_BODY",
    "Java4Shell_QUERYARGUMENTS",
    "Java4Shell_HEADER",
    "Java4Shell_AUTHORIZATION_HEADER",
    "Ruby2Shell_METHODOVERRIDE_HEADER",
    "Ruby2Shell_MethodOverride_BODY",
    "Ruby2Shell_MULTIPARTMETHOD",
  ],
  AWSManagedRulesSQLiRuleSet: [
    "SQLi_QUERYARGUMENTS",
    "SQLiExtendedPatterns_QUERYARGUMENTS",
    "SQLi_BODY",
    "SQLiExtendedPatterns_BODY",
    "SQLiExtendedPatterns_HEADER",
    "SQLiExtendedPatterns_URIPATH",
    "SQLi_COOKIE",
    "SQLi_URIPATH",
  ],
  AWSManagedRulesLinuxRuleSet: ["LFI_URIPATH", "LFI_QUERYSTRING", "LFI_HEADER"],
  AWSManagedRulesUnixRuleSet: [
    "UNIXShellCommandsVariables_QUERYSTRING",
    "UNIXShellCommandsVariables_BODY",
    "UNIXShellCommandsVariables_HEADER",
  ],
  AWSManagedRulesWindowsRuleSet: [
    "WindowsShellCommands_HEADER",
    "WindowsShellCommands_QUERYARGUMENTS",
    "WindowsShellCommands_QUERYSTRING",
    "WindowsShellCommands_URIPATH",
    "WindowsShellCommands_BODY",
    "PowerShellCommands_COOKIE",
    "PowerShellCommands_QUERYARGUMENTS",
    "PowerShellCommands_BODY",
  ],
  AWSManagedRulesPHPRuleSet: [
    "PHPHighRiskMethodsVariables_HEADER",
    "PHPHighRiskMethodsVariables_QUERYSTRING",
    "PHPHighRiskMethodsVariables_BODY",
    "PHPHighRiskMethodsVariables_URIPATH",
    "PHP2Shell_BODY",
    "PHP2Shell_BODY_Extended",
    "PHPUploadProgressSerializedObject_BODY",
    "PHPFPMSmuggling_BODY",
  ],
  AWSManagedRulesWordPressRuleSet: [
    "WordPressExploitableCommands_QUERYSTRING",
    "WordPressExploitablePaths_URIPATH",
  ],
  AWSManagedRulesAmazonIpReputationList: [
    "AWSManagedIPReputationList",
    "AWSManagedReconnaissanceList",
    "AWSManagedIPDDoSList",
  ],
  AWSManagedRulesAnonymousIpList: ["AnonymousIPList", "HostingProviderIPList"],
} as const satisfies Record<string, readonly string[]>;

/** The name of an AWS managed rule group this package knows the rules of. */
export type AwsManagedRuleGroupName = keyof typeof AWS_MANAGED_RULE_GROUP_RULES;

/**
 * The rule names an override can name in group `G`: the known names for an
 * AWS group, offered by the editor, and any other string.
 */
export type ManagedRuleName<G extends string> =
  | (G extends AwsManagedRuleGroupName ? (typeof AWS_MANAGED_RULE_GROUP_RULES)[G][number] : never)
  | (string & {});

/** Options for {@link IWebAclRuleBuilder.managedRuleGroup}. */
export interface ManagedRuleGroupOptions<G extends string = string> {
  /** The group's vendor. Defaults to `AWS`. */
  readonly vendorName?: string;

  /**
   * Pins the group to a static version, such as `Version_1.12`. Unpinned, the
   * group follows the vendor's default version. A pinned version adds a
   * recommended `DaysToExpiry` alarm, since WAF rejects every update to the web
   * ACL once it expires. The IP reputation groups have no versions.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-managed-rule-groups-versioning.html
   */
  readonly version?: string;

  /**
   * Overrides the action of individual rules in the group, by rule name, such
   * as `{ SizeRestrictions_BODY: "count" }`. WAF silently ignores an override
   * whose name matches no rule, so names this package does not know for an AWS
   * group are warned about.
   */
  readonly overrides?: Partial<Record<ManagedRuleName<G>, WebAclRuleAction>>;

  /**
   * Configuration some groups need, such as Bot Control's inspection level or
   * ATP's login path. Passed through.
   */
  readonly managedRuleGroupConfigs?: CfnWebACL.ManagedRuleGroupStatementProperty["managedRuleGroupConfigs"];
}

/** Groups AWS does not version, so that cannot be pinned. */
const UNVERSIONED_GROUPS: ReadonlySet<string> = new Set<AwsManagedRuleGroupName>([
  "AWSManagedRulesAmazonIpReputationList",
  "AWSManagedRulesAnonymousIpList",
]);

const VERSIONING_SOURCE =
  "https://docs.aws.amazon.com/waf/latest/developerguide/waf-managed-rule-groups-versioning.html";

function knownRules(vendorName: string, name: string): readonly string[] | undefined {
  if (vendorName !== "AWS" || !(name in AWS_MANAGED_RULE_GROUP_RULES)) return undefined;
  return AWS_MANAGED_RULE_GROUP_RULES[name as AwsManagedRuleGroupName];
}

/**
 * Turns a managed rule group and its options into a
 * `ManagedRuleGroupStatement`, with the override names WAF would ignore.
 *
 * @internal
 */
export function managedRuleGroupStatement(
  owner: string,
  name: string,
  options: ManagedRuleGroupOptions,
  scopeDownStatement: CfnWebACL.StatementProperty | undefined,
): { statement: CfnWebACL.ManagedRuleGroupStatementProperty; unknownOverrides: string[] } {
  const { vendorName = "AWS", version, overrides = {}, managedRuleGroupConfigs } = options;
  if (version !== undefined && vendorName === "AWS" && UNVERSIONED_GROUPS.has(name)) {
    throw new Error(
      `${owner}: ${name} has no versions, so it cannot be pinned to "${version}". Remove the version. See ${VERSIONING_SOURCE}.`,
    );
  }

  const entries = Object.entries(overrides).filter(
    (entry): entry is [string, WebAclRuleAction] => entry[1] !== undefined,
  );
  const known = knownRules(vendorName, name);
  const unknownOverrides =
    known === undefined
      ? []
      : entries
          .map(([rule]) => rule)
          .filter((rule) => !Token.isUnresolved(rule) && !known.includes(rule));

  return {
    statement: {
      vendorName,
      name,
      ...(version !== undefined && { version }),
      ...(entries.length > 0 && {
        ruleActionOverrides: entries.map(([rule, action]) => ({
          name: rule,
          actionToUse: { [action]: {} },
        })),
      }),
      ...(managedRuleGroupConfigs !== undefined && { managedRuleGroupConfigs }),
      ...(scopeDownStatement && { scopeDownStatement }),
    },
    unknownOverrides,
  };
}
