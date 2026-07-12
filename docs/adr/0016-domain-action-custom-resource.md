# ADR 0016: Domain-action custom resources — purpose-built providers for stateful SDK-only operations

- **Status:** Accepted
- **Date:** 2026-07-12

## Context

Some AWS operations have **no CloudFormation resource** — they are account-level
SDK calls only. The canonical case is `ses:SetActiveReceiptRuleSet`: a receipt
rule set is inert until it is the account's single **active** rule set, and there
is no CFN property for "active rule set" ([aws-cdk#28823](https://github.com/aws/aws-cdk/issues/28823)).
Miss the activation step and mail silently vanishes.

[`@composurecdk/custom-resources`](../../packages/custom-resources) already wraps
CDK's `AwsCustomResource` as a builder for exactly this long tail of one-off SDK
calls. Its own docs point at `setActiveReceiptRuleSet` as the motivating example,
and for a _simple_ activation it is the right tool: one SDK call per lifecycle
event.

Two facts make SES activation more than a simple call, and they generalise:

1. **Activation is account-global and singleton.** Only one rule set is active
   per account/region. If tearing down a stack clears the active slot
   unconditionally, it can disable a _different_ stack's rule set. Correct
   teardown must **describe** the active set and clear it **only if it is ours** —
   a read-modify-write.
2. **A rule set cannot be deleted while active.** So `onDelete` _must_
   deactivate; it cannot simply no-op.

`AwsCustomResource` runs one fixed SDK call per event. It cannot express
describe-then-conditionally-act. The `@composurecdk/ses` `.activate()` method
therefore needs a **purpose-built provider Lambda**, not the generic
`AwsCustomResource` builder.

This is the first instance of a pattern that will recur: a **domain builder that
owns a stateful, SDK-only operation** and expresses it as an action on the
domain construct (`.activate()`), backed by its own provider. The
[#280 / PR #294 review](https://github.com/laazyj/composureCDK/issues/279#issuecomment-4946384322)
flagged that this bar — unlike the base custom-resource builder, whose
justification-only ADR was dropped because it did not drive future behaviour —
**does** drive future behaviour as more domain-specific SDK actions are
identified, and so warrants an ADR.

## Decision

When a domain builder owns an SDK-only operation, model it as a **domain action**
on the builder (a `<verb>()` method), and choose the backing by the operation's
shape:

1. **Stateless single call** (activate with no delete subtlety, tag, enable a
   flag) → reuse `@composurecdk/custom-resources`
   `createAwsCustomResourceBuilder` internally. Prefer this; it scopes IAM and
   reads as intent.
2. **Stateful / conditional** (describe-then-act, delete-ordering constraints,
   idempotency that depends on current remote state) → a **purpose-built
   provider**: a `Provider` (from `aws-cdk-lib/custom-resources`) fronting a
   small handler `Function` whose logic branches on `event.RequestType` and the
   result of a describe call. The handler runs the AWS SDK provided by the Lambda
   runtime, so no bundling is required (`Code.fromInline`).

The first application is `@composurecdk/ses` `.activate()`:

- Create/Update → `setActiveReceiptRuleSet({ RuleSetName })`.
- Delete → `describeActiveReceiptRuleSet()`, and clear the active slot **only if
  the active set is ours** — so teardown never clobbers another stack's rule set.
- IAM is scoped to exactly `ses:SetActiveReceiptRuleSet` and
  `ses:DescribeActiveReceiptRuleSet`.

Rules for the pattern:

- **Expose the custom resource on the build result.** The `CustomResource` is a
  resource the builder created; per [architecture.md](../architecture.md#build-results-must-be-complete)
  it must appear on the result (`ReceiptRuleSetBuilderResult.activation`).
- **Default the action on when its absence is a silent footgun.** SES activation
  defaults on (opt out with `.activate(false)`): an inactive rule set drops mail
  with no error. The conditional-deactivate provider is what makes an on-by-default
  account-global mutation safe.
- **The handler's runtime logic is an inline string** — not measured by coverage
  and not unit-tested by synth assertions. Keep it minimal and obviously correct;
  cover the _builder_ code (construct + IAM assembly) via `Template` assertions.

## Consequences

- `.activate()` ships as a domain action backed by a purpose-built provider, not
  the generic `AwsCustomResource` builder — because conditional deactivation is
  not a single call. The trade-off is an untested inline handler; it is kept
  small and the surrounding wiring is fully asserted.
- Future domain builders with SDK-only operations follow the two-way decision
  above. A second stateful case joining SES is the trigger to consider extracting
  a shared `domainActionProvider(scope, id, { handler, actions })` helper; one
  instance is not enough to factor well.
- The account-global, singleton nature of SES activation is documented in the
  package README so users running multiple rule sets across stacks understand the
  active-slot arbitration and reach for the `createAwsCustomResourceBuilder`
  escape hatch if they need bespoke behaviour.
