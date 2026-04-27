import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { defaultAlarmName } from "../src/default-alarm-name.js";

describe("defaultAlarmName", () => {
  it("produces stack/id/key with kebab-cased segments", () => {
    const stack = new Stack(new App(), "MyServiceStack");
    expect(defaultAlarmName(stack, "siteAlerts", "numberOfNotificationsFailed")).toBe(
      "my-service-stack/site-alerts/number-of-notifications-failed",
    );
  });

  it("uses Stack.of(scope), not the scope's id directly", () => {
    const stack = new Stack(new App(), "OuterStack");
    expect(defaultAlarmName(stack, "cdnAlarms", "errorRate")).toBe(
      "outer-stack/cdn-alarms/error-rate",
    );
  });
});
