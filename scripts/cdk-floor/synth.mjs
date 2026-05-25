// Composed-system synth fixture for the cdk-floor harness
// (scripts/cdk-floor-test.mjs copies this into a throwaway project that has a
// pinned aws-cdk-lib + the packed @composurecdk packages installed, then runs
// it with `node`).
//
// It drives a representative `compose(...).build()` system across several
// builders through a real `Template.fromStack` synth and asserts invariants
// (resources exist, alarms wired) — never exact CFN output, which drifts
// across CDK versions. A failure means a published package reached for a CDK
// API the pinned floor doesn't have (the #146 class of bug). Assertions are
// version-agnostic so the same fixture works at any floor.

import { createRequire } from "node:module";
import { App, Duration, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { Template } from "aws-cdk-lib/assertions";
import { compose, ref } from "@composurecdk/core";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { createFunctionBuilder, sqsEventSource } from "@composurecdk/lambda";
import { createTopicBuilder } from "@composurecdk/sns";
import { createQueueBuilder } from "@composurecdk/sqs";

const require = createRequire(import.meta.url);
const version = require("aws-cdk-lib/package.json").version;
console.log(`aws-cdk-lib ${version}`);

const app = new App();
const stack = new Stack(app, "FloorStack");

// A queue → Lambda consumer plus an SNS alert topic, with all alarms routed to
// the topic. Exercises core (compose/ref), sqs, lambda (event source + role),
// sns, and cloudwatch (recommended + custom alarms, actions policy) — and their
// peers (cloudformation, iam, logs) transitively.
const { alerts } = compose(
  {
    alerts: createTopicBuilder().displayName("Floor Alerts"),

    orders: createQueueBuilder()
      .queueName("orders")
      .visibilityTimeout(Duration.minutes(2))
      .addAlarm("highEmptyReceiveRate", (alarm) =>
        alarm
          .metric((queue) => queue.metricNumberOfEmptyReceives({ period: Duration.minutes(5) }))
          .threshold(500)
          .greaterThan()
          .description("empty-receive rate"),
      ),

    processor: createFunctionBuilder()
      .runtime(Runtime.NODEJS_20_X)
      .handler("index.handler")
      .code(Code.fromInline("exports.handler = async () => {};"))
      .addEventSource("orders", sqsEventSource(ref("orders", (r) => r.queue))),
  },
  { alerts: [], orders: [], processor: ["orders"] },
).build(stack, "OrderProcessor");

alarmActionsPolicy(stack, { defaults: { alarmActions: [new SnsAction(alerts.topic)] } });

const template = Template.fromStack(stack);
template.resourceCountIs("AWS::SNS::Topic", 1);
template.resourceCountIs("AWS::SQS::Queue", 1);
template.resourceCountIs("AWS::Lambda::Function", 1);

const alarms = Object.values(template.findResources("AWS::CloudWatch::Alarm"));
if (alarms.length === 0) throw new Error("expected the composed system to produce alarms");
const unwired = alarms.filter((a) => !Array.isArray(a.Properties.AlarmActions));
if (unwired.length > 0) {
  throw new Error(`alarmActionsPolicy left ${unwired.length}/${alarms.length} alarm(s) unwired`);
}

console.log(
  `PASS: composed system synthesised on aws-cdk-lib ${version} ` +
    `(${alarms.length} alarms, all wired to the alert topic)`,
);
