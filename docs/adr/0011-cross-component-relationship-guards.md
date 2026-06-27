# ADR 0011: Cross-component relationship guards — builder-registered synth-time Aspects

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

Some AWS best practices are not properties of one resource but _relationships
between two_. The motivating case (laazyj/composureCDK#123): an SQS source
queue's `visibilityTimeout` should be ≥ 6× the consumer Lambda's `timeout`, so
Lambda can retry a throttled batch before the message becomes visible again.
More relationships of this shape will surface as builders gain cross-wiring.

Three properties make these relationships hard to guard, and none is addressed
by the single-value constraint catalogue of
[ADR-0010](0010-aws-property-constraints.md):

1. **The relationship spans two components built at different times.** Under
   `compose()`, the queue is built before the function (the function depends on
   it). No single builder's `build()` sees both sides in a way that lets it
   compare — ADR-0010 validators are single-value and single-builder.
2. **The value needed is withheld by the sibling's L2.** Following CDK's
   [design guidelines][cdk-guidelines], an L2 treats its props as a write-only
   struct: `Queue` does not re-expose `visibilityTimeout`; only `QueueProps`
   carries it. A consumer holding the queue (concrete or via `ref()`) cannot
   read it from the L2.
3. **The consumer must not reach across the dependency graph to get it.**
   Surfacing the value as a field on the producer's _result_ (the rejected
   `resolvedProps` mechanism, #122/#198) widens every builder's public contract
   and exposes construct handles a consumer can wire into undeclared
   CloudFormation edges, eroding the guarantee that the `compose()` dependency
   map is the system's true edge set.

The unlock: the value is withheld only at the **L2**. The generated **L1
re-exposes the resolved CloudFormation property as a public member** —
`CfnQueue.visibilityTimeout` is a public getter. And the construct tree is fully
assembled, with final property values, by synth — exactly when CDK `Aspects`
run, the timing [ADR-0002](0002-policies.md) already uses for scope-wide
policies.

## Decision

**A builder may install a _relationship guard_: a synth-time Aspect, registered
during `build()`, that reads a sibling's resolved value off its L1 construct and
emits a suppressible warning when the relationship between the two components is
violated. The guard is dispatched on the wiring's discriminator, reads scalars
only, and stays silent whenever the value is not knowable.**

Concretely, for the first instance (`FunctionBuilder` + SQS event source):

1. **Registered by the builder, scoped to a known pair.** The guard is installed
   _inside_ `build()`, closing over the specific `(function, queue)` pair the
   builder just wired — not a user-invoked ADR-0002 Policy. Using the builder is
   the opt-in, which keeps the check **secure-by-default**.

2. **Dispatched on the wiring discriminator, never `instanceof` of CDK
   internals.** The guard is selected from a `Record<EventSourceKind, …>` keyed
   by the same discriminator the contextual alarms already use; a kind with no
   relationship to guard maps to `undefined`. The bound source's queue is
   reached through `SqsEventSource.queue` (a public getter) keyed on the same
   `"sqs"` discriminator that constructed it.

3. **Reads the value from the L1 via `queue.node.defaultChild`**, identified
   with the same jsii-safe `isCfnResource`/`cfnResourceType` idiom as
   `policy-matcher` (robust where `instanceof` fails across bundled CDK realms).
   This is a **scalar read** — it creates no construct reference and so no
   CloudFormation edge, leaving the dependency graph unperturbed.

4. **Runs at synth, via an Aspect, for order-independence.** Deferring the read
   to synth sees the _final_ `visibilityTimeout` regardless of build order or
   later mutation, reusing the Aspect timing ADR-0002 established.

5. **Warns, suppressibly; does not throw.** The relationship is advisory best
   practice, so it emits `Annotations.of(fn).addWarningV2(id, …)` under a stable,
   **exported** id a caller can silence with `acknowledgeWarning(id)` —
   deliberately distinct from ADR-0010 constraints, which throw because they gate
   validity.

6. **Silent whenever the value is not knowable, and only on actual violation.**
   It emits nothing for unresolved `Token`s, imported queues (no L1 child), or
   bare escape-hatch sources; with both sides concrete it warns only when the
   queue value falls below the computed target — never on a compliant or
   default-correct configuration.

7. **Lives in the owning package, on `aws-cdk-lib` types only.** As with
   single-domain Policies (ADR-0002 §5) and local constraint data (ADR-0010 §2),
   the guard and its dispatch table live in `@composurecdk/lambda` under
   `event-sources/`, using only `aws-cdk-lib` types (`IQueue`, `CfnQueue`). It
   introduces **no dependency on `@composurecdk/sqs`**.

## Consequences

- Cross-component best-practice relationships become real, reliable checks: a
  violation surfaces at `cdk synth`/`deploy` at the authoring site, suppressible
  by id, with no false positive on correct or default configurations. This
  resolves #123.
- **To add a guard:** register an Aspect in the producing builder's `build()`
  that reads the sibling's resolved scalar off its L1 and warns on violation,
  dispatched on the wiring's discriminator (in this package, the
  `EventSourceKind` table). A guard is the right tool _only_ when the check
  needs a value from the other component. A threshold the owning builder can
  check on its own — an SQS queue's `maxReceiveCount` floor of 5, which needs
  nothing from the consumer — stays a local check in that builder
  (`@composurecdk/sqs`'s `QueueBuilder`), not a guard here.
- The technique applies only when the sibling's value is recoverable at synth
  (its L1, or similar). A value that never reaches a synth-readable surface needs
  a different channel.
- **L1-read-at-synth is a sanctioned technique** for recovering a value an L2
  withholds, in preference to surfacing it on the producer's result type.
- A third validation idiom now sits beside the existing two, with an explicit
  boundary. **ADR-0002 Policies:** user-invoked, scope-wide, cross-cutting side
  effects. **ADR-0010 constraints:** single-value legality, throw, at `build()`.
  **This ADR — relationship guards:** builder-registered, component-pair-scoped,
  advisory, warn, at synth.
- A builder that installs a guard takes on one Aspect per wired pair; the synth
  cost is negligible.
- `architecture.md` is not yet amended for relationship guards. Following the
  "> 2 consumers" bar ADR-0002 set for its own promotion, this ADR stands alone
  until a second cross-component instance exercises the pattern.

## Alternatives considered

- **Surface the value on the producer's result (`resolvedProps`, #122/#198).**
  Rejected — see the close comments on both. It widens every builder's public
  contract and leaks construct handles that let a consumer create CloudFormation
  edges outside the declared graph; a scalar-only variant is less idiomatic
  still. The premise that justified it — "the value is unrecoverable from the
  construct" — is false at the L1.
- **A user-invoked, tree-walking Policy (ADR-0002), e.g.
  `sqsLambdaRelationshipsPolicy(scope)`.** Rejected as the _primary_ mechanism:
  it is opt-in, so it sacrifices secure-by-default, and it must re-derive the
  function↔queue pairing by resolving `CfnEventSourceMapping` ARN tokens back to
  constructs. It remains attractive as a _complementary_ opt-in tool that would
  also catch raw-CDK wirings (the "holistic Aspect keyed by CFN resource type"
  ADR-0010 anticipates); if built, it should share this guard's comparison logic.
- **Read the L1 value at `build()` instead of at synth.** Workable because the
  producer is built first, but it reads a possibly-non-final value and couples
  correctness to build order; the Aspect costs little and removes both risks.
- **Throw via `node.addValidation()` rather than warn.** Rejected: it blocks
  synth, which is wrong for advisory best practice. A below-6× visibility timeout
  is deployable and sometimes intentional; it warrants a suppressible warning,
  not a hard failure.
- **A decorator (ADR-0006).** Rejected for the reason ADR-0010 deferred it: a
  decorator cannot see the bound source or the merged props, both internal to
  `build()`, and pays the stacking cost for no benefit here.

[cdk-guidelines]: https://github.com/aws/aws-cdk/blob/main/docs/DESIGN_GUIDELINES.md
