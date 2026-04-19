import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { PublicHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { compose, ref } from "@composurecdk/core";
import { createARecordBuilder } from "../src/a-record-builder.js";
import { cloudfrontAliasTarget } from "../src/alias-targets.js";
import {
  createHostedZoneBuilder,
  type HostedZoneBuilderResult,
} from "../src/hosted-zone-builder.js";

describe("ARecordBuilder", () => {
  it("throws when zone is not set", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    expect(() =>
      createARecordBuilder().target(RecordTarget.fromValues("1.2.3.4")).build(stack, "TestRecord"),
    ).toThrow(/requires a zone/);
  });

  it("throws when target is not set", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const zone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });
    expect(() => createARecordBuilder().zone(zone).build(stack, "TestRecord")).toThrow(
      /requires a target/,
    );
  });

  it("synthesises a value A record with the configured TTL and values", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const zone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });

    createARecordBuilder()
      .zone(zone)
      .recordName("api")
      .target(RecordTarget.fromValues("1.2.3.4"))
      .ttl(Duration.minutes(10))
      .build(stack, "TestRecord");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      Name: "api.example.com.",
      ResourceRecords: ["1.2.3.4"],
      TTL: "600",
    });
  });

  it("synthesises a CloudFront alias record via the cloudfrontAliasTarget helper", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const zone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });
    const distribution = new Distribution(stack, "Dist", {
      defaultBehavior: { origin: new HttpOrigin("origin.example.net") },
    });

    createARecordBuilder()
      .zone(zone)
      .target(cloudfrontAliasTarget(distribution))
      .build(stack, "ApexAlias");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      AliasTarget: Match.objectLike({
        DNSName: Match.objectLike({ "Fn::GetAtt": ["DistB3B78991", "DomainName"] }),
      }),
    });
  });

  it("omits the default TTL on alias targets so CDK does not warn", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const zone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });
    const distribution = new Distribution(stack, "Dist", {
      defaultBehavior: { origin: new HttpOrigin("origin.example.net") },
    });

    createARecordBuilder()
      .zone(zone)
      .target(cloudfrontAliasTarget(distribution))
      .build(stack, "ApexAlias");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      TTL: Match.absent(),
    });
  });

  it("resolves a Ref-based target when used inside compose()", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const distribution = new Distribution(stack, "Dist", {
      defaultBehavior: { origin: new HttpOrigin("origin.example.net") },
    });

    compose(
      {
        zone: createHostedZoneBuilder().zoneName("example.com"),
        apex: createARecordBuilder()
          .zone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone))
          .target(cloudfrontAliasTarget(distribution)),
      },
      { zone: [], apex: ["zone"] },
    ).build(stack, "Site");

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Route53::HostedZone", 1);
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      AliasTarget: Match.objectLike({
        DNSName: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["DomainName"]) }),
      }),
    });
  });
});
