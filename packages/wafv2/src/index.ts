import type { ConstraintNamespace } from "@composurecdk/cloudformation";
import {
  validateMetricName,
  validateRuleLabel,
  validateRuleName,
  validateWebAclName,
} from "./names.js";

export {
  createWebAclBuilder,
  type IWebAclBuilder,
  type WebAclBuilderProps,
  type WebAclBuilderResult,
} from "./web-acl-builder.js";
export {
  type IWebAclRuleBuilder,
  type WebAclRuleAction,
  type WebAclRuleBuilderProps,
} from "./rule-builder.js";
export { type WebAclAssociationTarget } from "./association.js";
export {
  type CustomResponse,
  type CustomResponseBody,
  SUPPORTED_CUSTOM_RESPONSE_STATUS_CODES,
} from "./custom-response.js";
export { type WebAclScope } from "./scope.js";
export {
  type ManagedRuleGroupVersion,
  type WebAclMetrics,
  type WebAclRequestMetrics,
} from "./metrics.js";
export { type WebAclAlarmConfig, type WebAclRuleAlarmConfig } from "./alarm-config.js";
export { WEB_ACL_RULE_ALARM_DEFAULTS } from "./alarm-defaults.js";
export { type WebAclLoggingConfig, type WebAclLogRedaction } from "./logging.js";
export {
  type WebAclLogAction,
  type WebAclLogCondition,
  type WebAclLoggingFilter,
} from "./logging-filter.js";
export {
  DEFAULT_LOGGING_FILTER,
  DEFAULT_LOGGING_REDACTED_HEADERS,
  DEFAULT_RULE_PRIORITY_STEP,
  WEB_ACL_DEFAULTS,
  WEB_ACL_VISIBILITY_DEFAULTS,
  WAF_LOG_GROUP_NAME_PREFIX,
} from "./defaults.js";

/**
 * This package's AWS-property constraints, grouped by application strategy.
 * The `constraints.validate.*` / `constraints.sanitize.*` shape is identical
 * in every builder package, so it is discoverable without importing anything
 * beyond the package you already use. The underlying constraint definitions
 * stay module-private — this namespace is the only public surface for them.
 * See ADR-0010.
 */
export const constraints = {
  validate: {
    webAclName: validateWebAclName,
    ruleName: validateRuleName,
    metricName: validateMetricName,
    ruleLabel: validateRuleLabel,
  },
  sanitize: {},
} satisfies ConstraintNamespace;
