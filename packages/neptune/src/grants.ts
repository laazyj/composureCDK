import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { IDatabaseCluster } from "@aws-cdk/aws-neptune-alpha";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/**
 * Consumer-side grant helpers for a Neptune cluster's IAM-authenticated data
 * plane. Pass one to a grantee builder's `grant(...)` — e.g.
 * `role.grant(clusterGrants.connect(ref("graph", (r) => r.cluster)))`.
 *
 * Each delegates to the cluster's native `grant*` method. See ADR-0013.
 *
 * These cover the **IAM** half of reaching a cluster. The network half — the
 * security-group ingress that lets the principal open a socket at all — stays
 * on the cluster, whose own security group the rule is written into:
 * `createClusterBuilder().allowDefaultPortFrom(peer)`. A principal needs both.
 *
 * The cluster's `iamAuthentication` default is `true`; on a cluster that turns
 * it off, the alpha L2 rejects a grant outright rather than emitting an inert
 * policy, so network access is then the whole grant.
 *
 * @see https://docs.aws.amazon.com/neptune/latest/userguide/iam-auth.html
 */
export const clusterGrants = {
  /**
   * Connect to the cluster's data plane. Delegates to the cluster's
   * `grantConnect`, which grants the whole `neptune-db:*` action namespace on
   * the cluster — read, write, load, and management alike. A principal that
   * needs less than that wants a narrower policy of its own, scoped to the
   * cluster's `neptune-db` ARN.
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/iam-dp-actions.html
   */
  connect: (cluster: Resolvable<IDatabaseCluster>): Grant<IGrantable> =>
    grantVia(cluster, (c, grantee: IGrantable) => {
      c.grantConnect(grantee);
    }),
};
