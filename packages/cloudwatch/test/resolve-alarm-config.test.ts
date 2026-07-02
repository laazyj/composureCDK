import { describe, it, expect } from "vitest";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { resolveAlarmConfig } from "../src/resolve-alarm-config.js";
import { alarmName } from "../src/alarm-name.js";
import type { AlarmConfigDefaults } from "../src/alarm-config.js";

const DEFAULTS: AlarmConfigDefaults = {
  threshold: 10,
  evaluationPeriods: 3,
  datapointsToAlarm: 2,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};

describe("resolveAlarmConfig", () => {
  it("falls back to defaults when no user config is given", () => {
    expect(resolveAlarmConfig(undefined, DEFAULTS)).toEqual({
      alarmName: undefined,
      ...DEFAULTS,
    });
  });

  it("layers individual user overrides onto the defaults", () => {
    expect(
      resolveAlarmConfig(
        {
          threshold: 50,
          alarmName: alarmName("custom-name"),
          treatMissingData: TreatMissingData.BREACHING,
        },
        DEFAULTS,
      ),
    ).toEqual({
      alarmName: "custom-name",
      threshold: 50,
      evaluationPeriods: DEFAULTS.evaluationPeriods,
      datapointsToAlarm: DEFAULTS.datapointsToAlarm,
      treatMissingData: TreatMissingData.BREACHING,
    });
  });
});
