import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { GrantDelegationOptions, IHostedZone } from "aws-cdk-lib/aws-route53";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/**
 * Consumer-side grant helpers for a Route 53 hosted zone. Pass one to a grantee
 * builder's `grant(...)` so that grantee may write into the zone — e.g.
 * `role.grant(hostedZoneGrants.delegation(ref("zone", (r) => r.hostedZone)))`.
 *
 * `IHostedZone` is implemented by `PublicHostedZone` (what the hosted zone
 * builder returns), `PrivateHostedZone`, and zones imported via `fromLookup` /
 * `fromHostedZoneAttributes`, so one namespace serves every zone flavour. Each
 * delegates to the zone's native `grant*` method. See ADR-0013.
 */
export const hostedZoneGrants = {
  /**
   * Write the NS record sets that delegate a subdomain of this zone
   * (`route53:ChangeResourceRecordSets`, conditioned to `UPSERT`/`DELETE` of
   * `NS` records, plus `route53:ListHostedZonesByName`). By default the grant
   * covers every name in the zone; pass {@link GrantDelegationOptions.delegatedZoneNames}
   * to confine it to the subdomains the grantee actually owns.
   */
  delegation: (
    hostedZone: Resolvable<IHostedZone>,
    options?: GrantDelegationOptions,
  ): Grant<IGrantable> =>
    grantVia(hostedZone, (zone, grantee: IGrantable) => {
      zone.grantDelegation(grantee, options);
    }),
};
