import { type IHostedZone } from "aws-cdk-lib/aws-route53";
import { type EmailIdentity } from "aws-cdk-lib/aws-ses";
import { type IConstruct } from "constructs";
import { type Resolvable } from "@composurecdk/core";
import { CNAME, TXT, type ZoneRecordsBuilderResult, zoneRecords } from "@composurecdk/route53/zone";

/**
 * What to publish, discriminated by DKIM mode. The identity builder validates
 * and fills this in, so the publisher never handles missing BYODKIM inputs.
 */
export type PublishDkimSpec =
  | { readonly mode: "easy" }
  | {
      readonly mode: "byo";
      readonly domain: string;
      readonly selector: string;
      readonly publicKey: string;
    };

/**
 * Publishes the DKIM DNS records for `identity` into `zone`, branching on DKIM
 * mode. DKIM domain-knowledge (three CNAMEs vs. one TXT, the token selectors)
 * lives here; `@composurecdk/route53` owns only the DNS primitive.
 *
 * - **Easy DKIM** → three CNAMEs. The record names are `Fn::GetAtt` tokens that
 *   already carry the full domain, so each uses `absoluteName` (else CDK
 *   double-appends the zone) and a stable `id` (a token cannot be a construct id).
 * - **BYODKIM** → one TXT at `<selector>._domainkey.<domain>` holding `p=<key>`.
 *
 * Runs inside the identity builder's `build()`, where the tokens are concrete.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy-managing.html
 */
export function publishDkimRecords(
  scope: IConstruct,
  id: string,
  identity: EmailIdentity,
  spec: PublishDkimSpec,
  zone: Resolvable<IHostedZone>,
  context: Record<string, object>,
): ZoneRecordsBuilderResult {
  const specs =
    spec.mode === "easy"
      ? [
          CNAME(identity.dkimDnsTokenName1, identity.dkimDnsTokenValue1, {
            absoluteName: true,
            id: "dkim1",
          }),
          CNAME(identity.dkimDnsTokenName2, identity.dkimDnsTokenValue2, {
            absoluteName: true,
            id: "dkim2",
          }),
          CNAME(identity.dkimDnsTokenName3, identity.dkimDnsTokenValue3, {
            absoluteName: true,
            id: "dkim3",
          }),
        ]
      : [
          TXT(`${spec.selector}._domainkey.${spec.domain}`, `p=${spec.publicKey}`, {
            absoluteName: true,
            id: "dkimByo",
          }),
        ];
  return zoneRecords(specs).zone(zone).build(scope, id, context);
}
