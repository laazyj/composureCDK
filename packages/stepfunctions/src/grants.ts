import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { Activity, IStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps one of {@link IStateMachine}'s native grant methods as a capability helper. */
const capability =
  (apply: (stateMachine: IStateMachine, grantee: IGrantable) => void) =>
  (stateMachine: Resolvable<IStateMachine>): Grant<IGrantable> =>
    grantVia(stateMachine, apply);

/**
 * Consumer-side grant helpers for a Step Functions state machine. Pass one to a
 * grantee builder's `grant(...)` so that grantee may drive the state machine —
 * e.g. `createFunctionBuilder().grant(stateMachineGrants.startExecution(ref("workflow", (r) => r.stateMachine)))`.
 *
 * Note the direction: here the state machine is the **resource** and the
 * grantee is the caller. This is the mirror of
 * `createStateMachineBuilder().grant(...)`, where the state machine is the
 * **grantee** receiving access to a resource its tasks call. Each delegates to
 * the state machine's native `grant*` method. See ADR-0013.
 */
export const stateMachineGrants = {
  /** Start an execution (`states:StartExecution`). */
  startExecution: capability((sm, grantee) => {
    sm.grantStartExecution(grantee);
  }),
  /** Start a synchronous Express execution (`states:StartSyncExecution`). */
  startSyncExecution: capability((sm, grantee) => {
    sm.grantStartSyncExecution(grantee);
  }),
  /** Read the state machine, its executions and their history (`states:Describe*`, `List*`, `GetExecutionHistory`). */
  read: capability((sm, grantee) => {
    sm.grantRead(grantee);
  }),
  /** Report a task-token result back to the state machine (`states:SendTask*`). */
  taskResponse: capability((sm, grantee) => {
    sm.grantTaskResponse(grantee);
  }),
  /**
   * Redrive a failed, aborted or timed-out execution (`states:RedriveExecution`).
   *
   * Names the action through `grantExecution`, which scopes it to the state
   * machine's executions exactly as the native `grantRedriveExecution` does,
   * because that method is newer than this package's `aws-cdk-lib` floor.
   */
  redriveExecution: capability((sm, grantee) => {
    sm.grantExecution(grantee, "states:RedriveExecution");
  }),
};

/**
 * Consumer-side grant helpers for a Step Functions activity. `IActivity` has no
 * grant methods, so these take the concrete `Activity` the activity builder
 * produces and delegate to its `grant`; an activity imported with
 * `Activity.fromActivityArn` is not accepted.
 */
export const activityGrants = {
  /**
   * Work the activity: poll for tasks and report their result
   * (`states:GetActivityTask`, `SendTaskSuccess`, `SendTaskFailure`,
   * `SendTaskHeartbeat`).
   */
  worker: (activity: Resolvable<Activity>): Grant<IGrantable> =>
    grantVia(activity, (a, grantee) => {
      a.grant(
        grantee,
        "states:GetActivityTask",
        "states:SendTaskSuccess",
        "states:SendTaskFailure",
        "states:SendTaskHeartbeat",
      );
    }),
};
