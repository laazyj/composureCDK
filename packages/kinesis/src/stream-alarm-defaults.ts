import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import { DEFAULT_RETENTION_PERIOD } from "./defaults.js";
import type { StreamAlarmKey } from "./stream-alarm-config.js";

/**
 * Fraction of the stream's `retentionPeriod` at which the
 * `getRecordsIteratorAgeMilliseconds` alarm fires by default. A consumer
 * whose iterator is this old is half-way to reading records Kinesis has
 * already deleted, so the alarm marks a risk of data loss and stays
 * meaningful when retention is tuned.
 */
export const ITERATOR_AGE_ALARM_RETENTION_RATIO = 0.5;

/**
 * Shape of the recommended-alarm default set. Partial — an alarm with no
 * entry has no generic default and requires an explicit threshold when
 * enabled.
 */
export type StreamAlarmDefaults = Partial<Record<StreamAlarmKey, AlarmConfigDefaults>>;

/**
 * 5 of 5 one-minute datapoints: a sustained condition, not a single blip.
 * Also the baseline for an opt-in alarm with no generic default, whose
 * threshold must come from the user.
 */
export const SUSTAINED_FIVE_MINUTES = {
  evaluationPeriods: 5,
  datapointsToAlarm: 5,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};

/**
 * AWS-recommended default alarm configuration for Kinesis data streams.
 *
 * There is no entry for `putRecordsFailedRecords`: no generic threshold
 * suits every workload's volume, so enabling it requires an explicit
 * threshold.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
 */
export const STREAM_ALARM_DEFAULTS = {
  /**
   * {@link ITERATOR_AGE_ALARM_RETENTION_RATIO} of the default 7-day
   * retention, in milliseconds (604,800,000 ms → 302,400,000 ms). The
   * builder derives the threshold from the stream's actual
   * `retentionPeriod` at build time; this value is the baseline for the
   * default retention.
   */
  getRecordsIteratorAgeMilliseconds: {
    threshold: DEFAULT_RETENTION_PERIOD.toMilliseconds() * ITERATOR_AGE_ALARM_RETENTION_RATIO,
    evaluationPeriods: 15,
    datapointsToAlarm: 15,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** 0.01 — any sustained read throttling. */
  readProvisionedThroughputExceeded: { threshold: 0.01, ...SUSTAINED_FIVE_MINUTES },

  /** 0.01 — any sustained write throttling. */
  writeProvisionedThroughputExceeded: { threshold: 0.01, ...SUSTAINED_FIVE_MINUTES },

  /** 0.99 — fires when fewer than 99% of `PutRecord` calls succeed. */
  putRecordSuccess: { threshold: 0.99, ...SUSTAINED_FIVE_MINUTES },

  /** 0.99 — fires when fewer than 99% of `GetRecords` calls succeed. */
  getRecordsSuccess: { threshold: 0.99, ...SUSTAINED_FIVE_MINUTES },
} satisfies StreamAlarmDefaults;
