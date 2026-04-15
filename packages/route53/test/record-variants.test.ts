import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { PublicHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { createAaaaRecordBuilder } from "../src/aaaa-record-builder.js";
import { createCnameRecordBuilder } from "../src/cname-record-builder.js";
import { createTxtRecordBuilder } from "../src/txt-record-builder.js";

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
