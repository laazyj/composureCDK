import { Lazy, Names } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

/**
 * The prefix Step Functions documents for execution-history log groups.
 *
 * Enabling logging adds the log group to the account's CloudWatch Logs
 * resource policy, which is capped at 5,120 characters; a group under
 * `/aws/vendedlogs/` is covered by one wildcard entry instead, so the account
 * does not run out of policy space as state machines are added.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/bp-cwl.html
 */
export const VENDED_LOG_GROUP_PREFIX = "/aws/vendedlogs/states/";

/** CloudWatch Logs' limit on a log group name. */
export const LOG_GROUP_NAME_MAX_LENGTH = 512;

/** Step Functions' limit on a state machine name. */
export const STATE_MACHINE_NAME_MAX_LENGTH = 80;

/**
 * A physical name unique to `owner`, at most `maxLength` characters including
 * `prefix`.
 *
 * Resolved lazily, so a name can be derived from a construct that does not
 * exist yet when the name is needed — the builder names the log group, and a
 * customer-key state machine, after the state machine it builds last.
 * `Names.uniqueResourceName` combines the stack name, construct path and a
 * hash of the path, so two owners never share a name.
 */
export function lazyUniqueName(
  owner: () => IConstruct | undefined,
  maxLength: number,
  prefix = "",
): string {
  return Lazy.string({
    produce: () => {
      const construct = owner();
      if (construct === undefined) {
        throw new Error(
          "A lazy physical name was resolved before the construct it names was built.",
        );
      }
      return (
        prefix +
        Names.uniqueResourceName(construct, {
          maxLength: maxLength - prefix.length,
          separator: "-",
        })
      );
    },
  });
}
