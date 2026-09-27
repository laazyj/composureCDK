# ADR 0017: Template-text validity as an opt-in Aspect, not builder enforcement

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

CloudFormation stores template text as ASCII. A non-ASCII character in a free-text field — an em-dash, a curly quote — is accepted at synth and **silently transliterated to `?`** when CloudFormation stores the template. Nothing fails. The deployed template simply stops matching the synthesised one, so `cdk diff` reports a change on every run afterwards, forever, on a stack nobody touched ([issue #336](https://github.com/laazyj/composureCDK/issues/336)).

This is the same root cause as the `GroupDescription` failure behind [ADR-0010](0010-aws-property-constraints.md), with a worse failure mode: EC2 rejected that value outright with `CREATE_FAILED`, so it was noticed. Here there is nothing to notice.

Two facts shaped the response.

**The catalogue could not have caught it.** ADR-0010 puts a `validate*` call in each builder's `build()`. That only covers fields someone remembered to wire one into. The field that actually bit a consumer was the stack-level `Description`, which `StackBuilder` passes straight through to `StackProps` and no validator ever sees. Six library-shipped alarm descriptions carried the same character, as did four example stacks CI deploys — all fixed separately in [#351](https://github.com/laazyj/composureCDK/pull/351). A mechanism that depends on remembering is the mechanism that let this through.

**Enforcing it now would break working stacks.** Consumers are deploying today with transliterated descriptions. The deployments succeed; only the diff is noisy. Turning that into a synth failure is a breaking change delivered as a bug fix.

## Decision

**Template-text validity is enforced by an opt-in Aspect keyed by CloudFormation resource type, not by builder-level validators.**

1. **`templateTextPolicy(scope, config?)` in `@composurecdk/cloudformation`**, under `src/policies/`. A Policy in the [ADR-0002](0002-policies.md) sense: a free function returning `void`, backed by `Aspects`, with no `compose()` dependency.

2. **Opt-in, with three modes.** `throw` (default) fails synth at the authoring call site; `sanitize` rewrites the value so the emitted template matches what CloudFormation will store; `warn` annotates every violation in one pass. `warn` exists because `throw` reports only the first violation — the adoption path on an existing estate is `warn`, fix the list, switch to `throw`.

3. **Builder-level enforcement is retained only where the violation is deploy-fatal.** An EC2 `GroupDescription` fails `CREATE_FAILED`, so `validateSecurityGroupDescription` stays in `build()` and is not optional. A field that is merely coerced is the Aspect's job. The dividing line is _broken stack_ versus _noisy diff_.

4. **The registry is keyed by resource-type string, so it imports no service package.** `TEMPLATE_TEXT_FIELDS` names `AWS::Lambda::Function` without importing `@composurecdk/lambda`. This is what ADR-0010's consequences called for — "a registry or CFN-spec-generated map, not import each package" — and it is why the policy can live centrally without inverting the dependency graph.

5. **It amends [ADR-0002](0002-policies.md) §5.** That decision routes pan-domain policies to `packages/examples/` until ≥ 2 justify a `@composurecdk/policies` package. The rationale there is peer-dependency surface: a policy spanning services would make that package peer-depend on all of them. A resource-type-string-keyed policy has no such surface, so the rule does not apply to it. Such policies live in `@composurecdk/cloudformation`, next to the constraint mechanism.

6. **One cross-cutting rule, not the whole catalogue at template level.** The Aspect enforces a single invariant — template text is ASCII — across many fields. Per-property character classes and length limits stay in their owning packages, applied at `build()`, exactly as ADR-0010 §2 decided. Registry entries are property _names_, not `StringConstraint`s.

7. **Three node kinds, because only one is a `CfnResource`.** A stack's `Description` lives on `templateOptions`; `CfnOutput` and `CfnParameter` are `CfnElement`s with their own accessor. A registry keyed by resource type alone would miss both — including the field that prompted this ADR.

## Consequences

- Adding a newly-discovered field is one line in `TEMPLATE_TEXT_FIELDS`. The const is module-internal, not exported, so the registry's shape stays changeable; consumers extend it via `config.fields` without waiting for a release.
- The catalogue gains a cross-cutting entry (`constraints.validate.templateText` / `constraints.sanitize.templateText`) alongside tags, which is the existing precedent for a constraint that is not per-resource.
- Coverage is honest but partial, and the README says so: values resolving to a CloudFormation intrinsic, values written via `addPropertyOverride`, nested property paths, and unregistered resource types are all outside it. A guard whose gaps are undocumented gets over-trusted.
- Because the policy is opt-in, the library's own shipped defaults are not protected by it. They are protected by being ASCII, verified by the synth-time test over the example stacks added in [#351](https://github.com/laazyj/composureCDK/pull/351).
- Nested paths (`DistributionConfig.Comment`, `HostedZoneConfig.Comment`) need a resolve on read and an `addPropertyOverride` on write. They are deferred rather than approximated.
- The seeded registry is 15 resource types against the several hundred that declare a free-text property. It is a starting point sized to what has been reasoned about, not a claim of completeness — see the name-predicate alternative below.
- `warn` mode degrades to the 2.0-era `Annotations.addWarning` when `addWarningV2` is absent. This package's floor is `aws-cdk-lib` 2.1.0, the lowest in the repo because every other package peer-depends on it, and `addWarningV2` only arrived in 2.93.0 (ADR-0008); raising the floor for one optional mode would drag the whole library up with it.
- A future policy that is genuinely pan-domain — one that must import service packages — still follows ADR-0002 §5 unchanged.

## Alternatives considered

- **Validate in every builder that emits a description.** Rejected: breaking for existing consumers, and structurally unable to cover the field that caused the bug (`StackProps.description` is a passthrough) or any construct the library did not build.
- **An ESLint rule banning non-ASCII string literals in `src/`.** Rejected: a syntactic proxy for a semantic property. A blanket rule fires on ~35 legitimate error-message strings that never reach a template; narrowing it to `description`-named properties misses helpers like `describeInFlight` that return one. It also cannot see consumer-supplied text at all. Two mechanisms for one invariant is enough.
- **`Annotations.addError` instead of throwing for `throw` mode.** Rejected: only the CDK CLI acts on error metadata, so `app.synth()` and `Template.fromStack()` would sail past it — a guard that does not fire in unit tests. Throwing fails everywhere and matches how the rest of the catalogue reports.
- **Sanitising by collapsing runs, as `sanitizeString` does.** Rejected for text: a run-collapse turns a quoted phrase into a single `-`, losing more than CloudFormation itself does. Replacement is per character, with `?` — CloudFormation's own substitution — as the fallback for anything unmapped.
- **Deriving the registry from a CloudFormation spec.** Rejected: no spec ships at runtime — `@aws-cdk/` provides only `cloud-assembly-schema` and asset packages — so deriving means vendoring a spec, a codegen script, and a staleness gate, for a list that changes slowly.
- **Detecting free-text fields by name predicate** (`/[Dd]escription$/`, `displayName`, `comment`) against each L1's accessor names, instead of an allowlist. Rejected for v1, but it is the strongest alternative and the likeliest successor: `aws-cdk-lib` declares such a property on roughly 550 `Cfn*Props` interfaces against the 15 seeded here, and it would need no codegen. It is deferred because a predicate decides _for_ the consumer which properties are prose — the failure mode of a false positive is a synth error on a legal value, which is worse than the silent gap it replaces — and because the seed list is the honest scope of what has been reasoned about. `config.fields` is the escape hatch until then, and `TEMPLATE_TEXT_FIELDS` is deliberately not exported so the registry's shape can change without a breaking release.
- **Making the policy on by default.** Rejected: it is a breaking change to working deployments, and the failure it prevents is a noisy diff, not an outage. The consumer decides.
