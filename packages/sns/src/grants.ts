import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps one of {@link ITopic}'s native grant methods as a capability helper. */
const capability =
  (apply: (topic: ITopic, grantee: IGrantable) => void) =>
  (topic: Resolvable<ITopic>): Grant<IGrantable> =>
    grantVia(topic, apply);

/**
 * Consumer-side grant helpers for an SNS topic. Pass one to a grantee builder's
 * `grant(...)` — e.g.
 * `handler.grant(topicGrants.publish(ref("topic", (r) => r.topic)))`.
 *
 * Each delegates to the topic's native `grant*` method. See ADR-0013.
 */
export const topicGrants = {
  /** Publish messages (`sns:Publish`). */
  publish: capability((topic, grantee) => {
    topic.grantPublish(grantee);
  }),
  /** Subscribe endpoints (`sns:Subscribe`). */
  subscribe: capability((topic, grantee) => {
    topic.grantSubscribe(grantee);
  }),
};
