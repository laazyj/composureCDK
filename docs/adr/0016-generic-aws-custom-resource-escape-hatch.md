# ADR 0016: A generic `AwsCustomResource` escape-hatch builder with an explicit compose-ref ordering seam

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

Some AWS operations have **no CloudFormation resource** — they are account-level
SDK calls only reachable through CDK's `AwsCustomResource`. The driving case is
`ses:SetActiveReceiptRuleSet`: the one call that makes an SES receipt rule set
actually receive mail. There is no CFN property for "active rule set"; miss the
call and mail silently vanishes ([#280](https://github.com/laazyj/composureCDK/issues/280)).

Using raw `AwsCustomResource` re-derives, every time: the on-create/update and
on-delete SDK calls, a `physicalResourceId`, the IAM policy, the
`installLatestAwsSdk` choice, **and** a hand-written `node.addDependency(...)` —
because the call sits outside the `compose` graph and its parameters can't
reference sibling components as `Ref`s.

Every other ComposureCDK builder wraps _a resource_: secure defaults, recommended
alarms, grants, a meaningful result. This one wraps _"call any SDK method"_
(`service`/`action`/`parameters`). On the axes that justify most builders it is
empty. That tension — a genuinely useful primitive that is nonetheless an escape
hatch, not a resource abstraction — is what this ADR resolves.

## Decision

Add a new package, `@composurecdk/custom-resources`, exposing
`createAwsCustomResourceBuilder()` — a builder wrapping the CDK
`AwsCustomResource` construct — positioned honestly as the **blessed escape
hatch**, not a resource abstraction.

Specific rules:

1. **Its own package, not `core`.** `core` is `aws-cdk-lib`-free by design; this
   needs `aws-cdk-lib/custom-resources`. It follows the standard builder shape
   (`Lifecycle`, `props: Partial<…>`, `{...DEFAULTS, ...this.props}` merge, a
   result exposing the created construct).

2. **Not a tagged builder.** `AWS::CloudFormation::CustomResource` / `Custom::AWS`
   has no `Tags` property, so it uses plain `Builder`/`IBuilder` from `core` with
   a `composurecdk/builder-must-be-tagged` eslint-disable directive naming the
   resource (per the rule's own escape, as `@composurecdk/budgets` does).

3. **An explicit ordering seam — `dependsOn(...refs)`.** `compose` decides _build_
   order, not _deploy_ order. CloudFormation orders resource B after A only when
   B's template references A (a token) or carries an explicit `DependsOn`. But
   `AwsCustomResource` JSON-stringifies its `parameters`, and tokens buried in
   that blob frequently **don't** produce the CFN dependency — which is exactly
   why raw consumers hand-write `node.addDependency`. So the builder cannot rely
   on native token ordering. `.dependsOn(ref("ruleSet"))` resolves the named
   component against the build context, collects the construct(s) in _that
   component's_ result (a bounded walk that stops at the first construct), and
   adds a `DependsOn` to each — a precise edge for exactly the component named,
   working even when parameters are hardcoded strings.

4. **`Resolvable` parameters, IAM sugar, honest defaults.** Each call's
   `parameters` is `Resolvable<Record<string, unknown>>` so calls wire into
   `compose` via `ref`/`combine`. `.allow(actions, resources)` sugars
   `AwsCustomResourcePolicy.fromStatements`, with **`resources` required** so an
   account-level `["*"]` is written explicitly and stays visible in review;
   `.policy(...)` is the full-control escape. The only default is
   `installLatestAwsSdk: false` (determinism/speed) — no invented alarms or
   resource-style defaults.

5. **Prefer a domain builder.** For any _known_ call, a domain-specific method
   (e.g. a future SES `.activate()`,
   [#279](https://github.com/laazyj/composureCDK/issues/279)) is strictly better —
   it scopes IAM automatically and reads as intent, never exposing
   `service`/`action` strings. The generic builder is the floor for the long
   tail, not the preferred path; its docs say so, mirroring ADR-0015's "when not
   to use it".

## Consequences

- No-CFN-resource SDK calls become first-class `compose` citizens: ordered
  reliably via `dependsOn`, wired via `Resolvable` parameters, and reachable for
  `getResponseField` reads through the exposed `customResource` result — without
  hand-written IAM, physical ids, or `addDependency`.
- The escape hatch is blessed in _one_ clearly-labelled place. Known calls are
  steered toward domain builders, so the stringly-typed surface doesn't spread
  across every package.
- A future maintainer must not "simplify" `dependsOn` into an automatic walk of
  the whole build context (see Alternatives) — the explicit seam is the point.

## Alternatives considered

- **Automatic context-walk auto-dependency** — after building, depend on every
  construct found by walking the entire `context`. Rejected as too blunt: within
  a multi-construct dependency it couples the custom resource to incidental
  constructs (alarms, log groups) it never uses; under nested `compose`, `context`
  includes `parentContext` ([ADR-0003](0003-nested-compose-context-propagation.md)),
  so it would silently depend on undeclared outer siblings; and adding a construct
  to a dependency's result in a later refactor would silently add a new
  `DependsOn` (spooky action at a distance). `.dependsOn(ref(...))` names exactly
  the intended edge — "explicit over implicit", the principle `compose` already
  uses.

- **Ref-provenance auto-dependency** — teach `Ref` to carry its source-component
  key so refs used in `parameters` imply the dependency automatically, precisely.
  Deferred: it touches core `ref.ts` (a broadly-used type), beyond this package's
  scope. Revisit if `.dependsOn` proves a common footgun.

- **A generic `onCreate`/`onUpdate`/`onDelete` on every resource builder.**
  Rejected: those verbs are the custom resource's _own_ lifecycle (separate
  construct, own Lambda, own physical id and replacement semantics), so attaching
  them to a resource builder is a semantic lie; it smears a stringly-typed escape
  hatch across every package as permanent public API ([ADR-0001](0001-builder-type-emission.md));
  it doesn't cover the resource-less calls that motivate the feature; and
  `compose` already gives co-location and ordering without it.

- **A decorator ([ADR-0006](0006-decorator-builder-pattern.md))
  `withSdkCall(builder, …)`.** The idiomatic form of a _generic per-builder_
  capability, deferred: Tier 1 + `compose` cover the current need, and a decorator
  reintroduces the altitude concern. Revisit only if the pattern clears the
  ">2 consumers" bar.

- **Put the primitive in `core`.** Rejected — `core` is `aws-cdk-lib`-free; this
  needs `aws-cdk-lib/custom-resources`.
