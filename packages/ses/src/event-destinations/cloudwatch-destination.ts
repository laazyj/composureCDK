import { type CloudWatchDimension, EventDestination } from "aws-cdk-lib/aws-ses";

/**
 * Publishes configuration-set send events to CloudWatch as metric dimensions,
 * so bounce/complaint/delivery counts can be segmented (e.g. by message tag or
 * source IP) and alarmed on. Dimensions are static configuration, so no `ref()`
 * is involved.
 *
 * Pass to {@link IConfigurationSetBuilder.addEventDestination} together with the
 * {@link https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ses.EmailSendingEvent.html | EmailSendingEvent}s
 * to publish.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-cloudwatch.html
 */
export function cloudWatchDestination(dimensions: CloudWatchDimension[]): EventDestination {
  return EventDestination.cloudWatchDimensions(dimensions);
}
