import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  CaaTag,
  HttpsRecordValue,
  PublicHostedZone,
  RecordTarget,
  SvcbRecordValue,
} from "aws-cdk-lib/aws-route53";
import { cloudfrontAliasTarget } from "../src/alias-targets.js";
import { createAaaaRecordBuilder } from "../src/aaaa-record-builder.js";
import { createCnameRecordBuilder } from "../src/cname-record-builder.js";
import { createTxtRecordBuilder } from "../src/txt-record-builder.js";
import { createMxRecordBuilder } from "../src/mx-record-builder.js";
import { createSrvRecordBuilder } from "../src/srv-record-builder.js";
import { createCaaRecordBuilder } from "../src/caa-record-builder.js";
import { createNsRecordBuilder } from "../src/ns-record-builder.js";
import { createDsRecordBuilder } from "../src/ds-record-builder.js";
import { createHttpsRecordBuilder } from "../src/https-record-builder.js";
import { createSvcbRecordBuilder } from "../src/svcb-record-builder.js";

function setup(): { stack: Stack; zone: PublicHostedZone } {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const zone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });
  return { stack, zone };
}

describe("AaaaRecordBuilder", () => {
  it("synthesises an AAAA record", () => {
    const { stack, zone } = setup();
    createAaaaRecordBuilder()
      .zone(zone)
      .recordName("v6")
      .target(RecordTarget.fromIpAddresses("2001:db8::1"))
      .build(stack, "Aaaa");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "AAAA",
      Name: "v6.example.com.",
    });
  });
});

describe("CnameRecordBuilder", () => {
  it("requires a recordName", () => {
    const { stack, zone } = setup();
    expect(() =>
      createCnameRecordBuilder().zone(zone).domainName("target.example.net").build(stack, "Cname"),
    ).toThrow(/requires a recordName/);
  });

  it("requires a domainName", () => {
    const { stack, zone } = setup();
    expect(() =>
      createCnameRecordBuilder().zone(zone).recordName("sub").build(stack, "Cname"),
    ).toThrow(/requires a domainName/);
  });

  it("synthesises a CNAME record", () => {
    const { stack, zone } = setup();
    createCnameRecordBuilder()
      .zone(zone)
      .recordName("sub")
      .domainName("target.example.net")
      .build(stack, "Cname");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "CNAME",
      Name: "sub.example.com.",
      ResourceRecords: ["target.example.net"],
    });
  });
});

describe("TxtRecordBuilder", () => {
  it("requires non-empty values", () => {
    const { stack, zone } = setup();
    expect(() => createTxtRecordBuilder().zone(zone).values([]).build(stack, "Txt")).toThrow(
      /requires non-empty values/,
    );
  });

  it("synthesises a TXT record", () => {
    const { stack, zone } = setup();
    createTxtRecordBuilder()
      .zone(zone)
      .recordName("_dmarc")
      .values(["v=DMARC1; p=reject"])
      .build(stack, "Txt");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "TXT",
      Name: "_dmarc.example.com.",
    });
  });
});

describe("MxRecordBuilder", () => {
  it("requires non-empty values", () => {
    const { stack, zone } = setup();
    expect(() => createMxRecordBuilder().zone(zone).values([]).build(stack, "Mx")).toThrow(
      /requires non-empty values/,
    );
  });

  it("synthesises an MX record", () => {
    const { stack, zone } = setup();
    createMxRecordBuilder()
      .zone(zone)
      .values([
        { priority: 10, hostName: "mail1.example.com" },
        { priority: 20, hostName: "mail2.example.com" },
      ])
      .build(stack, "Mx");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "MX",
      Name: "example.com.",
      ResourceRecords: ["10 mail1.example.com", "20 mail2.example.com"],
    });
  });
});

describe("SrvRecordBuilder", () => {
  it("requires non-empty values", () => {
    const { stack, zone } = setup();
    expect(() => createSrvRecordBuilder().zone(zone).values([]).build(stack, "Srv")).toThrow(
      /requires non-empty values/,
    );
  });

  it("synthesises an SRV record", () => {
    const { stack, zone } = setup();
    createSrvRecordBuilder()
      .zone(zone)
      .recordName("_sip._tcp")
      .values([{ priority: 10, weight: 5, port: 5060, hostName: "sip.example.com" }])
      .build(stack, "Srv");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "SRV",
      Name: "_sip._tcp.example.com.",
      ResourceRecords: ["10 5 5060 sip.example.com"],
    });
  });
});

