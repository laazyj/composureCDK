import { findStackResources, resolveLambdaLogGroup, waitForLogEvents } from "./_helpers.mjs";

const STACK = "ComposureCDK-OrderProcessorStack";

export default {
  name: "SQS order processing checks",
  run: async ({ aws, pass, fail }) => {
    const [queue] = findStackResources(aws, STACK, { type: "AWS::SQS::Queue" });
    if (!queue) {
      fail(`${STACK} — orders queue not found`);
      return;
    }
    // PhysicalResourceId of an AWS::SQS::Queue is the queue URL.
    const queueUrl = queue.PhysicalResourceId;

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

    // Unique marker so the log poll can't match a stale event from a
    // previous run.
    const marker = `smoke-${process.pid}-${Date.now()}`;
    const sendStartMs = Date.now();
    aws(
      "sqs",
      "send-message",
      "--queue-url",
      queueUrl,
      "--message-body",
      marker,
      "--output",
      "json",
    );
    pass(`${queueUrl} — order message sent`);

    // The event source delivers the message to the consumer; a log line
    // carrying the marker proves the function was invoked AND its
    // execution role could read the queue and write logs.
    const processed = await waitForLogEvents(aws, {
      logGroup,
      sinceMs: sendStartMs,
      filterPattern: marker,
      timeoutMs: 60_000,
    });

    if (processed) {
      pass(`${fnName} — consumed and logged the order message`);
    } else {
      fail(`${logGroup} — order message ${marker} not processed within 60s`);
    }
  },
};
