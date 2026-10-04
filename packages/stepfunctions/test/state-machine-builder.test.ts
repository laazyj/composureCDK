import { describe, expect, it } from "vitest";
import { Duration, Stack } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { type IGrantable, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import {
  CustomerManagedEncryptionConfiguration,
  DefinitionBody,
  LogLevel,
  Pass,
  StateMachineType,
  Succeed,
} from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";
import { buildFixture, newStack, policyJson, tagsPerResource } from "@composurecdk/cdk-testing";
import { combine, compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createStateMachineBuilder } from "../src/state-machine-builder.js";
import { VENDED_LOG_GROUP_PREFIX } from "../src/physical-names.js";

const passThrough = (scope: Construct) => new Pass(scope, "PassThrough");

/** A builder that satisfies the Standard-workflow timeout rule, for tests about something else. */
const timedBuilder = () => createStateMachineBuilder().timeout(Duration.minutes(5));

const buildUntimed = buildFixture(
  () => createStateMachineBuilder().definition(passThrough),
  "Workflow",
);

const buildAndSynth = buildFixture(() => timedBuilder().definition(passThrough), "Workflow");

describe("StateMachineBuilder", () => {
  describe("definition", () => {
    it("builds the workflow from the callback, naming states by their ids", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        DefinitionString: Match.serializedJson(
          Match.objectLike({ StartAt: "PassThrough", States: { PassThrough: Match.anyValue() } }),
        ),
      });
    });

    it("creates the states in a scope of their own, so state ids do not collide with siblings", () => {
      const stack = newStack();
      for (const id of ["A", "B"]) {
        timedBuilder().definition(passThrough).build(stack, id);
      }

      for (const id of ["A", "B"]) {
        const states = stack.node.tryFindChild(`${id}Definition`);
        expect(states?.node.tryFindChild("PassThrough")).toBeDefined();
      }
    });

    it("resolves a definition wired to a sibling through ref", () => {
      const stack = newStack();
      compose(
        {
          alerts: { build: (scope: Construct, id: string) => ({ topic: new Topic(scope, id) }) },
          workflow: timedBuilder().definition(
            ref(
              "alerts",
              (r: { topic: Topic }) => (scope: Construct) =>
                new Pass(scope, "Notify", { parameters: { TopicArn: r.topic.topicArn } }),
            ),
          ),
        },
        { alerts: [], workflow: ["alerts"] },
      ).build(stack, "System");

      expect(policyJson(stack)).toContain("Notify");
    });

    it("resolves a definition assembled from several siblings with combine", () => {
      const stack = newStack();
      const topicComponent = {
        build: (scope: Construct, id: string) => ({ topic: new Topic(scope, id) }),
      };
      compose(
        {
          first: topicComponent,
          second: topicComponent,
          workflow: timedBuilder().definition(
            combine(
              {
                first: ref<{ topic: Topic }>("first").get("topic"),
                second: ref<{ topic: Topic }>("second").get("topic"),
              },
              ({ first, second }) =>
                (scope: Construct) =>
                  new Pass(scope, "First", { parameters: { Arn: first.topicArn } }).next(
                    new Pass(scope, "Second", { parameters: { Arn: second.topicArn } }),
                  ),
            ),
          ),
        },
        { first: [], second: [], workflow: ["first", "second"] },
      ).build(stack, "System");

      const json = policyJson(stack);
      expect(json).toContain("First");
      expect(json).toContain("Second");
    });

    it("accepts an ASL definitionBody with resolvable substitutions", () => {
      const { template } = buildFixture(
        createStateMachineBuilder,
        "Workflow",
      )((b) =>
        b
          .definitionBody(
            DefinitionBody.fromString(
              JSON.stringify({ StartAt: "S", States: { S: { Type: "Pass", Result: "${Stage}" } } }),
            ),
          )
          .definitionSubstitutions({ Stage: "prod" }),
      );

      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        DefinitionSubstitutions: { Stage: "prod" },
      });
    });

    it("throws when both definition and definitionBody are set", () => {
      expect(() =>
        buildAndSynth((b) =>
          b.definitionBody(DefinitionBody.fromChainable(new Succeed(newStack(), "S"))),
        ),
      ).toThrow(/mutually exclusive/);
    });

    it("throws when no workflow is set", () => {
      expect(() => createStateMachineBuilder().build(newStack(), "Workflow")).toThrow(
        /requires a workflow/,
      );
    });
  });

  describe("defaults", () => {
    it("enables X-Ray tracing", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        TracingConfiguration: { Enabled: true },
      });
    });

    it("logs a Standard workflow at ERROR, without execution data, to a vended log group", () => {
      const { template, result } = buildAndSynth();

      expect(result.logGroup).toBeDefined();
      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        LoggingConfiguration: {
          Level: "ERROR",
          IncludeExecutionData: false,
          Destinations: [
            {
              CloudWatchLogsLogGroup: {
                LogGroupArn: { "Fn::GetAtt": [Match.stringLikeRegexp("WorkflowLogs"), "Arn"] },
              },
            },
          ],
        },
      });
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: Match.stringLikeRegexp(`^${VENDED_LOG_GROUP_PREFIX}TestStack-Workflow-`),
      });
    });

    it("logs an Express workflow at ALL, its only execution history", () => {
      const { template } = buildAndSynth((b) => b.stateMachineType(StateMachineType.EXPRESS));

      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        LoggingConfiguration: Match.objectLike({ Level: "ALL", IncludeExecutionData: false }),
      });
    });

    it("applies the log group defaults: two-year retention, retained on delete", () => {
      const { template } = buildAndSynth();

      template.hasResource("AWS::Logs::LogGroup", {
        Properties: { RetentionInDays: 731 },
        DeletionPolicy: "Retain",
      });
    });

    it("merges a partial logs override over the defaults", () => {
      const { template } = buildAndSynth((b) => b.logs({ includeExecutionData: true }));

      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        LoggingConfiguration: Match.objectLike({ Level: "ERROR", IncludeExecutionData: true }),
      });
    });

    it("uses a caller-supplied log destination and creates no log group", () => {
      const { template, result, stack } = buildAndSynth((b, s) =>
        b.logs({ destination: new LogGroup(s, "Own") }),
      );

      expect(result.logGroup).toBeUndefined();
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      expect(stack.node.tryFindChild("WorkflowLogs")).toBeUndefined();
    });

    it("creates no log group when logging is turned off", () => {
      const { template, result } = buildAndSynth((b) => b.logs({ level: LogLevel.OFF }));

      expect(result.logGroup).toBeUndefined();
      template.resourceCountIs("AWS::Logs::LogGroup", 0);
      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        LoggingConfiguration: Match.absent(),
      });
    });

    it("lets the tracing default be overridden", () => {
      const { template } = buildAndSynth((b) => b.tracingEnabled(false));

      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        TracingConfiguration: { Enabled: false },
      });
    });
  });

  describe("timeout", () => {
    it("throws for a Standard workflow with no timeout", () => {
      expect(() => buildUntimed()).toThrow(/requires a timeout/);
    });

    it("validates before creating any construct, so a caught error leaves nothing behind", () => {
      const stack = newStack();

      expect(() =>
        createStateMachineBuilder().definition(passThrough).build(stack, "Workflow"),
      ).toThrow(/requires a timeout/);
      expect(stack.node.children).toHaveLength(0);
    });

    it("throws for a chain supplied through definitionBody, whose timeout CDK also writes", () => {
      expect(() =>
        buildFixture(
          createStateMachineBuilder,
          "Workflow",
        )((b, st) => b.definitionBody(DefinitionBody.fromChainable(new Pass(st, "Outside")))),
      ).toThrow(/requires a timeout/);
    });

    it("writes a configured timeout into the ASL", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        DefinitionString: Match.serializedJson(Match.objectLike({ TimeoutSeconds: 300 })),
      });
    });

    it("does not require one for an Express workflow, which is capped at five minutes", () => {
      expect(() => buildUntimed((b) => b.stateMachineType(StateMachineType.EXPRESS))).not.toThrow();
    });

    it("does not require one for an ASL document, which carries its own TimeoutSeconds", () => {
      expect(() =>
        createStateMachineBuilder()
          .definitionBody(
            DefinitionBody.fromString('{"StartAt":"S","States":{"S":{"Type":"Succeed"}}}'),
          )
          .build(newStack(), "Workflow"),
      ).not.toThrow();
    });
  });

  describe("customer-managed key", () => {
    it("names the state machine, so the key grant's ARN condition can match", () => {
      const { template } = buildAndSynth((b, s) =>
        b.encryptionConfiguration(new CustomerManagedEncryptionConfiguration(new Key(s, "Key"))),
      );

      const [stateMachine] = Object.values(
        template.findResources("AWS::StepFunctions::StateMachine"),
      ) as { Properties: { StateMachineName: string } }[];
      const name = stateMachine.Properties.StateMachineName;
      expect(name).toMatch(/^TestStack-Workflow-/);

      // The condition's ARN must end in exactly the generated name.
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Condition: {
                StringEquals: {
                  "kms:EncryptionContext:aws:states:stateMachineArn": {
                    "Fn::Join": ["", Match.arrayWith([`:stateMachine:${name}`])],
                  },
                },
              },
            }),
          ]),
        },
      });
    });

    it("keeps a caller-supplied name", () => {
      const { template } = buildAndSynth((b, s) =>
        b
          .stateMachineName("orders")
          .encryptionConfiguration(new CustomerManagedEncryptionConfiguration(new Key(s, "Key"))),
      );

      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        StateMachineName: "orders",
      });
    });

    it("resolves the configuration from a sibling key", () => {
      const stack = newStack();
      compose(
        {
          key: { build: (scope: Construct, id: string) => ({ key: new Key(scope, id) }) },
          workflow: timedBuilder()
            .definition(passThrough)
            .encryptionConfiguration(
              ref<{ key: Key }>("key")
                .get("key")
                .map((key) => new CustomerManagedEncryptionConfiguration(key)),
            ),
        },
        { key: [], workflow: ["key"] },
      ).build(stack, "System");

      expect(policyJson(stack)).toContain("CUSTOMER_MANAGED_KMS_KEY");
    });

    it("names an unencrypted state machine too, so adding a key later does not replace it", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
        StateMachineName: Match.stringLikeRegexp("^TestStack-Workflow-"),
      });
    });
  });

  describe("role", () => {
    it("uses a caller-supplied role, resolved from a sibling", () => {
      const stack = newStack();
      const role = new Role(stack, "Own", {
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      });
      const system = compose(
        {
          shared: { build: () => ({ role }) },
          workflow: timedBuilder()
            .definition(passThrough)
            .role(ref<{ role: Role }>("shared").get("role")),
        },
        { shared: [], workflow: ["shared"] },
      ).build(stack, "System");

      expect(system.workflow.role).toBe(role);
    });
  });

  describe("grant", () => {
    it("adds a sibling's grant to the execution role", () => {
      const stack = newStack();
      compose(
        {
          alerts: { build: (scope: Construct, id: string) => ({ topic: new Topic(scope, id) }) },
          workflow: timedBuilder()
            .definition(passThrough)
            .grant({
              applyTo: (grantee, context) => {
                (context.alerts as { topic: Topic }).topic.grantPublish(grantee);
              },
            }),
        },
        { alerts: [], workflow: ["alerts"] },
      ).build(stack, "System");

      expect(policyJson(stack)).toContain("sns:Publish");
    });
  });

  it("tags the state machine and its log group", () => {
    const { template } = buildAndSynth((b) => b.tag("team", "orders"));

    for (const type of ["AWS::StepFunctions::StateMachine", "AWS::Logs::LogGroup"]) {
      expect(Object.values(tagsPerResource(template, type))).toEqual([
        expect.arrayContaining([{ Key: "team", Value: "orders" }]),
      ]);
    }
  });

  it("preserves its definition and grants across copy()", () => {
    const sendGrant = {
      applyTo: (grantee: IGrantable) => {
        grantee.grantPrincipal.addToPrincipalPolicy(
          new PolicyStatement({ actions: ["sqs:SendMessage"], resources: ["*"] }),
        );
      },
    };
    assertCopyPreservesState({
      factory: () => createStateMachineBuilder().timeout(Duration.minutes(1)),
      configure: (b) => {
        b.definition(passThrough);
      },
      mutate: (b) => {
        b.definition((scope) => new Succeed(scope, "Mutated")).grant(sendGrant);
      },
      build: (b) => b.build(newStack(), "Workflow"),
      inspect: (r) => {
        const json = policyJson(Stack.of(r.stateMachine));
        return [json.includes("Mutated"), json.includes("sqs:SendMessage")];
      },
    });
  });
});
