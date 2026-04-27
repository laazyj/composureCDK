import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import {
  Alarm,
  AlarmRule,
  AlarmState,
  CfnAlarm,
  ComparisonOperator,
  CompositeAlarm,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Template } from "aws-cdk-lib/assertions";
import { alarmActionsPolicy } from "../src/policies/alarm-actions-policy.js";

function makeMetric(): Metric {
  return new Metric({ namespace: "Test", metricName: "Count", period: Duration.minutes(1) });
}

function makeAlarm(scope: Stack, id: string): Alarm {
  return new Alarm(scope, id, {
    metric: makeMetric(),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
}

function getActions(
  template: Template,
  resourceType: "AWS::CloudWatch::Alarm" | "AWS::CloudWatch::CompositeAlarm",
  logicalIdPrefix: string,
  key: "AlarmActions" | "OKActions" | "InsufficientDataActions" = "AlarmActions",
): unknown[] {
  const resources = template.findResources(resourceType);
  const entry = Object.entries(resources).find(([k]) => k.startsWith(logicalIdPrefix));
  if (entry === undefined) throw new Error(`no ${resourceType} with prefix ${logicalIdPrefix}`);
  const [, resource] = entry as [string, { Properties: Record<string, unknown[] | undefined> }];
  return resource.Properties[key] ?? [];
}

function getAlarmActions(template: Template, alarmLogicalIdPrefix: string): unknown[] {
  return getActions(template, "AWS::CloudWatch::Alarm", alarmLogicalIdPrefix);
}

describe("alarmActionsPolicy", () => {
  describe("detection", () => {
    it("applies defaults to every L2 Alarm in the subtree", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      makeAlarm(stack, "Errors");
      makeAlarm(stack, "Throttles");

      alarmActionsPolicy(app, { defaults: { alarmActions: [new SnsAction(topic)] } });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
      for (const resource of Object.values(template.findResources("AWS::CloudWatch::Alarm"))) {
        const props = (resource as { Properties: { AlarmActions?: unknown[] } }).Properties;
        expect(props.AlarmActions).toHaveLength(1);
      }
    });

    it("applies defaults to L2 CompositeAlarm", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      const a = makeAlarm(stack, "A");
      const b = makeAlarm(stack, "B");
      new CompositeAlarm(stack, "Composite", {
        alarmRule: AlarmRule.allOf(
          AlarmRule.fromAlarm(a, AlarmState.ALARM),
          AlarmRule.fromAlarm(b, AlarmState.ALARM),
        ),
      });

      alarmActionsPolicy(app, { defaults: { alarmActions: [new SnsAction(topic)] } });

      const template = Template.fromStack(stack);
      expect(getActions(template, "AWS::CloudWatch::CompositeAlarm", "Composite")).toHaveLength(1);
    });

    it("silently skips bare CfnAlarm (no L2 parent)", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      new CfnAlarm(stack, "Bare", {
        comparisonOperator: "GreaterThanThreshold",
        evaluationPeriods: 1,
        metricName: "Count",
        namespace: "Test",
        period: 60,
        statistic: "Sum",
        threshold: 1,
      });

      expect(() => {
        alarmActionsPolicy(app, { defaults: { alarmActions: [new SnsAction(topic)] } });
      }).not.toThrow();

      const template = Template.fromStack(stack);
      const resources = template.findResources("AWS::CloudWatch::Alarm");
      const bare = Object.values(resources)[0] as { Properties: { AlarmActions?: unknown[] } };
      expect(bare.Properties.AlarmActions).toBeUndefined();
    });

    it("does not affect non-alarm constructs", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      new Bucket(stack, "Bucket");
      makeAlarm(stack, "Errors");

      expect(() => {
        alarmActionsPolicy(app, { defaults: { alarmActions: [new SnsAction(topic)] } });
      }).not.toThrow();

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::S3::Bucket", 1);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("traverses nested stacks when applied at the App", () => {
      const app = new App();
      const parent = new Stack(app, "Parent");
      const child = new Stack(app, "Child");
      const topic = new Topic(parent, "Topic");
      makeAlarm(parent, "ParentAlarm");
      makeAlarm(child, "ChildAlarm");

      alarmActionsPolicy(app, { defaults: { alarmActions: [new SnsAction(topic)] } });

      const parentTemplate = Template.fromStack(parent);
      const childTemplate = Template.fromStack(child);
      expect(getAlarmActions(parentTemplate, "ParentAlarm")).toHaveLength(1);
      expect(getAlarmActions(childTemplate, "ChildAlarm")).toHaveLength(1);
    });
  });

  describe("matching & precedence", () => {
    it("rules append actions on top of defaults by default", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const standard = new Topic(stack, "Standard");
      const pager = new Topic(stack, "Pager");
      makeAlarm(stack, "HighSevErrors");

      alarmActionsPolicy(app, {
        defaults: { alarmActions: [new SnsAction(standard)] },
        rules: [{ match: "HighSev", alarmActions: [new SnsAction(pager)] }],
      });

      const template = Template.fromStack(stack);
      expect(getAlarmActions(template, "HighSevErrors")).toHaveLength(2);
    });

    it("string matcher hits either id or path", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      makeAlarm(stack, "LowSevAlarm");
      makeAlarm(stack, "Unrelated");

      alarmActionsPolicy(app, {
        rules: [{ match: "LowSev", alarmActions: [new SnsAction(topic)] }],
      });

      const template = Template.fromStack(stack);
      expect(getAlarmActions(template, "LowSevAlarm")).toHaveLength(1);
      expect(getAlarmActions(template, "Unrelated")).toHaveLength(0);
    });

    it("regex matcher is tested against path", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      makeAlarm(stack, "FooErrors");
      makeAlarm(stack, "Other");

      alarmActionsPolicy(app, {
        rules: [{ match: /Foo.*Errors$/, alarmActions: [new SnsAction(topic)] }],
      });

      const template = Template.fromStack(stack);
      expect(getAlarmActions(template, "FooErrors")).toHaveLength(1);
      expect(getAlarmActions(template, "Other")).toHaveLength(0);
    });

    it("predicate matcher receives the full context", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      const a = makeAlarm(stack, "A");
      const b = makeAlarm(stack, "B");
      new CompositeAlarm(stack, "Composite", {
        alarmRule: AlarmRule.allOf(
          AlarmRule.fromAlarm(a, AlarmState.ALARM),
          AlarmRule.fromAlarm(b, AlarmState.ALARM),
        ),
      });

      alarmActionsPolicy(app, {
        rules: [{ match: (ctx) => ctx.isComposite, alarmActions: [new SnsAction(topic)] }],
      });

      const template = Template.fromStack(stack);
      expect(getActions(template, "AWS::CloudWatch::CompositeAlarm", "Composite")).toHaveLength(1);
      expect(getAlarmActions(template, "A")).toHaveLength(0);
      expect(getAlarmActions(template, "B")).toHaveLength(0);
    });

    it("replaceDefaults: true suppresses defaults on matched alarms only", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const standard = new Topic(stack, "Standard");
      const pager = new Topic(stack, "Pager");
      makeAlarm(stack, "HighSevErrors");
      makeAlarm(stack, "LowSevErrors");

      alarmActionsPolicy(app, {
        defaults: { alarmActions: [new SnsAction(standard)] },
        rules: [{ match: "HighSev", replaceDefaults: true, alarmActions: [new SnsAction(pager)] }],
      });

      const template = Template.fromStack(stack);
      expect(getAlarmActions(template, "HighSevErrors")).toHaveLength(1);
      expect(getAlarmActions(template, "LowSevErrors")).toHaveLength(1);
    });

    it("appends actions from every matching rule", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const t1 = new Topic(stack, "One");
      const t2 = new Topic(stack, "Two");
      makeAlarm(stack, "MultiAlarm");

      alarmActionsPolicy(app, {
        rules: [
          { match: "Multi", alarmActions: [new SnsAction(t1)] },
          { match: "Alarm", alarmActions: [new SnsAction(t2)] },
        ],
      });

      const template = Template.fromStack(stack);
      expect(getAlarmActions(template, "MultiAlarm")).toHaveLength(2);
    });

    it("singleOnly / compositeOnly target the correct kind", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const singleTopic = new Topic(stack, "Single");
      const compTopic = new Topic(stack, "Comp");
      const a = makeAlarm(stack, "A");
      const b = makeAlarm(stack, "B");
      new CompositeAlarm(stack, "Composite", {
        alarmRule: AlarmRule.allOf(
          AlarmRule.fromAlarm(a, AlarmState.ALARM),
          AlarmRule.fromAlarm(b, AlarmState.ALARM),
        ),
      });

      alarmActionsPolicy(app, {
        rules: [
          { match: /.*/, singleOnly: true, alarmActions: [new SnsAction(singleTopic)] },
          { match: /.*/, compositeOnly: true, alarmActions: [new SnsAction(compTopic)] },
        ],
      });

      const template = Template.fromStack(stack);
      expect(getAlarmActions(template, "A")).toHaveLength(1);
      expect(getAlarmActions(template, "B")).toHaveLength(1);
      const composite = Object.values(
        template.findResources("AWS::CloudWatch::CompositeAlarm"),
      )[0] as {
        Properties: { AlarmActions?: unknown[] };
      };
      expect(composite.Properties.AlarmActions).toHaveLength(1);
    });
  });

  describe("state coverage", () => {
    it("writes okActions and insufficientDataActions to the synthesised template", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      makeAlarm(stack, "Errors");

      alarmActionsPolicy(app, {
        defaults: {
          alarmActions: [new SnsAction(topic)],
          okActions: [new SnsAction(topic)],
          insufficientDataActions: [new SnsAction(topic)],
        },
      });

      const template = Template.fromStack(stack);
      expect(getActions(template, "AWS::CloudWatch::Alarm", "Errors", "AlarmActions")).toHaveLength(
        1,
      );
      expect(getActions(template, "AWS::CloudWatch::Alarm", "Errors", "OKActions")).toHaveLength(1);
      expect(
        getActions(template, "AWS::CloudWatch::Alarm", "Errors", "InsufficientDataActions"),
      ).toHaveLength(1);
    });
  });

  describe("configuration", () => {
    it("skipIfAlreadyConfigured leaves pre-configured alarms untouched", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const preTopic = new Topic(stack, "Pre");
      const policyTopic = new Topic(stack, "Policy");
      const alarm = makeAlarm(stack, "PreConfigured");
      alarm.addAlarmAction(new SnsAction(preTopic));
      makeAlarm(stack, "Fresh");

      alarmActionsPolicy(app, {
        defaults: { alarmActions: [new SnsAction(policyTopic)] },
        skipIfAlreadyConfigured: true,
      });

      const template = Template.fromStack(stack);
      expect(getAlarmActions(template, "PreConfigured")).toHaveLength(1);
      expect(getAlarmActions(template, "Fresh")).toHaveLength(1);
    });
  });
});