describe("CaaRecordBuilder", () => {
  it("requires non-empty values", () => {
    const { stack, zone } = setup();
    expect(() => createCaaRecordBuilder().zone(zone).values([]).build(stack, "Caa")).toThrow(
      /requires non-empty values/,
    );
  });

  it("synthesises a CAA record", () => {
    const { stack, zone } = setup();
    createCaaRecordBuilder()
      .zone(zone)
      .values([{ flag: 0, tag: CaaTag.ISSUE, value: "amazon.com" }])
      .build(stack, "Caa");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "CAA",
      Name: "example.com.",
    });
  });
});

describe("NsRecordBuilder", () => {
  it("requires a recordName (apex NS is managed by Route53)", () => {
    const { stack, zone } = setup();
    expect(() =>
      createNsRecordBuilder().zone(zone).values(["ns-1.awsdns-01.com"]).build(stack, "Ns"),
    ).toThrow(/requires a recordName/);
  });

  it("requires non-empty values", () => {
    const { stack, zone } = setup();
    expect(() =>
      createNsRecordBuilder().zone(zone).recordName("sub").values([]).build(stack, "Ns"),
    ).toThrow(/requires non-empty values/);
  });

  it("synthesises an NS record", () => {
    const { stack, zone } = setup();
    createNsRecordBuilder()
      .zone(zone)
      .recordName("sub")
      .values(["ns-1.awsdns-01.com.", "ns-2.awsdns-02.net."])
      .build(stack, "Ns");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "NS",
      Name: "sub.example.com.",
    });
  });
});

describe("DsRecordBuilder", () => {
  it("requires non-empty values", () => {
    const { stack, zone } = setup();
    expect(() => createDsRecordBuilder().zone(zone).values([]).build(stack, "Ds")).toThrow(
      /requires non-empty values/,
    );
  });

  it("synthesises a DS record", () => {
    const { stack, zone } = setup();
    createDsRecordBuilder()
      .zone(zone)
      .recordName("sub")
      .values(["12345 13 2 0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"])
      .build(stack, "Ds");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "DS",
      Name: "sub.example.com.",
    });
  });
});

describe("HttpsRecordBuilder", () => {
  it("requires exactly one of values or target", () => {
    const { stack, zone } = setup();
    expect(() => createHttpsRecordBuilder().zone(zone).build(stack, "Https")).toThrow(
      /exactly one of \.values\(\) or \.target\(\)/,
    );
    expect(() =>
      createHttpsRecordBuilder()
        .zone(zone)
        .values([HttpsRecordValue.alias("svc.example.com")])
        .target(RecordTarget.fromValues("ignored"))
        .build(stack, "HttpsBoth"),
    ).toThrow(/exactly one of \.values\(\) or \.target\(\)/);
  });

  it("rejects an empty values array with a specific error", () => {
    const { stack, zone } = setup();
    expect(() =>
      createHttpsRecordBuilder().zone(zone).values([]).build(stack, "HttpsEmpty"),
    ).toThrow(/requires non-empty values/);
  });

  it("synthesises an HTTPS record with values", () => {
    const { stack, zone } = setup();
    createHttpsRecordBuilder()
      .zone(zone)
      .values([HttpsRecordValue.alias("svc.example.com")])
      .build(stack, "Https");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "HTTPS",
      Name: "example.com.",
    });
  });

  it("synthesises a CloudFront alias HTTPS record and omits the default TTL", () => {
    const { stack, zone } = setup();
    const distribution = new Distribution(stack, "Dist", {
      defaultBehavior: { origin: new HttpOrigin("origin.example.net") },
    });

    createHttpsRecordBuilder()
      .zone(zone)
      .target(cloudfrontAliasTarget(distribution))
      .build(stack, "HttpsAlias");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "HTTPS",
      AliasTarget: Match.objectLike({
        DNSName: Match.objectLike({ "Fn::GetAtt": ["DistB3B78991", "DomainName"] }),
      }),
      TTL: Match.absent(),
    });
  });
});

describe("SvcbRecordBuilder", () => {
  it("requires non-empty values", () => {
    const { stack, zone } = setup();
    expect(() => createSvcbRecordBuilder().zone(zone).values([]).build(stack, "Svcb")).toThrow(
      /requires non-empty values/,
    );
  });

  it("synthesises an SVCB record", () => {
    const { stack, zone } = setup();
    createSvcbRecordBuilder()
      .zone(zone)
      .values([SvcbRecordValue.alias("svc.example.com")])
      .build(stack, "Svcb");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "SVCB",
      Name: "example.com.",
    });
  });
});
