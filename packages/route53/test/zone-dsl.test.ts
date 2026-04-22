import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  Alpn,
  CaaTag,
  HttpsRecordValue,
  PublicHostedZone,
  SvcbRecordValue,
} from "aws-cdk-lib/aws-route53";
import { compose, ref } from "@composurecdk/core";
import {
  createHostedZoneBuilder,
  type HostedZoneBuilderResult,
} from "../src/hosted-zone-builder.js";
import {
  A,
  AAAA,
  APEX,
  CAA,
  CAA_IODEF,
  CAA_ISSUE,
  CAA_ISSUEWILD,
  CNAME,
  DS,
  HTTPS,
  MX,
  NS,
  SRV,
  SVCB,
  TXT,
  zoneRecords,
} from "../src/zone/index.js";

function setup(): { stack: Stack; zone: PublicHostedZone } {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const zone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });
  return { stack, zone };
}

describe("zoneRecords", () => {
  it("throws when zone is not set", () => {
    const { stack } = setup();
    expect(() => zoneRecords([A("@", "1.2.3.4")]).build(stack, "DNS")).toThrow(/requires a zone/);
  });

  it("emits an A record at the apex with undefined recordName", () => {
    const { stack, zone } = setup();
    zoneRecords([A(APEX, "1.2.3.4")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      Name: "example.com.",
      ResourceRecords: ["1.2.3.4"],
    });
  });

  it("merges A records sharing (type, name) into one RR-set", () => {
    const { stack, zone } = setup();
    zoneRecords([A("ha", "1.2.3.4"), A("ha", "5.6.7.8")])
      .zone(zone)
      .build(stack, "DNS");

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Route53::RecordSet", 1);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      Name: "ha.example.com.",
      ResourceRecords: ["1.2.3.4", "5.6.7.8"],
    });
  });

  it("accepts array form for A records", () => {
    const { stack, zone } = setup();
    zoneRecords([A("ha", ["1.2.3.4", "5.6.7.8"])])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      ResourceRecords: ["1.2.3.4", "5.6.7.8"],
    });
  });

  it("emits an AAAA record", () => {
    const { stack, zone } = setup();
    zoneRecords([AAAA("v6", "2001:db8::1")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "AAAA",
      Name: "v6.example.com.",
    });
  });

  it("rejects duplicate CNAME for the same name", () => {
    const { stack, zone } = setup();
    expect(() =>
      zoneRecords([CNAME("www", "a.example.com."), CNAME("www", "b.example.com.")])
        .zone(zone)
        .build(stack, "DNS"),
    ).toThrow(/DNS allows at most one CNAME/);
  });

  it("rejects CNAME at the apex", () => {
    const { stack, zone } = setup();
    expect(() =>
      zoneRecords([CNAME(APEX, "elsewhere.example.com.")])
        .zone(zone)
        .build(stack, "DNS"),
    ).toThrow(/apex/);
  });

  it("merges TXT values for the same name", () => {
    const { stack, zone } = setup();
    zoneRecords([TXT(APEX, "v=spf1 -all"), TXT(APEX, "MS=ms123")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "TXT",
      Name: "example.com.",
      ResourceRecords: [`"v=spf1 -all"`, `"MS=ms123"`],
    });
  });

  it("merges MX records preserving order", () => {
    const { stack, zone } = setup();
    zoneRecords([MX(APEX, 10, "mx1.example.com."), MX(APEX, 20, "mx2.example.com.")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "MX",
      ResourceRecords: ["10 mx1.example.com.", "20 mx2.example.com."],
    });
  });

  it("emits an SRV record using positional args", () => {
    const { stack, zone } = setup();
    zoneRecords([SRV("_sip._tcp", 10, 60, 5060, "sip1.example.com.")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "SRV",
      Name: "_sip._tcp.example.com.",
      ResourceRecords: ["10 60 5060 sip1.example.com."],
    });
  });

  it("emits CAA records via the tag helpers", () => {
    const { stack, zone } = setup();
    zoneRecords([CAA_ISSUE(APEX, "amazon.com"), CAA_IODEF(APEX, "mailto:sec@example.com")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "CAA",
      ResourceRecords: Match.arrayWith([
        `0 issue "amazon.com"`,
        `0 iodef "mailto:sec@example.com"`,
      ]),
    });
  });

  it("rejects NS at the apex", () => {
    const { stack, zone } = setup();
    expect(() =>
      zoneRecords([NS(APEX, "ns-1.awsdns-00.co.uk.")])
        .zone(zone)
        .build(stack, "DNS"),
    ).toThrow(/apex/);
  });

  it("emits NS records for a delegated subdomain", () => {
    const { stack, zone } = setup();
    zoneRecords([NS("internal", ["ns-1.awsdns-00.co.uk.", "ns-2.awsdns-00.com."])])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "NS",
      Name: "internal.example.com.",
      ResourceRecords: ["ns-1.awsdns-00.co.uk.", "ns-2.awsdns-00.com."],
    });
  });

  it("emits a DS record", () => {
    const { stack, zone } = setup();
    zoneRecords([DS("secure", "60485 5 1 2BB183AF5F22588179A53B0A98631FAD1A292118")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "DS",
    });
  });

  it("emits an HTTPS record with value mode", () => {
    const { stack, zone } = setup();
    zoneRecords([HTTPS(APEX, HttpsRecordValue.service({ alpn: [Alpn.H3, Alpn.H2] }))])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "HTTPS",
    });
  });

  it("emits an SVCB record", () => {
    const { stack, zone } = setup();
    zoneRecords([SVCB("_foo", SvcbRecordValue.alias("backend.example.com."))])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "SVCB",
    });
  });

  it("applies per-group TTL and comment options", () => {
    const { stack, zone } = setup();
    zoneRecords([
      A("api", "1.2.3.4", { ttl: Duration.minutes(10), comment: "primary" }),
      A("api", "5.6.7.8"),
    ])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      TTL: "600",
      Comment: "primary",
    });
  });

  it("preserves the raw CAA builder equivalence (same rdata)", () => {
    const { stack, zone } = setup();
    zoneRecords([CAA(APEX, 0, CaaTag.ISSUEWILD, "amazon.com")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "CAA",
      ResourceRecords: [`0 issuewild "amazon.com"`],
    });
  });

  it("composes with a hosted-zone builder via ref()", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");

    compose(
      {
        zone: createHostedZoneBuilder().zoneName("example.com"),
        records: zoneRecords([A(APEX, "1.2.3.4"), CNAME("www", "example.com.")]).zone(
          ref<HostedZoneBuilderResult>("zone").get("hostedZone"),
        ),
      },
      { zone: [], records: ["zone"] },
    ).build(stack, "DNS");

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Route53::HostedZone", 1);
    template.resourceCountIs("AWS::Route53::RecordSet", 2);
  });

  it("also accepts CAA_ISSUEWILD wrapper", () => {
    const { stack, zone } = setup();
    zoneRecords([CAA_ISSUEWILD(APEX, "letsencrypt.org")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "CAA",
      ResourceRecords: [`0 issuewild "letsencrypt.org"`],
    });
  });

  it("rejects an empty address array", () => {
    const { stack, zone } = setup();
    expect(() =>
      zoneRecords([A("api", [])])
        .zone(zone)
        .build(stack, "DNS"),
    ).toThrow(/at least one address/);
  });

  it("rejects an empty TXT value array", () => {
    const { stack, zone } = setup();
    expect(() =>
      zoneRecords([TXT("dmarc", [])])
        .zone(zone)
        .build(stack, "DNS"),
    ).toThrow(/at least one value/);
  });

  it("de-duplicates identical address values on merge", () => {
    const { stack, zone } = setup();
    zoneRecords([A("api", "203.0.113.20"), A("api", "203.0.113.20"), A("api", "203.0.113.21")])
      .zone(zone)
      .build(stack, "DNS");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      ResourceRecords: ["203.0.113.20", "203.0.113.21"],
    });
  });

  it("nests record resources under the builder id in the construct tree", () => {
    const { stack, zone } = setup();
    const result = zoneRecords([A(APEX, "1.2.3.4")])
      .zone(zone)
      .build(stack, "DNS");
    // Apex records use the readable "Apex" construct id (keyed by APEX ("@")
    // in the result map) so synthesised logical IDs keep a human-visible marker.
    expect(result.a["@"].record.node.path).toBe("TestStack/DNS/a/Apex");
  });

  it("uses the APEX sentinel as the result key so it cannot collide with a literal 'apex' label", () => {
    const { stack, zone } = setup();
    const result = zoneRecords([A(APEX, "1.2.3.4"), A("apex", "5.6.7.8")])
      .zone(zone)
      .build(stack, "DNS");

    expect(Object.keys(result.a).sort()).toEqual(["@", "apex"]);
    Template.fromStack(stack).resourceCountIs("AWS::Route53::RecordSet", 2);
  });
});
