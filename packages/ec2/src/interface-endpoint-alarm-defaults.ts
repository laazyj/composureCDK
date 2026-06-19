import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface InterfaceEndpointAlarmDefaults {
  enabled: true;
  packetsDropped: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for VPC interface endpoints.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#PrivateLinkEndpoints
 */
export const INTERFACE_ENDPOINT_ALARM_DEFAULTS: InterfaceEndpointAlarmDefaults = {
  enabled: true,

  /**
   * Any sustained packet drop at the endpoint signals a connectivity or
   * configuration problem — an unhealthy endpoint service, a security group
   * blocking traffic, or jumbo frames exceeding the 8,500-byte PrivateLink
   * MTU. Five consecutive 1-minute periods avoids false alarms from isolated
   * oversized packets while still catching persistent issues quickly.
   *
   * @see https://docs.aws.amazon.com/vpc/latest/privatelink/privatelink-troubleshoot.html
   */
  packetsDropped: {
    threshold: 0,
    evaluationPeriods: 5,
    datapointsToAlarm: 5,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
