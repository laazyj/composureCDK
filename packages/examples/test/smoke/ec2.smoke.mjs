import { findStackResources } from "./_helpers.mjs";

const STACK = "ComposureCDK-Ec2Stack";

export default {
  name: "EC2 instance checks",
  run: async ({ aws, pass, fail }) => {
    const instanceIds = findStackResources(aws, STACK, {
      type: "AWS::EC2::Instance",
    }).map((r) => r.PhysicalResourceId);

    if (instanceIds.length === 0) {
      fail(`${STACK} — no AWS::EC2::Instance resources found`);
      return;
    }

    // describe-instance-status only returns "running" instances by default.
    // --include-all-instances surfaces stopped/pending so we can report state
    // explicitly rather than getting an empty result.
    const { InstanceStatuses: statuses } = aws(
      "ec2",
      "describe-instance-status",
      "--instance-ids",
      ...instanceIds,
      "--include-all-instances",
      "--output",
      "json",
    );

    for (const id of instanceIds) {
      const status = statuses.find((s) => s.InstanceId === id);
      if (!status) {
        fail(`${id} — no status returned`);
        continue;
      }
      const state = status.InstanceState?.Name;
      const sys = status.SystemStatus?.Status;
      const inst = status.InstanceStatus?.Status;
      if (state === "running" && sys === "ok" && inst === "ok") {
        pass(`${id} — running, system=ok, instance=ok`);
      } else {
        fail(`${id} — state=${state}, system=${sys}, instance=${inst}`);
      }
    }
  },
};
