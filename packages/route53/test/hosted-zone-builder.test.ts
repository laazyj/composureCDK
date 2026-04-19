import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { createHostedZoneBuilder } from "../src/hosted-zone-builder.js";

function synth(configure: (b: ReturnType<typeof createHostedZoneBuilder>) => void): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createHostedZoneBuilder();
  configure(builder);
  builder.build(stack, "TestZone");
  return Template.fromStack(stack);
}

describe("HostedZoneBuilder", () => {
  it("throws when zoneName is not set", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    expect(() => createHostedZoneBuilder().build(stack, "TestZone")).toThrow(/requires a zoneName/);
  });

  it("returns a HostedZoneBuilderResult with a hostedZone property", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const result = createHostedZoneBuilder().zoneName("example.com").build(stack, "TestZone");
    expect(result.hostedZone).toBeDefined();
  });

  it("synthesises a Route53 hosted zone with the provided zone name", () => {
    const template = synth((b) => b.zoneName("example.com"));
    template.resourceCountIs("AWS::Route53::HostedZone", 1);
    template.hasResourceProperties("AWS::Route53::HostedZone", {
      Name: "example.com.",
    });
  });

  it("forwards the comment property", () => {
    const template = synth((b) => {
      b.zoneName("example.com");
      b.comment("primary customer domain");
    });
    template.hasResourceProperties("AWS::Route53::HostedZone", {
      HostedZoneConfig: { Comment: "primary customer domain" },
    });
  });

  it("forwards a pre-configured query-log group ARN", () => {
    const template = synth((b) => {
      b.zoneName("example.com");
      b.queryLogsLogGroupArn(
        "arn:aws:logs:us-east-1:111122223333:log-group:/aws/route53/example.com",
      );
    });
    template.hasResourceProperties("AWS::Route53::HostedZone", {
      QueryLoggingConfig: {
        CloudWatchLogsLogGroupArn:
          "arn:aws:logs:us-east-1:111122223333:log-group:/aws/route53/example.com",
      },
    });
  });
});
