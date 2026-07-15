import { type IEventBus } from "aws-cdk-lib/aws-events";
import { EventDestination } from "aws-cdk-lib/aws-ses";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Publishes configuration-set send events to an EventBridge event bus. The bus
 * accepts a {@link Resolvable}, so it can wire to a sibling component via
 * `ref()`. Use EventBridge when several independent consumers need to filter and
 * react to send events with their own rules.
 *
 * Pass to {@link IConfigurationSetBuilder.addEventDestination} together with the
 * {@link https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ses.EmailSendingEvent.html | EmailSendingEvent}s
 * to publish.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-eventbridge.html
 */
export function eventBusDestination(bus: Resolvable<IEventBus>): Resolvable<EventDestination> {
  const build = (resolved: IEventBus): EventDestination => EventDestination.eventBus(resolved);
  return isRef(bus) ? bus.map(build) : build(bus);
}
