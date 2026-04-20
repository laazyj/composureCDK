import { App, Duration, Fn } from "aws-cdk-lib";
import { Alpn, HttpsRecordValue } from "aws-cdk-lib/aws-route53";
import { compose, ref } from "@composurecdk/core";
import { createStackBuilder, outputs } from "@composurecdk/cloudformation";
import { createHostedZoneBuilder, type HostedZoneBuilderResult } from "@composurecdk/route53";
import {
  A,
  AAAA,
  APEX,
  CAA_IODEF,
  CAA_ISSUE,
  CAA_ISSUEWILD,
  CNAME,
  HTTPS,
  MX,
  NS,
  SRV,
  TXT,
  zoneRecords,
} from "@composurecdk/route53/zone";

/**
 * A production-like public DNS zone for `example.com`, expressed in the
 * BIND-style zone DSL.
 *
 * Demonstrates:
 * - Apex + service A/AAAA records, including a multi-address pool
 * - MX/TXT records for SPF + DMARC + MTA-STS
 * - DKIM CNAMEs pointing at an ESP
 * - SRV record for a SIP service
 * - CAA policy restricting issuance to a single CA
 * - NS delegation of an internal subdomain
 * - HTTPS service-binding record advertising HTTP/3 + HTTP/2 at the apex
 * - Composing the record set with a hosted zone and surfacing the delegation
 *   name servers as a CloudFormation output
 */
export function createDnsZoneApp(app = new App()): void {
  const { stack } = createStackBuilder()
    .description("Public DNS zone for example.com (DSL example)")
    .build(app, "ComposureCDK-DnsZoneStack");

  compose(
    {
      zone: createHostedZoneBuilder()
        .zoneName("example.com")
        .comment("Customer-facing zone managed by ComposureCDK"),

      records: zoneRecords([
        // ------------------------------------------------------------
        // Apex & web front-door
        // ------------------------------------------------------------
        A(APEX, "203.0.113.10"),
        AAAA(APEX, "2001:db8::10"),
        A("www", "203.0.113.10"),
        AAAA("www", "2001:db8::10"),

        // HA pool behind round-robin DNS. The two calls merge into one RR-set.
        A("api", "203.0.113.20"),
        A("api", "203.0.113.21", { ttl: Duration.minutes(1) }),

        // HTTPS record advertising HTTP/3 then HTTP/2 so clients can skip the
        // usual Alt-Svc bootstrap round-trip.
        HTTPS(
          APEX,
          HttpsRecordValue.service({
            alpn: [Alpn.H3, Alpn.H2],
          }),
        ),

        // ------------------------------------------------------------
        // Mail
        // ------------------------------------------------------------
        MX(APEX, 10, "mail1.example.com."),
        MX(APEX, 20, "mail2.example.com."),
        A("mail1", "203.0.113.30"),
        A("mail2", "203.0.113.31"),

        // SPF: only the listed MXes may originate mail, everything else fails
        // closed.
        TXT(APEX, "v=spf1 mx -all"),
        // DMARC: monitor for now, report aggregates to the security mailbox.
        TXT("_dmarc", "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"),
        // MTA-STS policy pointer — the policy itself is served over HTTPS by a
        // separate static-site stack.
        TXT("_mta-sts", "v=STSv1; id=20260420"),

        // DKIM selector records delegated to a managed ESP.
        CNAME("k1._domainkey", "k1.dkim.esp.example.net."),
        CNAME("k2._domainkey", "k2.dkim.esp.example.net."),

        // ------------------------------------------------------------
        // Service discovery
        // ------------------------------------------------------------
        SRV("_sip._tcp", 10, 60, 5060, "sip1.example.com."),
        SRV("_sip._tcp", 10, 40, 5060, "sip2.example.com."),

        // ------------------------------------------------------------
        // Certificate-issuance policy
        // ------------------------------------------------------------
        CAA_ISSUE(APEX, "amazon.com"),
        CAA_ISSUE(APEX, "amazontrust.com"),
        CAA_ISSUEWILD(APEX, "amazon.com"),
        CAA_IODEF(APEX, "mailto:security@example.com"),

        // ------------------------------------------------------------
        // Delegation
        // ------------------------------------------------------------
        // Hand `internal.example.com` off to a private hosted zone managed
        // elsewhere.
        NS("internal", [
          "ns-100.awsdns-01.com.",
          "ns-200.awsdns-02.co.uk.",
          "ns-300.awsdns-03.org.",
          "ns-400.awsdns-04.net.",
        ]),
      ]).zone(ref<HostedZoneBuilderResult>("zone").get("hostedZone")),
    },
    { zone: [], records: ["zone"] },
  )
    .afterBuild(
      outputs({
        NameServers: {
          value: ref("zone", (r: HostedZoneBuilderResult) =>
            Fn.join(",", r.hostedZone.hostedZoneNameServers ?? []),
          ),
          description: "Set these as NS records at the domain registrar to delegate the zone.",
        },
      }),
    )
    .build(stack, "DNS");
}
