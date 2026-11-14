# ADR 0021: Deploy order is a composition concern — the `deployAfter()` combinator

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

CloudFormation orders B after A only when B's template references A. When nothing does, the edge has to be declared with `addDependencies`. Two domain operations already expose it: `dependsOn` on the `custom-resources` builder and `after` on lambda's `.invokeOnDeploy()`. Each has one resource the operation creates, and the ordering is part of the operation ([ADR-0016](0016-domain-action-custom-resource.md)).

laazyj/composureCDK#732 needs an edge no operation owns. An ACM certificate validated by DNS in a delegated zone must wait for the cross-account NS delegation, and nothing in its template references the delegation. More generally, any resource whose _create_ waits on DNS resolution in a child zone needs this. The issue proposed `dependsOn(...)` on builders, one at a time or for all of them through the `taggedBuilder` decorator ([ADR-0006](0006-decorator-builder-pattern.md)). That request will come back for other builders, so this records why it is declined.

- **A decorator** sees only the build result, which has no designated primary resource. It would have to add the edge to every construct in the result, which is wider than intended (a certificate's alarms would wait too) and reaches constructs the builder was passed, such as `CrossAccountZoneDelegationBuilderResult.delegationRole`. It would also miss untagged builders, the delegation builder among them, and mix ordering into tagging.
- **A per-builder method** has a precise target, but every builder would need its own, for a need that belongs to the relationship between two components rather than to either one.

## Decision

**Deploy order between components is declared at composition, with a `Lifecycle` combinator, `deployAfter(inner, { target, after })`, not with a builder method.**

- `deployAfter` wraps any `Lifecycle`: a builder, a composed system, or a hand-written one. After `inner` builds, it calls `addDependencies(target(result), after, context)`.
- **The consumer, not the combinator, chooses the construct that gets the edge.** `target` is required, so nothing is guessed, but `deployAfter` cannot stop a selector from naming a construct the component was passed. For the same reason, the docs recommend a construct-level ref in `after` over a whole-component ref.
- **It keeps an `at()` pin** ([ADR-0012](0012-explicit-build-id-decoupled-from-compose-key.md)), by re-wrapping with `at()`. The rule for any wrapper is written on `BUILD_ID` in `build-id.ts`.
- **Build order is still declared separately.** Refs in `after` resolve against the build context, so the sibling belongs in the dependency record, or resolves from a parent system's context ([ADR-0003](0003-nested-compose-context-propagation.md)). `compose()` does not turn build-order dependencies into deploy-order edges, because most `ref()` wiring already produces a real reference and blanket edges would add cycles and stack coupling.

## Consequences

- The workaround in #732 becomes one wrapper beside the component it orders, for every component, without changing a builder factory.
- `core` still depends on `constructs` and not on `aws-cdk-lib`.
- Consumers write a `target` selector even when the primary resource is obvious.
- **A request to add `dependsOn` to a builder is answered with `deployAfter`**, unless the ordering is part of a domain operation that builder owns.
