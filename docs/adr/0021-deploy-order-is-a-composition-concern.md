# ADR 0021: Deploy order is a composition concern — the `deployAfter()` combinator

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

`compose()`'s dependency record orders _builds_. CloudFormation orders _deploys_, and it puts B after A only when B's template references A. Usually a `ref()` produces that reference. Sometimes nothing does, and the edge has to be declared. `addDependencies(target, sources, context)` in `@composurecdk/core` declares it. Two builders expose it: `dependsOn` on the `custom-resources` builder and `after` on lambda's `.invokeOnDeploy()`.

Other builders don't, which laazyj/composureCDK#732 runs into. An ACM certificate validated in a delegated zone has to wait for a cross-account NS delegation. Nothing in the certificate's properties refers to the delegation, so CloudFormation creates both at once. The workaround is an inline `Lifecycle` that calls the builder's `build()`, then calls `addDependencies`.

The issue proposed `dependsOn(...)` on builders, either one at a time or for all of them through the `taggedBuilder` decorator ([ADR-0006](0006-decorator-builder-pattern.md)). Both were considered:

- **One builder at a time.** The need is cross-cutting. Anything that resolves names in a delegated zone waits on the same delegation: SES identities, API Gateway and CloudFront custom domains. ADR-0006 already rejected per-builder methods for cross-cutting features because each copy drifts.
- **All builders through a decorator.** A decorator sees only the build result, and a result has no designated primary resource. So the decorator would have to add the edge to every construct in the result, the way the tag walker does. That is wider than intended: a certificate's alarms would wait too. It is also unsafe, because results include constructs the builder did not create. For example, `CrossAccountZoneDelegationBuilderResult.delegationRole` is the role the builder was passed, so the edge would land on another component's construct, or on an imported one, and could form a cycle. The decorator would also miss the untagged builders, the delegation builder among them, mix ordering into tagging, and pay ADR-0006's stacking cost.

`custom-resources`' `dependsOn` and `.invokeOnDeploy({ after })` don't have these problems. Each has one resource the operation creates, and the ordering belongs to the operation ([ADR-0016](0016-domain-action-custom-resource.md)).

## Decision

**Deploy order between components is declared at composition, with a `Lifecycle` combinator: `deployAfter(sources, inner, target)`. It is not a builder method.**

- `deployAfter` wraps any `Lifecycle`: a builder, a composed system, or a hand-written one. After `inner` builds, it calls `addDependencies(target(result), sources, context)`. `sources` accepts every `DependencySource` shape.
- **`target` is required.** The consumer names the construct that gets the edge. The combinator does not guess a primary resource, and it never adds an edge to a construct the component was given.
- **It keeps an `at()` pin.** When `inner` carries the `BUILD_ID` brand ([ADR-0012](0012-explicit-build-id-decoupled-from-compose-key.md)), `deployAfter` copies it. So `deployAfter` and `at()` can wrap each other in either order. No other brand is copied: `scoped()` needs the system itself, and if `deployAfter` forwarded the system's build, `scoped()` would skip the edge.
- **The build-order dependency is still declared.** A ref in `sources` resolves against the context `compose()` passes in, so the sibling must appear in the dependency record. If it doesn't, the ref's own "component not found in context" error reports it at build time. `compose()` does not turn build-order dependencies into deploy-order edges by itself. Most `ref()` wiring already produces a real reference, and adding a blanket edge for every dependency would make cycles and stack coupling more likely.

Builders do not gain `dependsOn`. A builder should expose ordering only when it is part of a domain operation whose target the builder owns, as with the two existing seams.

## Consequences

- The workaround in #732 becomes one wrapper beside the component it orders, and it works with every component, untagged builders included, without changing a builder factory.
- `deployAfter` lives in `core`, which already depends on `constructs` and not on `aws-cdk-lib`. The library's dependency direction is unchanged.
- Consumers write a `target` selector even when there is an obvious primary resource. That is the cost of never adding an edge to a construct that belongs to another component.
- A request to add `dependsOn` to a builder should be answered with `deployAfter`, unless the ordering is part of a domain operation that builder owns.
