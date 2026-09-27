import { EventDestination } from "aws-cdk-lib/aws-ses";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Publishes configuration-set send events to an EventBridge event bus. The bus
 * accepts a {@link Resolvable}, so it can wire to a sibling component via
 * `ref()`. Use EventBridge when several independent consumers need to filter and
 * react to send events with their own rules.
 *
 * SES publishes only to the account's **default** event bus — pass
 * `EventBus.fromEventBusName(scope, id, "default")`, not a custom bus. SES does
 * not reject a custom bus at deploy time; events simply never arrive.
 *
 * Pass to {@link IConfigurationSetBuilder.addEventDestination} together with the
 * {@link https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ses.EmailSendingEvent.html | EmailSendingEvent}s
 * to publish.
 *
 * `bus` reads its type from CDK's own `EventDestination.eventBus` parameter
 * rather than naming `IEventBus`, so it keeps tracking the installed
 * `aws-cdk-lib` (ADR-0018).
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-eventbridge.html
 */
export function eventBusDestination(
  bus: Resolvable<Parameters<typeof EventDestination.eventBus>[0]>,
): Resolvable<EventDestination> {
  return isRef(bus) ? bus.map((b) => EventDestination.eventBus(b)) : EventDestination.eventBus(bus);
}
