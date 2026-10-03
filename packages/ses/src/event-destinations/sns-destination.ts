import { EventDestination } from "aws-cdk-lib/aws-ses";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Publishes configuration-set send events to an SNS topic. The topic accepts a
 * {@link Resolvable}, so it can wire to a sibling component via `ref()` — e.g. a
 * topic feeding a bounce/complaint suppression workflow.
 *
 * Pass to {@link IConfigurationSetBuilder.addEventDestination} together with the
 * {@link https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ses.EmailSendingEvent.html | EmailSendingEvent}s
 * to publish.
 *
 * `topic` reads its type from CDK's own `EventDestination.snsTopic` parameter
 * rather than naming `ITopic`, so it keeps tracking the installed `aws-cdk-lib`
 * (ADR-0018).
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html
 */
export function snsDestination(
  topic: Resolvable<Parameters<typeof EventDestination.snsTopic>[0]>,
): Resolvable<EventDestination> {
  return isRef(topic)
    ? topic.map((t) => EventDestination.snsTopic(t))
    : EventDestination.snsTopic(topic);
}
