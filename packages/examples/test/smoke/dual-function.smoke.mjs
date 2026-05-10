import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findStackResources, pollUntil } from "./_helpers.mjs";

const STACK = "ComposureCDK-DualFunctionStack";

export default {
  name: "Lambda invoke checks",
  run: async ({ aws, pass, fail }) => {
    const [apiFn] = findStackResources(aws, STACK, {
      type: "AWS::Lambda::Function",
      namePattern: /api/i,
    });
    if (!apiFn) {
      fail(`${STACK} — api Lambda not found`);
      return;
    }

    const fnName = apiFn.PhysicalResourceId;
    const cfg = aws(
      "lambda",
      "get-function-configuration",
      "--function-name",
      fnName,
      "--output",
      "json",
    );
    // Lambda's default log group is /aws/lambda/<name>; this stack overrides
    // it via LoggingConfig so resolve from the live config rather than guess.
    const logGroup = cfg.LoggingConfig?.LogGroup ?? `/aws/lambda/${fnName}`;

    const outputFile = join(tmpdir(), `composurecdk-smoke-invoke-${process.pid}.json`);
    const invokeStartMs = Date.now();
    let invokeMeta;
    let responsePayload;
    try {
      invokeMeta = JSON.parse(
        execFileSync(
          "aws",
          [
            "lambda",
            "invoke",
            "--function-name",
            fnName,
            "--payload",
            "{}",
            "--cli-binary-format",
            "raw-in-base64-out",
            "--output",
            "json",
            outputFile,
          ],
          { encoding: "utf8" },
        ),
      );
      responsePayload = JSON.parse(readFileSync(outputFile, "utf8"));
    } finally {
      rmSync(outputFile, { force: true });
    }

    const okInvoke =
      invokeMeta.StatusCode === 200 &&
      !invokeMeta.FunctionError &&
      responsePayload.statusCode === 200;

    if (okInvoke) {
      pass(`${fnName} — invoked, response.statusCode=200`);
    } else {
      fail(
        `${fnName} — invoke StatusCode=${invokeMeta.StatusCode}, FunctionError=${invokeMeta.FunctionError ?? "none"}, payload=${JSON.stringify(responsePayload)}`,
      );
    }

    // Poll the log group for events emitted by this invocation. The invoke
    // API's --log-type Tail returns runtime-captured stdout, which doesn't
    // prove the execution role's CloudWatch Logs permissions — only events
    // landing in the log group do.
    const logsSeen = await pollUntil(
      () => {
        const { events } = aws(
          "logs",
          "filter-log-events",
          "--log-group-name",
          logGroup,
          "--start-time",
          String(invokeStartMs - 5_000),
          "--max-items",
          "1",
          "--output",
          "json",
        );
        return events && events.length > 0;
      },
      { timeoutMs: 30_000, intervalMs: 2_000 },
    );

    if (logsSeen) {
      pass(`${logGroup} — execution role wrote logs`);
    } else {
      fail(`${logGroup} — no log events after 30s`);
    }
  },
};
