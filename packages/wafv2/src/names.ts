import {
  charSets,
  sanitizeString,
  stringConstraint,
  validateString,
} from "@composurecdk/cloudformation";
import { Token } from "aws-cdk-lib";

/**
 * The name rule WAF applies to web ACLs and to the rules in them: 1–128
 * characters from `[\w-]`.
 */
const WAF_NAME_RULE = {
  charClass: `${charSets.ALNUM}_\\-`,
  minLength: 1,
  maxLength: 128,
  allowed: "ASCII letters, digits, _ and -",
} as const;

/**
 * AWS-property constraint for a web ACL's name. Module-private; the package
 * exposes {@link validateWebAclName} through the `constraints` namespace. See
 * ADR-0010.
 */
const WEB_ACL_NAME = stringConstraint({
  name: "WAFv2 WebACL Name",
  ...WAF_NAME_RULE,
  source: "https://docs.aws.amazon.com/waf/latest/APIReference/API_CreateWebACL.html",
});

/** AWS-property constraint for a rule's name within a web ACL. */
const RULE_NAME = stringConstraint({
  name: "WAFv2 WebACL Rule Name",
  ...WAF_NAME_RULE,
  source: "https://docs.aws.amazon.com/waf/latest/APIReference/API_Rule.html",
});

/**
 * AWS-property constraint for a `VisibilityConfig` metric name. The API
 * accepts a looser set, but the Developer Guide restricts metric names to
 * these characters, and CloudWatch is where they end up.
 */
const METRIC_NAME = stringConstraint({
  name: "WAFv2 VisibilityConfig MetricName",
  ...WAF_NAME_RULE,
  source: "https://docs.aws.amazon.com/waf/latest/APIReference/API_VisibilityConfig.html",
});

/** Metric names WAF reserves for its own aggregate metrics. */
const RESERVED_METRIC_NAMES = ["All", "Default_Action"];

/**
 * Validates a web ACL name.
 *
 * @throws on invalid input.
 */
export function validateWebAclName(raw: string): void {
  validateString(raw, WEB_ACL_NAME);
}

/**
 * Validates the name of a rule in a web ACL.
 *
 * @throws on invalid input.
 */
export function validateRuleName(raw: string): void {
  validateString(raw, RULE_NAME);
}

/**
 * Validates a CloudWatch metric name for a web ACL or rule. `All` and
 * `Default_Action` are rejected: WAF uses them for its own metrics.
 *
 * @throws on invalid input.
 */
export function validateMetricName(raw: string): void {
  validateString(raw, METRIC_NAME);
  if (!Token.isUnresolved(raw) && RESERVED_METRIC_NAMES.includes(raw)) {
    throw new Error(
      `${METRIC_NAME.name} "${raw}" is reserved by AWS WAF. Reserved: ${RESERVED_METRIC_NAMES.join(", ")}. See ${METRIC_NAME.source}.`,
    );
  }
}

/**
 * Turns a construct path or other derived string into a legal metric name, for
 * when the user has not chosen one.
 *
 * @internal
 */
export function sanitizeMetricName(raw: string): string {
  return sanitizeString(raw, METRIC_NAME, "");
}

const LABEL_SOURCE =
  "https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-label-requirements.html";

/** Each colon-separated part of a rule label: a namespace or the name. */
const LABEL_PART = stringConstraint({
  name: "WAFv2 rule label part",
  ...WAF_NAME_RULE,
  source: LABEL_SOURCE,
});
const RESERVED_LABEL_WORDS = [
  "awswaf",
  "aws",
  "waf",
  "rulegroup",
  "webacl",
  "regexpatternset",
  "ipset",
  "managed",
];
const MAX_LABEL_NAMESPACES = 5;

/**
 * Validates a label a rule adds to matching requests: up to five
 * colon-separated namespaces and a name, each 1–128 characters of
 * `[A-Za-z0-9_-]`, none of them one of WAF's reserved words. WAF adds the
 * `awswaf:<account>:webacl:<name>:` prefix itself, so it is not part of the
 * label.
 *
 * @throws on invalid input.
 */
export function validateRuleLabel(raw: string): void {
  if (Token.isUnresolved(raw)) return;
  const components = raw.split(":");
  if (components.length > MAX_LABEL_NAMESPACES + 1) {
    throw new Error(
      `WAFv2 rule label "${raw}" has ${String(components.length - 1)} namespaces; at most ${String(MAX_LABEL_NAMESPACES)} are allowed. See ${LABEL_SOURCE}.`,
    );
  }
  for (const component of components) {
    validateString(component, LABEL_PART);
    if (RESERVED_LABEL_WORDS.includes(component)) {
      throw new Error(
        `WAFv2 rule label "${raw}" uses "${component}", which AWS WAF reserves. Reserved: ${RESERVED_LABEL_WORDS.join(", ")}. See ${LABEL_SOURCE}.`,
      );
    }
  }
}
