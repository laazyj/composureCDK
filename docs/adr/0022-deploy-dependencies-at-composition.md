# ADR 0022: Deploy-time dependencies are declared at composition — the `dependsOn()` combinator

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

CloudFormation deploys B after A only when B depends on A: through a reference in B's template, or an explicit `DependsOn`. When nothing references A, the dependency has to be declared with `addDependencies`. Two domain operations already expose it: `dependsOn` on the `custom-resources` builder and `after` on lambda's `.invokeOnDeploy()`. Each has one resource the operation creates, and the dependency is part of the operation ([ADR-0016](0016-domain-action-custom-resource.md)).

laazyj/composureCDK#732 needs a dependency no operation owns. An ACM certificate validated by DNS in a delegated zone must wait for the cross-account NS delegation, and nothing in its template references the delegation. More generally, any resource whose _create_ waits on DNS resolution in a child zone needs this. The issue proposed `dependsOn(...)` on builders, one at a time or for all of them through the `taggedBuilder` decorator ([ADR-0006](0006-decorator-builder-pattern.md)). That request will come back for other builders, so this records why it is declined.

- **A decorator** sees only the build result, which has no designated primary resource. It would have to add the dependency to every construct in the result, which is wider than intended (a certificate's alarms would wait too) and reaches constructs the builder was passed, such as `CrossAccountZoneDelegationBuilderResult.delegationRole`. It would also miss untagged builders, the delegation builder among them, and mix dependencies into tagging.
- **A per-builder method** has a precise target, but every builder would need its own, for a need that belongs to the relationship between two components rather than to either one.

## Decision

**A deploy-time dependency between components is declared at composition, with a `Lifecycle` combinator, `dependsOn(inner, { target, sources })`, not with a builder method.**

- **The name follows the library's vocabulary.** Composition is described in terms of dependencies: `compose()`'s dependency record, `addDependencies`, `DependencySource`, custom-resources' `.dependsOn(...)`, and the `DependsOn` attribute CloudFormation emits. The options mirror `addDependencies(target, sources)`, which the combinator calls.
- `dependsOn` wraps any `Lifecycle`: a builder, a composed system, or a hand-written one. After `inner` builds, it calls `addDependencies(target(result), sources, context)`.
- **The consumer, not the combinator, chooses the construct that gets the dependency.** `target` is required, so nothing is guessed, but `dependsOn` cannot stop a selector from naming a construct the component was passed. For the same reason, the docs recommend a construct-level ref in `sources` over a whole-component ref.
- **It keeps an `at()` pin** ([ADR-0012](0012-explicit-build-id-decoupled-from-compose-key.md)), by re-wrapping with `at()`. A wrapper outside `core` cannot, so `at()` goes outermost ([architecture](../architecture.md#pinning-a-components-construct-id-with-at)).
- **Build order is still declared in the dependency record.** Refs in `sources` resolve against the build context, so the sibling belongs in the record, or resolves from a parent system's context ([ADR-0003](0003-nested-compose-context-propagation.md)). `compose()` does not turn every entry in the record into a deploy-time dependency, because most `ref()` wiring already produces a real reference, and blanket dependencies would add cycles and stack coupling.

## Consequences

- The workaround in #732 becomes one wrapper beside the component it orders, for every component, without changing a builder factory.
- `core` still depends on `constructs` and not on `aws-cdk-lib`.
- Consumers write a `target` selector even when the primary resource is obvious.
- A component that needs `dependsOn` names its sibling twice: in the dependency record and in `sources`.
- **A request for a `.dependsOn()` builder method is answered with the combinator**, unless the dependency is part of a domain operation that builder owns.
