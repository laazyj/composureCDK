export {
  createHostedZoneBuilder,
  type HostedZoneBuilderResult,
  type IHostedZoneBuilder,
} from "./hosted-zone-builder.js";
export {
  createARecordBuilder,
  type ARecordBuilderResult,
  type IARecordBuilder,
} from "./a-record-builder.js";
export {
  createAaaaRecordBuilder,
  type AaaaRecordBuilderResult,
  type IAaaaRecordBuilder,
} from "./aaaa-record-builder.js";
export {
  createCnameRecordBuilder,
  type CnameRecordBuilderResult,
  type ICnameRecordBuilder,
} from "./cname-record-builder.js";
export {
  createTxtRecordBuilder,
  type TxtRecordBuilderResult,
  type ITxtRecordBuilder,
} from "./txt-record-builder.js";
export {
  createMxRecordBuilder,
  type MxRecordBuilderResult,
  type IMxRecordBuilder,
} from "./mx-record-builder.js";
export {
  createSrvRecordBuilder,
  type SrvRecordBuilderResult,
  type ISrvRecordBuilder,
} from "./srv-record-builder.js";
export {
  createCaaRecordBuilder,
  type CaaRecordBuilderResult,
  type ICaaRecordBuilder,
} from "./caa-record-builder.js";
export {
  createNsRecordBuilder,
  type NsRecordBuilderResult,
  type INsRecordBuilder,
} from "./ns-record-builder.js";
export {
  createDsRecordBuilder,
  type DsRecordBuilderResult,
  type IDsRecordBuilder,
} from "./ds-record-builder.js";
export {
  createHttpsRecordBuilder,
  type HttpsRecordBuilderResult,
  type IHttpsRecordBuilder,
} from "./https-record-builder.js";
export {
  createSvcbRecordBuilder,
  type SvcbRecordBuilderResult,
  type ISvcbRecordBuilder,
} from "./svcb-record-builder.js";
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
  MX_RECORD_DEFAULTS,
  SRV_RECORD_DEFAULTS,
  CAA_RECORD_DEFAULTS,
  NS_RECORD_DEFAULTS,
  DS_RECORD_DEFAULTS,
  HTTPS_RECORD_DEFAULTS,
  SVCB_RECORD_DEFAULTS,
} from "./defaults.js";
