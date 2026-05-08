import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { createHostedZoneBuilder } from "../src/hosted-zone-builder.js";
import {
  QUERY_LOGGING_LOG_GROUP_NAME_PREFIX,
  QUERY_LOGGING_RESOURCE_POLICY_NAME,
} from "../src/defaults.js";

const USER_OWNED_ARN = "arn:aws:logs:us-east-1:111122223333:log-group:/custom/zone-logs";

function newStack(stackProps: { region?: string } = {}): Stack {
  const app = new App();
  return new Stack(app, "TestStack", {
    env: stackProps.region ? { account: "111122223333", region: stackProps.region } : undefined,
  });
}

function synthInUsEast1(
  configure: (b: ReturnType<typeof createHostedZoneBuilder>) => void,
): Template {
  const stack = newStack({ region: "us-east-1" });
  const builder = createHostedZoneBuilder();
  configure(builder);
  builder.build(stack, "TestZone");
  return Template.fromStack(stack);
}

describe("HostedZoneBuilder", () => {
  it("throws when zoneName is not set", () => {
    const stack = newStack({ region: "us-east-1" });
    expect(() => createHostedZoneBuilder().build(stack, "TestZone")).toThrow(/requires a zoneName/);
  });

  it("returns a HostedZoneBuilderResult with a hostedZone property", () => {
    const stack = newStack({ region: "us-east-1" });
    const result = createHostedZoneBuilder().zoneName("example.com").build(stack, "TestZone");
    expect(result.hostedZone).toBeDefined();
  });

  it("synthesises a Route53 hosted zone with the provided zone name", () => {
    const template = synthInUsEast1((b) => b.zoneName("example.com"));
    template.resourceCountIs("AWS::Route53::HostedZone", 1);
    template.hasResourceProperties("AWS::Route53::HostedZone", {
      Name: "example.com.",
    });
  });

  it("forwards the comment property", () => {
    const template = synthInUsEast1((b) => {
      b.zoneName("example.com");
      b.comment("primary customer domain");
    });
    template.hasResourceProperties("AWS::Route53::HostedZone", {
      HostedZoneConfig: { Comment: "primary customer domain" },
    });
  });
});

