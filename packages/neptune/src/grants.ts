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
   * the cluster — read, write, load, and management alike. Reach for
   * {@link clusterGrants.dataAccess} where a principal needs less than that.
   */
  connect: (cluster: Resolvable<IDatabaseCluster>): Grant<IGrantable> =>
    grantVia(cluster, (c, grantee: IGrantable) => {
      c.grantConnect(grantee);
    }),

  /**
   * Perform named data-plane actions on the cluster — the least-privilege
   * alternative to {@link clusterGrants.connect}'s `neptune-db:*`. Delegates
   * to the cluster's `grant`, which scopes the actions to the cluster's own
   * `neptune-db` ARN.
   *
   * @example
   * ```ts
   * role.grant(
   *   clusterGrants.dataAccess(
   *     ref("graph", (r: ClusterBuilderResult) => r.cluster),
   *     "neptune-db:ReadDataViaQuery",
   *     "neptune-db:GetEngineStatus",
   *   ),
   * );
   * ```
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/iam-dp-actions.html
   */
  dataAccess: (cluster: Resolvable<IDatabaseCluster>, ...actions: string[]): Grant<IGrantable> =>
    grantVia(cluster, (c, grantee: IGrantable) => {
      c.grant(grantee, ...actions);
    }),
};
