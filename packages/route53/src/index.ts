export {
  createHostedZoneBuilder,
  type HostedZoneBuilderProps,
  type HostedZoneBuilderResult,
  type IHostedZoneBuilder,
} from "./hosted-zone-builder.js";
export {
  createARecordBuilder,
  type ARecordBuilderProps,
  type ARecordBuilderResult,
  type IARecordBuilder,
} from "./a-record-builder.js";
export {
  createAaaaRecordBuilder,
  type AaaaRecordBuilderProps,
  type AaaaRecordBuilderResult,
  type IAaaaRecordBuilder,
} from "./aaaa-record-builder.js";
export {
  createCnameRecordBuilder,
  type CnameRecordBuilderProps,
  type CnameRecordBuilderResult,
  type ICnameRecordBuilder,
} from "./cname-record-builder.js";
export {
  createTxtRecordBuilder,
  type TxtRecordBuilderProps,
  type TxtRecordBuilderResult,
  type ITxtRecordBuilder,
} from "./txt-record-builder.js";
export {
  cloudfrontAliasTarget,
  apiGatewayAliasTarget,
  apiGatewayDomainAliasTarget,
} from "./alias-targets.js";
export {
  HOSTED_ZONE_DEFAULTS,
  A_RECORD_DEFAULTS,
  AAAA_RECORD_DEFAULTS,
  CNAME_RECORD_DEFAULTS,
  TXT_RECORD_DEFAULTS,
} from "./defaults.js";
