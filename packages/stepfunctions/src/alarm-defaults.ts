import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

/**
 * Alarm on the first occurrence in a minute; an idle resource stays OK. AWS
 * publishes no Step Functions thresholds, so every recommended alarm in this
 * package uses this library default.
 */
export const ANY_OCCURRENCE: AlarmConfigDefaults = {
  threshold: 0,
  evaluationPeriods: 1,
  datapointsToAlarm: 1,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};
