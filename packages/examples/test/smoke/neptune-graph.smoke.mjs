import { findStackResources } from "./_helpers.mjs";

const STACK = "ComposureCDK-NeptuneGraphStack";

/**
 * Post-deploy liveness check for the Neptune graph example.
 *
 * Verifies the running system reached a healthy state — the cluster is
 * `available` — rather than re-asserting configuration that the synth
 * snapshot and the builder's unit tests already cover. A deeper functional
 * probe (SSM to the bastion, run a Gremlin/openCypher status query) would
 * require the bastion to be SSM-reachable; this example uses isolated
 * subnets with no egress, so that path is out of scope here.
 */
export default {
  name: "Neptune serverless cluster liveness",
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
  },
};
