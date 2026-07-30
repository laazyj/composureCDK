import { findStackResources, resolveLambdaLogGroup, waitForLogEvents } from "./_helpers.mjs";

const STACK = "ComposureCDK-OrderProcessorStack";

export default {
  name: "SNS → SQS order processing checks",
  run: async ({ aws, pass, fail }) => {
    // The stack holds two queues — the work queue and the subscription's
    // dead-letter queue — so match on the logical id.
    const [queue] = findStackResources(aws, STACK, {
      type: "AWS::SQS::Queue",
      namePattern: /orders/i,
    });
    if (!queue) {
      fail(`${STACK} — orders queue not found`);
      return;
    }
    // PhysicalResourceId of an AWS::SQS::Queue is the queue URL.
    const queueUrl = queue.PhysicalResourceId;

    // Two topics as well: the alert topic and the order-events intake topic.
    const [topic] = findStackResources(aws, STACK, {
      type: "AWS::SNS::Topic",
      namePattern: /orderEvents/i,
    });
    if (!topic) {
      fail(`${STACK} — order events topic not found`);
      return;
    }
    // PhysicalResourceId of an AWS::SNS::Topic is the topic ARN.
    const topicArn = topic.PhysicalResourceId;

    const [processorFn] = findStackResources(aws, STACK, {
      type: "AWS::Lambda::Function",
      namePattern: /processor/i,
    });
    if (!processorFn) {
      fail(`${STACK} — processor Lambda not found`);
      return;
    }
    const fnName = processorFn.PhysicalResourceId;
    const logGroup = resolveLambdaLogGroup(aws, fnName);

    // Unique markers so the log polls can't match a stale event from a
    // previous run.
    const run = `${process.pid}-${Date.now()}`;

    // 1. Direct send — proves the queue and its consumer are wired.
    const directMarker = `smoke-direct-${run}`;
    const directStartMs = Date.now();
    aws(
      "sqs",
      "send-message",
      "--queue-url",
      queueUrl,
      "--message-body",
      directMarker,
      "--output",
      "json",
    );
    pass(`${queueUrl} — order message sent`);

    // The event source delivers the message to the consumer; a log line
    // carrying the marker proves the function was invoked AND its
    // execution role could read the queue and write logs.
    const processed = await waitForLogEvents(aws, {
      logGroup,
      sinceMs: directStartMs,
      filterPattern: directMarker,
      timeoutMs: 60_000,
    });

    if (processed) {
      pass(`${fnName} — consumed and logged the order message`);
    } else {
      fail(`${logGroup} — order message ${directMarker} not processed within 60s`);
    }

    // 2. Publish through the intake topic — proves the SNS subscription
    // (created with a dead-letter queue attached) delivers to the queue and
    // that the topic-added queue policy permits it. Raw message delivery is
    // the SQS subscription default, so the consumer logs the published
    // payload verbatim rather than an SNS envelope.
    const fanoutMarker = `smoke-fanout-${run}`;
    const publishStartMs = Date.now();
    aws("sns", "publish", "--topic-arn", topicArn, "--message", fanoutMarker, "--output", "json");
    pass(`${topicArn} — order event published`);

    const fannedOut = await waitForLogEvents(aws, {
      logGroup,
      sinceMs: publishStartMs,
      filterPattern: fanoutMarker,
      timeoutMs: 60_000,
    });

    if (fannedOut) {
      pass(`${fnName} — consumed the order event delivered via SNS fan-out`);
    } else {
      fail(`${logGroup} — published event ${fanoutMarker} not processed within 60s`);
    }
  },
};
