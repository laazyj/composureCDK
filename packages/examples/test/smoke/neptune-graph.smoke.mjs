import { findStackResources } from "./_helpers.mjs";

const STACK = "ComposureCDK-NeptuneGraphStack";

/**
 * Post-deploy verification for the Neptune graph example.
 *
 * - Cluster health: the Neptune cluster reaches the `available` state, has
 *   storage encryption and IAM authentication on (the builder's
 *   security defaults), and exports audit logs to CloudWatch (the
 *   well-architected logging default).
 * - Access-grant wiring: the bastion's security group appears in the
 *   cluster's attached VPC security groups, confirming the
 *   `allowAccessFrom(ref("bastion"))` network grant survived deploy. The
 *   IAM `connect` half of the grant is asserted at synth time in the unit
 *   test; here we verify the live network edge.
 */
export default {
  name: "Neptune serverless cluster + access-grant checks",
  run: ({ aws, pass, fail }) => {
    const clusterResources = findStackResources(aws, STACK, { type: "AWS::Neptune::DBCluster" });
    if (clusterResources.length === 0) {
      fail(`${STACK} — no AWS::Neptune::DBCluster resources found`);
      return;
    }
    const clusterId = clusterResources[0].PhysicalResourceId;

    const { DBClusters: clusters } = aws(
      "neptune",
      "describe-db-clusters",
      "--db-cluster-identifier",
      clusterId,
      "--output",
      "json",
    );
    const cluster = clusters?.[0];
    if (!cluster) {
      fail(`${STACK} — describe-db-clusters returned no cluster for ${clusterId}`);
      return;
    }

    if (cluster.Status === "available") {
      pass(`${STACK} — cluster ${clusterId} is available`);
    } else {
      fail(`${STACK} — cluster ${clusterId} status=${cluster.Status}`);
    }

    if (cluster.StorageEncrypted === true) {
      pass(`${STACK} — cluster storage is encrypted at rest`);
    } else {
      fail(`${STACK} — cluster storage encryption is OFF (security default violated)`);
    }

    if (cluster.IAMDatabaseAuthenticationEnabled === true) {
      pass(`${STACK} — IAM database authentication is enabled`);
    } else {
      fail(`${STACK} — IAM database authentication is OFF (security default violated)`);
    }

    const auditExported = (cluster.EnabledCloudwatchLogsExports ?? []).includes("audit");
    if (auditExported) {
      pass(`${STACK} — audit logs are exported to CloudWatch`);
    } else {
      fail(`${STACK} — audit log export is OFF (logging default violated)`);
    }

    checkBastionAccess({ aws, pass, fail, cluster });
  },
};

function checkBastionAccess({ aws, pass, fail, cluster }) {
  const bastionResources = findStackResources(aws, STACK, {
    type: "AWS::EC2::SecurityGroup",
    namePattern: /bastion/i,
  });
  if (bastionResources.length === 0) {
    fail(`${STACK} — bastion security group not found in stack resources`);
    return;
  }
  const bastionSgId = bastionResources[0].PhysicalResourceId;

  // The cluster grants ingress to the bastion by adding an ingress rule to
  // the cluster's own SG sourced from the bastion SG. Confirm the cluster's
  // SG carries that rule on the live security group.
  const clusterSgIds = (cluster.VpcSecurityGroups ?? []).map((g) => g.VpcSecurityGroupId);
  if (clusterSgIds.length === 0) {
    fail(`${STACK} — cluster has no attached VPC security groups`);
    return;
  }

  const { SecurityGroups: sgs } = aws(
    "ec2",
    "describe-security-groups",
    "--group-ids",
    ...clusterSgIds,
    "--output",
    "json",
  );

  const hasBastionIngress = (sgs ?? []).some((sg) =>
    (sg.IpPermissions ?? []).some((p) =>
      (p.UserIdGroupPairs ?? []).some((pair) => pair.GroupId === bastionSgId),
    ),
  );
  if (hasBastionIngress) {
    pass(`${STACK} — cluster SG ingress sourced from bastion SG (${bastionSgId})`);
  } else {
    fail(`${STACK} — cluster SG missing the bastion-peer ingress (allowAccessFrom wiring lost)`);
  }
}
