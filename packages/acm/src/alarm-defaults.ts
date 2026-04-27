import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface CertificateAlarmDefaults {
  enabled: true;
  daysToExpiry: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for ACM certificates.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CertificateManager
 */
export const CERTIFICATE_ALARM_DEFAULTS: CertificateAlarmDefaults = {
  enabled: true,

  /**
   * Alarm 45 days before expiry — AWS's recommended threshold. For public
   * certificates, ACM begins auto-renewal attempts around 60 days out, so
   * 45 days leaves a two-week window to investigate renewal failures
   * before the certificate expires.
   *
   * `treatMissingData: notBreaching` avoids false alarms after a
   * certificate has effectively expired — at that point ACM stops
   * emitting DaysToExpiry, and there is nothing left to alarm about.
   */
  daysToExpiry: {
    threshold: 45,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
