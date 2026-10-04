/**
 * Decision logic for the version-pruning custom resource, kept as typed,
 * unit-tested functions. {@link pruneStateMachineVersions} serialises
 * {@link versionsToPrune} and {@link runVersionPruning} into the provider Lambda
 * via `.toString()` and supplies a {@link VersionPruningApi} backed by
 * `@aws-sdk/client-sfn`, which the Lambda runtime provides. Neither function may
 * reference anything outside its own body.
 */

/** The CloudFormation custom-resource event fields the handler reads. */
export interface VersionPruningEvent {
  readonly RequestType: "Create" | "Update" | "Delete";
  readonly ResourceProperties: {
    readonly StateMachineArn: string;
    /** CloudFormation passes every property as a string. */
    readonly Retain: string;
  };
}

/** The Step Functions operations pruning needs, abstracted so the logic is testable. */
export interface VersionPruningApi {
  /** Every published version's ARN, in any order. */
  listVersionArns(stateMachineArn: string): Promise<string[]>;
  /** The ARN of every version any alias of the state machine routes to. */
  listAliasedVersionArns(stateMachineArn: string): Promise<string[]>;
  deleteVersion(versionArn: string): Promise<void>;
}

/**
 * The versions to delete: everything but the newest `retain`, by version
 * number, and anything an alias still routes to.
 */
export function versionsToPrune(
  versionArns: readonly string[],
  retain: number,
  aliased: readonly string[],
): string[] {
  const keep = new Set(aliased);
  const number = (arn: string) => Number(arn.slice(arn.lastIndexOf(":") + 1));
  return [...versionArns]
    .sort((a, b) => number(b) - number(a))
    .filter((arn, index) => index >= retain && !keep.has(arn));
}

/**
 * On create and update, delete the versions beyond the retention limit. On
 * delete, do nothing: deleting the state machine deletes its versions.
 */
export async function runVersionPruning(
  event: VersionPruningEvent,
  api: VersionPruningApi,
): Promise<{ PhysicalResourceId: string; Data: { Deleted: number } }> {
  const stateMachineArn = event.ResourceProperties.StateMachineArn;
  const PhysicalResourceId = `${stateMachineArn}/version-pruner`;
  if (event.RequestType === "Delete") return { PhysicalResourceId, Data: { Deleted: 0 } };

  const retain = Number(event.ResourceProperties.Retain);
  const versions = await api.listVersionArns(stateMachineArn);
  // Under the limit there is nothing to delete, so skip the alias lookups.
  if (versions.length <= retain) return { PhysicalResourceId, Data: { Deleted: 0 } };
  const aliased = await api.listAliasedVersionArns(stateMachineArn);
  const doomed = versionsToPrune(versions, retain, aliased);
  for (const arn of doomed) await api.deleteVersion(arn);
  return { PhysicalResourceId, Data: { Deleted: doomed.length } };
}
