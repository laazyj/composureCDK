import { describe, it, expect } from "vitest";
import type { Alarm, IAlarm } from "aws-cdk-lib/aws-cloudwatch";
import { requireAlarms } from "../src/require-alarms.js";

const alarm = (arn: string) => ({ alarmArn: arn }) as unknown as Alarm;

describe("requireAlarms", () => {
  it("returns the same record, with every alarm typed as present", () => {
    const record: { a: Alarm | undefined; b?: IAlarm } = { a: alarm("a"), b: alarm("b") };
    const required = requireAlarms(record);

    const a: Alarm = required.a;
    const b: IAlarm = required.b;
    expect(required).toBe(record);
    expect(a).toBe(record.a);
    expect(b).toBe(record.b);
  });

  it("names a missing alarm", () => {
    expect(() => requireAlarms({ a: alarm("a"), dlq: undefined })).toThrow(
      /requireAlarms: "dlq" is not present/,
    );
  });

  it("names every missing alarm", () => {
    expect(() => requireAlarms({ a: undefined, b: undefined })).toThrow(/"a", "b" are not present/);
  });
});
