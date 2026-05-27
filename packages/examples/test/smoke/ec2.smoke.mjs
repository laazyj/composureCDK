import { findStackResources } from "./_helpers.mjs";

const STACK = "ComposureCDK-Ec2Stack";

/**
 * Post-deploy verification for the Ec2 example.
 *
 * - Deploy invariant: every EC2 instance reaches `running` state and AWS's
 *   first round of status checks has not reported `impaired`. The first
 *   status check often hasn't completed yet when smoke runs immediately
 *   after deploy — `initializing` is the normal pre-first-check state, so
 *   only `impaired` (and obviously non-running instance states) are treated
 *   as failures. Sustained-health monitoring belongs in observability, not
 *   a post-deploy smoke check.
 * - Security-group wiring: the bastion SG carries the operator-SSH
 *   ingress; the database SG carries an ingress sourced from the bastion
 *   SG's group id; the live EC2 instance is attached to the bastion SG;
 *   neither SG carries an unrestricted 0.0.0.0/0 egress (the builder's
 *   closed-egress default must survive deploy).
 *
 * SGs are identified by their CFN logical-id substrings ("bastion",
 * "database") rather than by `GroupDescription` substring — descriptions
 * carry user-facing UTF-8 (em-dashes) and are fragile to shell/encoding
 * layers, while logical ids are pinned by the compose key names.
 */
export default {
  name: "EC2 instance + security group checks",
  run: ({ aws, pass, fail }) => {
    checkInstances({ aws, pass, fail });
    checkSecurityGroups({ aws, pass, fail });
  },
};

function checkInstances({ aws, pass, fail }) {
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
    // `initializing` is the legitimate pre-first-status-check state for a
    // freshly-launched instance — accept it. `impaired` (and `not-applicable`,
    // which only appears on terminated instances) are real failures.
    const sysOk = sys === "ok" || sys === "initializing";
    const instOk = inst === "ok" || inst === "initializing";
    if (state === "running" && sysOk && instOk) {
      pass(`${id} — running, system=${sys}, instance=${inst}`);
    } else {
      fail(`${id} — state=${state}, system=${sys}, instance=${inst}`);
    }
  }
}

function checkSecurityGroups({ aws, pass, fail }) {
  const sgResources = findStackResources(aws, STACK, {
    type: "AWS::EC2::SecurityGroup",
  });

  const bastionResource = sgResources.find((r) => /bastion/i.test(r.LogicalResourceId));
  const databaseResource = sgResources.find((r) => /database/i.test(r.LogicalResourceId));

  if (!bastionResource) {
    fail(`${STACK} — bastion SG not found in stack resources`);
  }
  if (!databaseResource) {
    fail(`${STACK} — database SG not found in stack resources`);
  }
  if (!bastionResource || !databaseResource) return;

  const sgIds = [bastionResource.PhysicalResourceId, databaseResource.PhysicalResourceId];
  const { SecurityGroups: sgs } = aws(
    "ec2",
    "describe-security-groups",
    "--group-ids",
    ...sgIds,
    "--output",
    "json",
  );

  const bastion = sgs.find((sg) => sg.GroupId === bastionResource.PhysicalResourceId);
  const database = sgs.find((sg) => sg.GroupId === databaseResource.PhysicalResourceId);

  if (!bastion || !database) {
    fail(`${STACK} — describe-security-groups did not return both bastion and database SGs`);
    return;
  }

  // Cross-builder Ref check: the live EC2 instance must include the
  // bastion SG in its attached security groups. Without this, drift
  // (manual console detach, mis-applied CFN update, or a regression in
  // InstanceBuilder.securityGroup(Resolvable<>)) could leave the SG
  // rules correct on paper but disconnected from any workload.
  const instanceResources = findStackResources(aws, STACK, { type: "AWS::EC2::Instance" });
  if (instanceResources.length > 0) {
    const { Reservations: reservations } = aws(
      "ec2",
      "describe-instances",
      "--instance-ids",
      ...instanceResources.map((r) => r.PhysicalResourceId),
      "--output",
      "json",
    );
    const attachedSgIds = new Set(
      (reservations ?? [])
        .flatMap((res) => res.Instances ?? [])
        .flatMap((inst) => inst.SecurityGroups ?? [])
        .map((g) => g.GroupId),
    );
    if (attachedSgIds.has(bastion.GroupId)) {
      pass(`${STACK} — EC2 instance attached to bastion SG (${bastion.GroupId})`);
    } else {
      fail(
        `${STACK} — EC2 instance is NOT attached to bastion SG (${bastion.GroupId}); attached SGs: ${[...attachedSgIds].join(", ") || "(none)"}`,
      );
    }
  }

  // Bastion should carry the operator-SSH ingress on 192.0.2.10/32.
  const bastionSsh = (bastion.IpPermissions ?? []).find(
    (p) =>
      p.IpProtocol === "tcp" &&
      p.FromPort === 22 &&
      p.ToPort === 22 &&
      (p.IpRanges ?? []).some((r) => r.CidrIp === "192.0.2.10/32"),
  );
  if (bastionSsh) {
    pass(`${STACK} — bastion SG has operator SSH ingress on 192.0.2.10/32`);
  } else {
    fail(`${STACK} — bastion SG missing the operator SSH ingress rule`);
  }

  // Database should carry an ingress on 5432 sourced from the bastion SG.
  const dbBastionIngress = (database.IpPermissions ?? []).find(
    (p) =>
      p.IpProtocol === "tcp" &&
      p.FromPort === 5432 &&
      p.ToPort === 5432 &&
      (p.UserIdGroupPairs ?? []).some((pair) => pair.GroupId === bastion.GroupId),
  );
  if (dbBastionIngress) {
    pass(`${STACK} — database SG ingress on 5432 from bastion SG (${bastion.GroupId})`);
  } else {
    fail(`${STACK} — database SG missing the bastion-peer ingress rule on 5432`);
  }

  // Closed-egress default: neither SG should carry the implicit allow-all
  // egress rule (CIDR 0.0.0.0/0, protocol "-1"). CDK emits a placeholder
  // 255.255.255.255/32 ICMP rule for the closed state.
  for (const sg of [bastion, database]) {
    const allowAll = (sg.IpPermissionsEgress ?? []).find(
      (p) => p.IpProtocol === "-1" && (p.IpRanges ?? []).some((r) => r.CidrIp === "0.0.0.0/0"),
    );
    const label = sg.GroupName ?? sg.GroupId;
    if (allowAll) {
      fail(
        `${STACK} — ${label} has an unrestricted 0.0.0.0/0 egress rule (closed-egress default violated)`,
      );
    } else {
      pass(`${STACK} — ${label} egress closed by default`);
    }
  }
}
