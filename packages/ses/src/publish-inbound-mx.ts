import { Stack } from "aws-cdk-lib";
import { type RecordSetOptions } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import { type Resolvable } from "@composurecdk/core";
import { MX, type ZoneRecordsBuilderResult, zoneRecords } from "@composurecdk/route53/zone";
import { DEFAULT_INBOUND_MX_PRIORITY } from "./defaults.js";
import { warnIfNotReceivingRegion } from "./region-support.js";

/** Options for {@link IEmailIdentityBuilder.publishInboundMx}. */
export interface InboundMxOptions {
  /**
   * MX preference. Only matters when the domain has other MX records — lower
   * wins.
   *
   * @default 10
   */
  readonly priority?: number;
}

/**
 * Publishes the MX record that routes `domain`'s mail to the SES inbound
 * endpoint of the stack's Region. Without it a verified identity and an active
 * rule set never see a message, because senders have nowhere to deliver.
 *
 * The endpoint is Region-specific, so it is derived from the stack — on an
 * environment-agnostic stack it stays a token CloudFormation resolves. The
 * name is emitted absolute so a subdomain identity publishes at the subdomain,
 * not at the zone apex.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/receiving-email-mx-record.html
 */
export function publishInboundMx(
  scope: IConstruct,
  id: string,
  domain: string,
  zone: Resolvable<NonNullable<RecordSetOptions["zone"]>>,
  options: InboundMxOptions,
  context: Record<string, object>,
): ZoneRecordsBuilderResult {
  warnIfNotReceivingRegion(scope);
  const endpoint = `inbound-smtp.${Stack.of(scope).region}.amazonaws.com`;
  const priority = options.priority ?? DEFAULT_INBOUND_MX_PRIORITY;
  return zoneRecords([MX(domain, priority, endpoint, { absoluteName: true, id: "inboundMx" })])
    .zone(zone)
    .build(scope, id, context);
}
