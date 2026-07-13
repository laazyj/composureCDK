/**
 * Activation decision logic for the SES rule-set activation custom resource,
 * kept as a typed, unit-tested function. {@link activateReceiptRuleSet}
 * serialises {@link runActivation} into the provider Lambda via `.toString()`
 * and supplies a {@link SesActivationApi} backed by `@aws-sdk/client-ses` (which
 * the Lambda runtime provides). Splitting the decision from the SDK wiring lets
 * the conditional-deactivate behaviour be type-checked and tested here, leaving
 * only a trivial SDK adapter inline.
 */

/** The CloudFormation custom-resource event fields the handler reads. */
export interface ActivationEvent {
  readonly RequestType: "Create" | "Update" | "Delete";
  readonly ResourceProperties: { readonly RuleSetName: string };
}

/** The two SES operations activation needs, abstracted so the logic is testable. */
export interface SesActivationApi {
  /** The name of the account's currently-active receipt rule set, if any. */
  getActiveRuleSetName(): Promise<string | undefined>;
  /** Activate `name`, or clear the active slot when `name` is `undefined`. */
  setActive(name: string | undefined): Promise<void>;
}

/**
 * On create/update, activate the rule set. On delete, clear the active slot
 * **only when the active set is this one** — so teardown never disables another
 * stack's rule set.
 */
export async function runActivation(
  event: ActivationEvent,
  api: SesActivationApi,
): Promise<{ PhysicalResourceId: string }> {
  const name = event.ResourceProperties.RuleSetName;
  const PhysicalResourceId = `ses-active-rule-set-${name}`;
  if (event.RequestType === "Delete") {
    if ((await api.getActiveRuleSetName()) === name) {
      await api.setActive(undefined);
    }
    return { PhysicalResourceId };
  }
  await api.setActive(name);
  return { PhysicalResourceId };
}