describe("HostedZoneBuilder query logging", () => {
  it("auto-creates a log group with secure defaults when queryLogging is left at its default", () => {
    const template = synthInUsEast1((b) => b.zoneName("example.com"));

    template.resourceCountIs("AWS::Logs::LogGroup", 1);
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: `${QUERY_LOGGING_LOG_GROUP_NAME_PREFIX}/example.com`,
      RetentionInDays: RetentionDays.TWO_YEARS,
    });
    template.hasResource("AWS::Logs::LogGroup", { DeletionPolicy: "Retain" });
  });

  it("wires the auto-created log group ARN into the hosted zone via Fn::GetAtt", () => {
    const template = synthInUsEast1((b) => b.zoneName("example.com"));

    template.hasResourceProperties("AWS::Route53::HostedZone", {
      QueryLoggingConfig: {
        CloudWatchLogsLogGroupArn: {
          "Fn::GetAtt": [Match.stringLikeRegexp("TestZoneQueryLogs"), "Arn"],
        },
      },
    });
  });

  it("creates exactly one shared resource policy with a wildcard ARN even for multiple zones", () => {
    const stack = newStack({ region: "us-east-1" });
    createHostedZoneBuilder().zoneName("example.com").build(stack, "ZoneA");
    createHostedZoneBuilder().zoneName("example.net").build(stack, "ZoneB");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Logs::ResourcePolicy", 1);
    template.resourceCountIs("AWS::Logs::LogGroup", 2);
    template.hasResourceProperties("AWS::Logs::ResourcePolicy", {
      PolicyName: QUERY_LOGGING_RESOURCE_POLICY_NAME,
    });

    // The policy document is rendered as a `Fn::Join` because the partition
    // and account-id are CDK pseudo-parameter tokens. Stringify the entire
    // resource and assert against the literal fragments — including the
    // wildcard ARN, the service principal, the actions, and the
    // confused-deputy condition.
    const resources = template.findResources("AWS::Logs::ResourcePolicy");
    const policy = JSON.stringify(Object.values(resources)[0]);
    expect(policy).toMatch(/route53\.amazonaws\.com/);
    expect(policy).toMatch(/logs:CreateLogStream/);
    expect(policy).toMatch(/logs:PutLogEvents/);
    expect(policy).toMatch(
      new RegExp(
        `log-group:${QUERY_LOGGING_LOG_GROUP_NAME_PREFIX.replace(/\//g, "\\/")}\\/\\*:\\*`,
      ),
    );
    expect(policy).toMatch(/aws:SourceAccount/);
  });

  it("user-supplied logGroupArn wins and skips auto-creation", () => {
    const stack = newStack({ region: "eu-west-2" });
    createHostedZoneBuilder()
      .zoneName("example.com")
      .queryLogging({ logGroupArn: USER_OWNED_ARN })
      .build(stack, "TestZone");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Logs::LogGroup", 0);
    template.resourceCountIs("AWS::Logs::ResourcePolicy", 0);
    template.hasResourceProperties("AWS::Route53::HostedZone", {
      QueryLoggingConfig: { CloudWatchLogsLogGroupArn: USER_OWNED_ARN },
    });
  });

  it("rejects combining configure and logGroupArn in the same call", () => {
    const stack = newStack({ region: "us-east-1" });
    expect(() =>
      createHostedZoneBuilder()
        .zoneName("example.com")
        .queryLogging({ logGroupArn: USER_OWNED_ARN, configure: (b) => b })
        .build(stack, "TestZone"),
    ).toThrow(/'configure' cannot be combined with 'logGroupArn'/);
  });

  it("configure callback can override retention without breaking the shared policy", () => {
    const template = synthInUsEast1((b) =>
      b
        .zoneName("example.com")
        .queryLogging({ configure: (lg) => lg.retention(RetentionDays.ONE_YEAR) }),
    );

    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: `${QUERY_LOGGING_LOG_GROUP_NAME_PREFIX}/example.com`,
      RetentionInDays: RetentionDays.ONE_YEAR,
    });
    template.resourceCountIs("AWS::Logs::ResourcePolicy", 1);
  });

  it("disabled with queryLogging(false) creates no log group, no resource policy, no QueryLoggingConfig", () => {
    const stack = newStack({ region: "eu-west-2" });
    createHostedZoneBuilder().zoneName("example.com").queryLogging(false).build(stack, "TestZone");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Logs::LogGroup", 0);
    template.resourceCountIs("AWS::Logs::ResourcePolicy", 0);
    template.hasResourceProperties("AWS::Route53::HostedZone", {
      Name: "example.com.",
      QueryLoggingConfig: Match.absent(),
    });
  });

  it("errors with three remediations when stack region is not us-east-1", () => {
    const stack = newStack({ region: "us-west-2" });
    expect(() =>
      createHostedZoneBuilder().zoneName("example.com").build(stack, "TestZone"),
    ).toThrow(/Route 53 accepts DNS query logs only in us-east-1/);
    expect(() =>
      createHostedZoneBuilder().zoneName("example.com").build(stack, "TestZone"),
    ).toThrow(/Deploy the stack containing this hosted zone in us-east-1/);
  });

  it("does not error when the stack region is unresolved (env-agnostic stack)", () => {
    const stack = newStack();
    expect(() =>
      createHostedZoneBuilder().zoneName("example.com").build(stack, "TestZone"),
    ).not.toThrow();
  });

  it("warns rather than errors when a user-supplied ARN points outside us-east-1", () => {
    const stack = newStack({ region: "us-east-1" });
    const wrongRegionArn = "arn:aws:logs:eu-west-1:111122223333:log-group:/aws/route53/example.com";
    createHostedZoneBuilder()
      .zoneName("example.com")
      .queryLogging({ logGroupArn: wrongRegionArn })
      .build(stack, "TestZone");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Route53::HostedZone", {
      QueryLoggingConfig: { CloudWatchLogsLogGroupArn: wrongRegionArn },
    });
    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp('references a log group in "eu-west-1"'),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("exposes the auto-created log group on the build result and undefined when disabled or BYO", () => {
    const stack = newStack({ region: "us-east-1" });
    const auto = createHostedZoneBuilder().zoneName("a.example.com").build(stack, "Auto");
    expect(auto.queryLogGroup).toBeDefined();

    const disabled = createHostedZoneBuilder()
      .zoneName("b.example.com")
      .queryLogging(false)
      .build(stack, "Disabled");
    expect(disabled.queryLogGroup).toBeUndefined();

    const byo = createHostedZoneBuilder()
      .zoneName("c.example.com")
      .queryLogging({ logGroupArn: USER_OWNED_ARN })
      .build(stack, "Byo");
    expect(byo.queryLogGroup).toBeUndefined();
  });

  it("strips the trailing dot from a fully-qualified zoneName when forming the log-group name", () => {
    const template = synthInUsEast1((b) => b.zoneName("example.com."));
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: `${QUERY_LOGGING_LOG_GROUP_NAME_PREFIX}/example.com`,
    });
  });

  it("hosted zone is wired to depend on the shared resource policy", () => {
    const stack = newStack({ region: "us-east-1" });
    createHostedZoneBuilder().zoneName("example.com").build(stack, "TestZone");
    const template = Template.fromStack(stack);
    const hostedZones = template.findResources("AWS::Route53::HostedZone");
    const zone = Object.values(hostedZones)[0] as { DependsOn?: string[] };
    expect(zone.DependsOn).toEqual(
      expect.arrayContaining([expect.stringMatching(/QueryLoggingPolicy/)]),
    );
  });

  it("warns when configure renames the log group outside the shared prefix", () => {
    const stack = newStack({ region: "us-east-1" });
    createHostedZoneBuilder()
      .zoneName("example.com")
      .queryLogging({ configure: (lg) => lg.logGroupName("/custom/route53-logs") })
      .build(stack, "TestZone");
    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp("outside the .*aws.*route53.* prefix"),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });
});
