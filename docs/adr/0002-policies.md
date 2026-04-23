# ADR 0002: Policies — cross-cutting helpers applied to a construct subtree

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

Some concerns span the entire construct tree rather than any single builder. Examples:

- Attaching CloudWatch alarm actions to every `Alarm`/`CompositeAlarm` in a stack or app.
- Overriding `removalPolicy` on every stateful resource (S3 `Bucket`, Logs `LogGroup`, APIGW `RestApi` internals) for dev/example stacks — currently handled by `cleanDeskPolicy` in `packages/examples/src/clean-desk-policy.ts`.
- Future: enforcing tags, encryption defaults, or naming conventions across services.

These concerns are not builder-local: they apply to whatever matching constructs happen to exist under a scope. Without a convention, each consumer re-discovers the same pitfalls:

- **Detection**: `constructor.name` is fragile under minification; `instanceof` fails across bundled CDK realms; jsii-generated guards (`CfnAlarm.isCfnAlarm(x)`) are robust but non-obvious. Getting this wrong is silent and hard to catch in tests.
- **Mechanism**: CDK offers `Aspects` (post-construction, visited during synth prepare) and `PropertyInjectors` (props-at-construction). Manual `scope.node.findAll()` works but misses late-added constructs. `afterBuild` hooks from `@composurecdk/core` couple the helper to `compose()`, making it unusable in plain CDK apps. Each option has different timing, lifecycle, and failure modes.
- **API shape**: without a pattern, helpers drift between "hook factory returning `AfterBuildHook`", "class with `apply(scope)`", "free function taking a scope", and variations.

The first two policy implementations to land — `cleanDeskPolicy` (example-local, `PropertyInjectors`-backed) and `alarmActionsPolicy` (this change, `Aspects`-backed in `@composurecdk/cloudwatch`) — share the same conceptual shape. Formalising that shape now keeps future policies consistent and serves as a documentation anchor.

## Decision

1. **A _Policy_ is a free function with the signature `(scope: IConstruct, config?) => void`.** It applies a cross-cutting rule to every matching construct in the subtree under `scope`. It returns `void`. It does not return a builder or a hook.

2. **Policies are backed by CDK `Aspects` or `PropertyInjectors`.** Not manual tree walks (which miss late-added constructs), not `afterBuild` hooks (which couple to `compose()`). Choose based on timing:
   - **`Aspects`** for post-construction mutation — e.g., `addAlarmAction` on an already-constructed `Alarm`. Aspects fire during synth prepare; the construct exists, its methods are available, and IAM wiring via `bind()` still runs.
   - **`PropertyInjectors`** for props-at-construction — e.g., `removalPolicy`, `autoDeleteObjects`. Injectors rewrite props as the construct is instantiated, which is required for props that cannot be mutated afterwards.

3. **Named with a `<noun>Policy` suffix** — `alarmActionsPolicy`, `cleanDeskPolicy`, future `taggingPolicy`. The suffix signals: scope-wide side effect, applied once at setup, distinct from builders/factories.

4. **No `compose()` dependency.** Policies must be usable in any CDK app — plain CDK, composed systems, or example stacks. Consumers who want to install a policy from inside an `afterBuild` hook can do so (`afterBuild((scope) => myPolicy(scope, config))`), but the policy itself does not import from `@composurecdk/core`.

5. **Placement is determined by scope of concern, not by a dedicated package:**
   - **Single-domain policies** — those that only operate on one package's concerns (e.g., `alarmActionsPolicy` only touches CloudWatch alarms) — **live in their domain package** under `src/policies/`. They co-locate with the detection logic and types they rely on, and require no new peer dependencies.
   - **Pan-domain policies** — those that span multiple services (e.g., `cleanDeskPolicy` touches S3, Logs, and APIGW) — currently live in `packages/examples/` as working references. They will be promoted to a dedicated `@composurecdk/policies` package when ≥2 such policies justify the peer-dependency surface of that package. For now the single pan-domain helper does not justify a new package.

## Consequences

- Policies become discoverable: search for `*Policy` exports in any domain package, or look under `packages/*/src/policies/`.
- Detection logic stays with the domain types that know about it. `alarmActionsPolicy` lives next to `createAlarms` and shares the package's understanding of L1/L2 alarm identification.
- The `cleanDeskPolicy` precedent in `examples/` is now explicitly a first-class Policy, not an example-local helper — even though it has not yet moved. Future pan-domain policies should be drafted there until the extraction threshold is met.
- A package that introduces a new Policy does not need a new peer dependency if the Policy is single-domain (it only uses types the package already knows).
- `docs/architecture.md` does not yet describe Policies as a first-class concept. That integration is deferred until the pattern has been battle-tested across more than two consumers. This ADR stands alone until then.
- Policies that need to mutate props unavailable after construction must choose `PropertyInjectors`; everything else should prefer `Aspects` because post-construction mutation preserves `IAlarmAction.bind()`-style lifecycles and idiomatic L2 method calls.

## Alternatives considered

- **A dedicated `@composurecdk/policies` package today.** Rejected for now: a single pan-domain policy (`cleanDeskPolicy`) does not justify publishing a package that would peer-depend on s3, logs, apigateway, cloudwatch, sns, and whatever else the next policy touches. Revisit when ≥2 pan-domain policies are ready to ship together.
- **`AfterBuildHook`-based API, consistent with `@composurecdk/cloudformation.outputs`.** Rejected: couples every policy to `compose()`, preventing use in plain CDK apps. Duplicates the traversal work CDK's `Aspects` already performs. `outputs()` is justifiably a hook because it needs the composed-system build results; policies do not.
- **Manual `scope.node.findAll()` + synchronous iteration inside the policy call.** Rejected: does not see late-added constructs, and duplicates the primitive CDK already ships. Also risks ordering surprises when a policy call precedes construct creation.
- **Exporting the underlying detection primitive (`visitAlarms` / `forEachAlarm`) as public API.** Rejected for v1: naming is contentious (`forEach*` misleads on Aspect timing) and the detection logic is an implementation detail of the single concrete policy. If consumers demand a public detector, it can be added under a better name after at least one other package would use the same pattern (so the name generalises).
