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
  createMxRecordBuilder,
  type MxRecordBuilderProps,
  type MxRecordBuilderResult,
  type IMxRecordBuilder,
} from "./mx-record-builder.js";
export {
  createSrvRecordBuilder,
  type SrvRecordBuilderProps,
  type SrvRecordBuilderResult,
  type ISrvRecordBuilder,
} from "./srv-record-builder.js";
export {
  createCaaRecordBuilder,
  type CaaRecordBuilderProps,
  type CaaRecordBuilderResult,
  type ICaaRecordBuilder,
} from "./caa-record-builder.js";
export {
  createNsRecordBuilder,
  type NsRecordBuilderProps,
  type NsRecordBuilderResult,
  type INsRecordBuilder,
} from "./ns-record-builder.js";
export {
  createDsRecordBuilder,
  type DsRecordBuilderProps,
  type DsRecordBuilderResult,
  type IDsRecordBuilder,
} from "./ds-record-builder.js";
export {
  createHttpsRecordBuilder,
  type HttpsRecordBuilderProps,
  type HttpsRecordBuilderResult,
  type IHttpsRecordBuilder,
} from "./https-record-builder.js";
export {
  createSvcbRecordBuilder,
  type SvcbRecordBuilderProps,
  type SvcbRecordBuilderResult,
  type ISvcbRecordBuilder,
} from "./svcb-record-builder.js";
export {
  createHealthCheckBuilder,
  type HealthCheckBuilderProps,
  type HealthCheckBuilderResult,
  type IHealthCheckBuilder,
} from "./health-check-builder.js";
export {
  createHealthCheckAlarmBuilder,
  type HealthCheckAlarmBuilderProps,
  type HealthCheckAlarmBuilderResult,
  type IHealthCheckAlarmBuilder,
} from "./health-check-alarm-builder.js";
export type { HealthCheckAlarmConfig } from "./health-check-alarm-config.js";
export { HEALTH_CHECK_ALARM_DEFAULTS } from "./health-check-alarm-defaults.js";
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
  HEALTH_CHECK_DEFAULTS,
} from "./defaults.js";
