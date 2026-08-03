export {
  createEmailIdentityBuilder,
  type EmailIdentityBuilderProps,
  type EmailIdentityBuilderResult,
  type IEmailIdentityBuilder,
} from "./email-identity-builder.js";
export {
  createReceiptRuleSetBuilder,
  type ReceiptRuleSetBuilderProps,
  type ReceiptRuleSetBuilderResult,
  type IReceiptRuleSetBuilder,
} from "./receipt-rule-set-builder.js";
export { type ReceiptRuleBuilderProps, type IReceiptRuleBuilder } from "./receipt-rule-builder.js";
export {
  createReceiptFilterBuilder,
  type ReceiptFilterBuilderProps,
  type ReceiptFilterBuilderResult,
  type IReceiptFilterBuilder,
  createAllowListReceiptFilterBuilder,
  type AllowListReceiptFilterBuilderProps,
  type AllowListReceiptFilterBuilderResult,
  type IAllowListReceiptFilterBuilder,
} from "./receipt-filter-builder.js";
export {
  s3Action,
  type S3ActionOptions,
  lambdaAction,
  type LambdaActionOptions,
  snsAction,
  type SnsActionOptions,
  bounceAction,
  type BounceActionOptions,
  stopAction,
  addHeaderAction,
} from "./actions/index.js";
export { DEFAULT_RECEIPT_RULE, DEFAULT_MAIL_FROM_BEHAVIOR_ON_MX_FAILURE } from "./defaults.js";
export { SES_RECEIVING_REGIONS, RECEIVING_REGION_WARNING } from "./region-support.js";

// Sending-side builders.
export {
  createConfigurationSetBuilder,
  type ConfigurationSetBuilderProps,
  type ConfigurationSetBuilderResult,
  type EventDestinationOptions,
  type IConfigurationSetBuilder,
} from "./configuration-set-builder.js";
export { CONFIGURATION_SET_DEFAULTS } from "./configuration-set-defaults.js";
export {
  snsDestination,
  eventBusDestination,
  cloudWatchDestination,
} from "./event-destinations/index.js";
export { identityGrants } from "./grants.js";
export {
  createReputationAlarmBuilder,
  type ReputationAlarmBuilderProps,
  type ReputationAlarmBuilderResult,
  type IReputationAlarmBuilder,
} from "./reputation-alarm-builder.js";
export { type ReputationAlarmConfig } from "./reputation-alarm-config.js";
export { REPUTATION_ALARM_DEFAULTS } from "./reputation-alarm-defaults.js";
export { createReputationAlarms, resolveReputationAlarmDefinitions } from "./reputation-alarms.js";
