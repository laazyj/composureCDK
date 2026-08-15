import { describe, expect, it } from "vitest";
import { App, CfnResource, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Construct } from "constructs";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { ILogGroupBuilder } from "@composurecdk/logs";
import { HostedZone, PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { ref } from "@composurecdk/core";
import { createCrossAccountZoneDelegationBuilder } from "../src/cross-account-zone-delegation-builder.js";
import { applyDelegationProviderLogging } from "../src/cross-account-delegation-provider-logging.js";
import { DELEGATION_PROVIDER_LOG_GROUP_NAME_PREFIX } from "../src/defaults.js";

const PARENT_ROLE_ARN = "arn:aws:iam::111122223333:role/delegation-beta";

/** The construct id aws-cdk-lib gives the singleton delegation provider. */
const PROVIDER_CONSTRUCT_ID = "Custom::CrossAccountZoneDelegationCustomResourceProvider";

function setup() {
  const app = new App();
  const stack = new Stack(app, "S", { env: { account: "444455556666", region: "eu-west-1" } });
  const childZone = new PublicHostedZone(stack, "ChildZone", { zoneName: "beta.example.com" });
  return { stack, childZone };
}

/** A builder carrying the parent-side inputs, so each test supplies only the zone. */
function minimal() {
  return createCrossAccountZoneDelegationBuilder()
    .parentHostedZoneName("example.com")
    .delegationRole(PARENT_ROLE_ARN);
}

describe("createCrossAccountZoneDelegationBuilder", () => {
  it("synthesises the delegation custom resource from the child zone's name servers", () => {
    const { stack, childZone } = setup();

    minimal().delegatedZone(childZone).build(stack, "ParentDelegation");

    Template.fromStack(stack).hasResourceProperties("Custom::CrossAccountZoneDelegation", {
      AssumeRoleArn: PARENT_ROLE_ARN,
      ParentZoneName: "example.com",
      DelegatedZoneName: "beta.example.com",
      DelegatedZoneNameServers: { "Fn::GetAtt": [Match.anyValue(), "NameServers"] },
    });
  });

  it("resolves a Resolvable delegated zone from the build context", () => {
    const { stack, childZone } = setup();

    minimal()
      .delegatedZone(
        ref<{ hostedZone: PublicHostedZone }, PublicHostedZone>("child", (r) => r.hostedZone),
      )
      .build(stack, "ParentDelegation", { child: { hostedZone: childZone } });

    Template.fromStack(stack).hasResourceProperties("Custom::CrossAccountZoneDelegation", {
      DelegatedZoneName: "beta.example.com",
    });
  });

  it("targets the parent zone by id when parentHostedZoneId is set instead", () => {
    const { stack, childZone } = setup();

    createCrossAccountZoneDelegationBuilder()
      .delegatedZone(childZone)
      .parentHostedZoneId("Z0123456789ABCDEFGHIJ")
      .delegationRole(PARENT_ROLE_ARN)
      .build(stack, "ParentDelegation");

    Template.fromStack(stack).hasResourceProperties("Custom::CrossAccountZoneDelegation", {
      ParentZoneId: "Z0123456789ABCDEFGHIJ",
    });
  });

  it("forwards assumeRoleRegion for a parent zone reached in another region", () => {
    const { stack, childZone } = setup();

    minimal()
      .delegatedZone(childZone)
      .assumeRoleRegion("us-east-1")
      .build(stack, "ParentDelegation");

    Template.fromStack(stack).hasResourceProperties("Custom::CrossAccountZoneDelegation", {
      AssumeRoleRegion: "us-east-1",
    });
  });

  describe("defaults", () => {
    it("applies a two-day TTL and a DESTROY removal policy", () => {
      const { stack, childZone } = setup();

      minimal().delegatedZone(childZone).build(stack, "ParentDelegation");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::CrossAccountZoneDelegation", {
        TTL: Duration.days(2).toSeconds(),
      });
      template.hasResource("Custom::CrossAccountZoneDelegation", { DeletionPolicy: "Delete" });
    });

    it("yields both defaults to explicit values", () => {
      const { stack, childZone } = setup();

      minimal()
        .delegatedZone(childZone)
        .ttl(Duration.minutes(30))
        .removalPolicy(RemovalPolicy.RETAIN)
        .build(stack, "ParentDelegation");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::CrossAccountZoneDelegation", {
        TTL: Duration.minutes(30).toSeconds(),
      });
      template.hasResource("Custom::CrossAccountZoneDelegation", { DeletionPolicy: "Retain" });
    });
  });

  describe("delegationRole", () => {
    it("imports a plain ARN and exposes it on the result", () => {
      const { stack, childZone } = setup();

      const result = minimal().delegatedZone(childZone).build(stack, "ParentDelegation");

      expect(result.delegationRole.roleArn).toBe(PARENT_ROLE_ARN);
      // The provider may assume precisely that role and nothing else.
      Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Action: "sts:AssumeRole", Resource: PARENT_ROLE_ARN }),
          ]),
        }),
      });
    });

    it("accepts an IRole directly and passes it through untouched", () => {
      const { stack, childZone } = setup();
      const role = new Role(stack, "SameAccountRole", {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      });

      const result = createCrossAccountZoneDelegationBuilder()
        .delegatedZone(childZone)
        .parentHostedZoneName("example.com")
        .delegationRole(role)
        .build(stack, "ParentDelegation");

      expect(result.delegationRole).toBe(role);
      Template.fromStack(stack).hasResourceProperties("Custom::CrossAccountZoneDelegation", {
        AssumeRoleArn: { "Fn::GetAtt": [Match.anyValue(), "Arn"] },
      });
    });

    it("resolves a Resolvable role ARN from the build context", () => {
      const { stack, childZone } = setup();

      const result = createCrossAccountZoneDelegationBuilder()
        .delegatedZone(childZone)
        .parentHostedZoneName("example.com")
        .delegationRole(ref<{ arn: string }, string>("parent", (r) => r.arn))
        .build(stack, "ParentDelegation", { parent: { arn: PARENT_ROLE_ARN } });

      expect(result.delegationRole.roleArn).toBe(PARENT_ROLE_ARN);
    });
  });

  describe("build-time guards", () => {
    it("requires a delegatedZone", () => {
      const { stack } = setup();

      expect(() => minimal().build(stack, "ParentDelegation")).toThrow(/requires a delegatedZone/);
    });

    it("requires a delegationRole", () => {
      const { stack, childZone } = setup();

      expect(() =>
        createCrossAccountZoneDelegationBuilder()
          .delegatedZone(childZone)
          .parentHostedZoneName("example.com")
          .build(stack, "ParentDelegation"),
      ).toThrow(/requires a delegationRole/);
    });

    it("rejects parentHostedZoneName and parentHostedZoneId together", () => {
      const { stack, childZone } = setup();

      expect(() =>
        minimal()
          .delegatedZone(childZone)
          .parentHostedZoneId("Z0123456789ABCDEFGHIJ")
          .build(stack, "ParentDelegation"),
      ).toThrow(/\.parentHostedZoneName\(\) and \.parentHostedZoneId\(\) are mutually exclusive/);
    });

    it("rejects neither parentHostedZoneName nor parentHostedZoneId", () => {
      const { stack, childZone } = setup();

      expect(() =>
        createCrossAccountZoneDelegationBuilder()
          .delegatedZone(childZone)
          .delegationRole(PARENT_ROLE_ARN)
          .build(stack, "ParentDelegation"),
      ).toThrow(/requires the parent zone/);
    });

    it("rejects a delegated zone that exposes no name servers", () => {
      const { stack } = setup();
      const imported = HostedZone.fromHostedZoneAttributes(stack, "Imported", {
        hostedZoneId: "Z0123456789ABCDEFGHIJ",
        zoneName: "beta.example.com",
      });

      expect(() => minimal().delegatedZone(imported).build(stack, "ParentDelegation")).toThrow(
        /"beta.example.com" exposes no name servers/,
      );
    });
  });

  describe("provider logging", () => {
    it("gives the provider Lambda a declared log group with the logs defaults", () => {
      const { stack, childZone } = setup();

      const result = minimal().delegatedZone(childZone).build(stack, "ParentDelegation");

      expect(result.providerLogGroup).toBeDefined();
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: `${DELEGATION_PROVIDER_LOG_GROUP_NAME_PREFIX}/S-cross-account-zone-delegation`,
        RetentionInDays: 731,
      });
      template.hasResource("AWS::Logs::LogGroup", { DeletionPolicy: "Retain" });
      template.hasResourceProperties("AWS::Lambda::Function", {
        LoggingConfig: { LogGroup: { Ref: Match.anyValue() } },
      });
    });

    it("customises the log group through the configure escape hatch", () => {
      const { stack, childZone } = setup();

      minimal()
        .delegatedZone(childZone)
        .providerLogging({ configure: (lg) => lg.retention(RetentionDays.ONE_MONTH) })
        .build(stack, "ParentDelegation");

      Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: `${DELEGATION_PROVIDER_LOG_GROUP_NAME_PREFIX}/S-cross-account-zone-delegation`,
        RetentionInDays: 30,
      });
    });

    it("warns when a customised name falls outside the /aws/lambda prefix", () => {
      const { stack, childZone } = setup();

      minimal()
        .delegatedZone(childZone)
        .providerLogging({ configure: (lg) => lg.logGroupName("/audit/delegation") })
        .build(stack, "ParentDelegation");

      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("outside the .*aws.*lambda.* prefix"),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("opts out entirely with providerLogging(false)", () => {
      const { stack, childZone } = setup();

      const result = minimal()
        .delegatedZone(childZone)
        .providerLogging(false)
        .build(stack, "ParentDelegation");

      expect(result.providerLogGroup).toBeUndefined();
      Template.fromStack(stack).resourceCountIs("AWS::Logs::LogGroup", 0);
    });

    it("shares one log group across every delegation record in the stack", () => {
      const { stack, childZone } = setup();
      const otherZone = new PublicHostedZone(stack, "OtherZone", { zoneName: "gamma.example.com" });

      const first = minimal().delegatedZone(childZone).build(stack, "BetaDelegation");
      const second = minimal().delegatedZone(otherZone).build(stack, "GammaDelegation");

      expect(second.providerLogGroup).toBe(first.providerLogGroup);
      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      template.resourceCountIs("Custom::CrossAccountZoneDelegation", 2);
      expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toHaveLength(0);
    });

    // The provider is a stack singleton, so the first record settles its log
    // group. A later record that asked for something else is handed the group
    // it will really log to, and told its setting did not take.
    it.each([
      ["providerLogging(false)", false as const, "\\.providerLogging\\(false\\)"],
      [
        "a configure callback",
        { configure: (lg: ILogGroupBuilder) => lg.retention(RetentionDays.ONE_DAY) },
        "providerLogging 'configure'",
      ],
    ])("warns when a later record sets %s over the settled singleton", (_case, cfg, expected) => {
      const { stack, childZone } = setup();
      const otherZone = new PublicHostedZone(stack, "OtherZone", { zoneName: "gamma.example.com" });

      const first = minimal().delegatedZone(childZone).build(stack, "BetaDelegation");
      const second = minimal()
        .delegatedZone(otherZone)
        .providerLogging(cfg)
        .build(stack, "GammaDelegation");

      expect(second.providerLogGroup).toBe(first.providerLogGroup);
      Template.fromStack(stack).resourceCountIs("AWS::Logs::LogGroup", 1);
      expect(
        Annotations.fromStack(stack).findWarning("*", Match.stringLikeRegexp(expected)),
      ).not.toHaveLength(0);
    });

    it("stays silent when a later record simply inherits the default", () => {
      const { stack, childZone } = setup();
      const otherZone = new PublicHostedZone(stack, "OtherZone", { zoneName: "gamma.example.com" });

      minimal().delegatedZone(childZone).providerLogging(false).build(stack, "BetaDelegation");
      const second = minimal().delegatedZone(otherZone).build(stack, "GammaDelegation");

      // The opt-out came first, so nothing was settled and the second record
      // creates the group — no conflict to report either way.
      expect(second.providerLogGroup).toBeDefined();
      expect(
        Annotations.fromStack(stack).findWarning(
          "*",
          Match.stringLikeRegexp("stack-level singleton"),
        ),
      ).toHaveLength(0);
    });

    // The provider Lambda is reached by construct path — an aws-cdk-lib
    // internal. Each shape below stands in for a future CDK that moves,
    // renames, or re-types it: the warning fires and the delegation record
    // itself is left working.
    it.each<[string, (stack: Stack) => void]>([
      [
        "the provider is absent",
        () => {
          // Nothing to seed — a bare stack has no provider singleton.
        },
      ],
      [
        "the provider has no Handler child",
        (stack) => {
          new Construct(stack, PROVIDER_CONSTRUCT_ID);
        },
      ],
      [
        "the Handler is not an L1",
        (stack) => {
          new Construct(new Construct(stack, PROVIDER_CONSTRUCT_ID), "Handler");
        },
      ],
      [
        "the Handler is not a Lambda function",
        (stack) => {
          new CfnResource(new Construct(stack, PROVIDER_CONSTRUCT_ID), "Handler", {
            type: "AWS::SQS::Queue",
          });
        },
      ],
    ])("warns and skips when %s", (_case, seed) => {
      const { stack } = setup();
      seed(stack);

      expect(applyDelegationProviderLogging(stack, undefined)).toBeUndefined();

      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("Could not find the .* provider Lambda"),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });
  });
});
