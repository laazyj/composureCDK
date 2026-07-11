# @composurecdk/custom-resources

Compose-native `AwsCustomResource` escape hatch for [ComposureCDK](../../README.md).

Some AWS operations have **no CloudFormation resource** — they are account-level SDK calls only reachable through CDK's [`AwsCustomResource`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.custom_resources.AwsCustomResource.html). The canonical example is `ses:SetActiveReceiptRuleSet`: the one call that makes an SES receipt rule set actually receive mail. There is no CFN property for "active rule set".

This package wraps `AwsCustomResource` as a builder so those calls become first-class `compose()` citizens — with a precise dependency-ordering seam, `Resolvable` parameters, and IAM sugar.

> **This is an escape hatch, not a resource abstraction.** When a domain builder exists for the call you need, prefer it — it scopes IAM automatically and reads as intent rather than plumbing (e.g. a future SES `.activate()`). Reach for this builder only for the long tail of one-off SDK calls that don't justify a domain builder.

## Usage

```ts
import { createAwsCustomResourceBuilder } from "@composurecdk/custom-resources";
import { PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import { ref } from "@composurecdk/core";

const activation = createAwsCustomResourceBuilder()
  .onUpdate({
    service: "SES",
    action: "setActiveReceiptRuleSet",
    // Resolvable params: this call can depend on a sibling builder's output
    parameters: ref<ReceiptRuleSetBuilderResult>("ruleSet").map((r) => ({
      RuleSetName: r.ruleSet.receiptRuleSetName,
    })),
    physicalResourceId: PhysicalResourceId.of("active-rule-set"),
  })
  .onDelete({ service: "SES", action: "setActiveReceiptRuleSet", parameters: {} }) // deactivate
  .dependsOn(ref<ReceiptRuleSetBuilderResult>("ruleSet"))
  .allow(["ses:SetActiveReceiptRuleSet"], ["*"]);

// In a composed system, declare the dependency so ordering is wired:
// compose({ ruleSet, activation }, { activation: ["ruleSet"] })
```

## Ordering: `dependsOn(...refs)`

`compose()` decides the order your builders _run_, but CloudFormation decides the order resources _deploy_ — and it only orders resource B after A when B's template references A (a token) or carries an explicit `DependsOn`. `AwsCustomResource` JSON-stringifies its `parameters`, and tokens buried in that blob **frequently don't** produce the CFN dependency — which is why raw consumers hand-write `activate.node.addDependency(ruleSet)`.

`.dependsOn(ref("ruleSet"))` is the explicit, reliable seam: it resolves the named component against the build context and adds a `DependsOn` to that component's construct(s) — even when the SDK call's parameters are hardcoded strings with no token, and only for the component you name (nothing incidental).

## IAM: `allow(actions, resources)`

`.allow(...)` is sugar over `AwsCustomResourcePolicy.fromStatements`. `resources` is **required** — an account-level action legitimately needs `["*"]`, but that broad grant should be written explicitly so it is visible in review:

```ts
.allow(["ses:SetActiveReceiptRuleSet"], ["*"]) // account-level action — * is legitimate and visible
```

For full control, pass any policy via `.policy(AwsCustomResourcePolicy.fromSdkCalls(...))` (mutually exclusive with `.allow`). If you supply your own `.role(...)`, a policy is optional.

### `onDelete` caveat

On stack _delete_ with multiple custom resources, CloudFormation can remove a provider's inline IAM policy **before** its `onDelete` handler runs, causing an `onDelete` SDK call to fail with `AccessDenied` ([aws-cdk#9840](https://github.com/aws/aws-cdk/issues/9840)). If your `onDelete` performs an API call that needs the granted permissions, be aware it may lose them mid-delete.

## Defaults

`createAwsCustomResourceBuilder` sets a single, unambiguously safe default (overridable via the fluent API). It deliberately does **not** invent recommended alarms or resource-style defaults — it is an escape hatch.

| Property              | Default | Rationale                                                                                                         |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `installLatestAwsSdk` | `false` | Use the SDK bundled with the provider Lambda; installing the latest at deploy time is slow and non-deterministic. |

The default is exported as `AWS_CUSTOM_RESOURCE_DEFAULTS` for visibility and testing.

## Reading response values

The build result exposes the underlying construct as `{ customResource }`, so read-style values are reachable via the standard ref machinery:

```ts
ref<AwsCustomResourceBuilderResult>("cr", (r) => r.customResource.getResponseField("Item.Id.S"));
```
