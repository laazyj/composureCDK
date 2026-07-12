export {
  createEmailIdentityBuilder,
  type EmailIdentityBuilderProps,
  type EmailIdentityBuilderResult,
  type DkimTokens,
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
} from "./actions.js";
export { DEFAULT_RECEIPT_RULE, DEFAULT_MAIL_FROM_BEHAVIOR_ON_MX_FAILURE } from "./defaults.js";
export {
  SES_RECEIVING_REGIONS,
  RECEIVING_REGION_WARNING,
  warnIfNotReceivingRegion,
} from "./region-support.js";
