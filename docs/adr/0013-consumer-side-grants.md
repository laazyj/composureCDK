# ADR 0013: Consumer-side IAM grants — declare a grant where the dependency already points

- **Status:** Proposed
- **Date:** 2026-07-04

## Context

Granting IAM permissions is a cross-cutting concern. Many resource types expose
`grant*` methods — a DynamoDB table's `grantReadWriteData`, a bucket's
`grantWrite`, a queue's `grantConsumeMessages`, a topic's `grantPublish`, a log
group's `grantWrite` — and any compute or identity that uses one of those
resources needs such a grant. "How does one component ask for access to another"
is therefore not a property of any single builder; it spans every resource
package and every grantee. Left unaddressed, each new resource or wiring answers
it differently and the library accretes a divergent granting idiom per package.
A single pattern is warranted.

aws-cdk-lib answers it by putting `grant*` on the **resource**, while the policy
it generates attaches to the **grantee**: the call mutates the grantee's identity
policy and only reads the resource's ARN. The real dependency is
one-directional — grantee → resource.

Adopting that shape inside `compose()` inverts the dependency graph. A grant
applied during a resource's `build()` needs the grantee in that resource's
context, forcing the resource to depend on its own consumer:

```ts
// grant on the resource → resource.build() needs the grantee → the edge points backwards
table.grantReadWriteData(ref("role", (r) => r.role));
compose({ table, role }, { table: ["role"], role: [] });
//                          ^^^^^^^^^^^^^^ the role uses the table, yet the table "depends on" the role
```

The consumer already depends on the resource for its real work, so this reverse
edge is at best misleading and — whenever the grantee is the same component that
consumes the resource — an outright cycle. The `compose()` dependency map is
meant to be the system's true edge set (the guarantee
[ADR-0011](0011-cross-component-relationship-guards.md) also protects); a grant
that inverts an edge breaks it.

Two constraints bound any fix: `@composurecdk/core` has no `aws-cdk-lib`
dependency and should keep only `constructs`; and a grant spans a grantee package
and a resource package, so the solution must not make either depend on the other,
nor every resource package on `@composurecdk/iam`.

## Decision

Declare a grant on the **consumer** — the grantee builder — rather than the
resource. The grant is captured as data at configuration time and applied during
the grantee's own `build()`, so the grant edge runs in the same direction as the
data-flow dependency it secures.

Three principles shape the design. First, **direction follows dependency**: the
grantee already depends on the resource, so the grant belongs on the grantee's
side of that existing edge, never on a new reverse edge. Second, **defer to the
construct's own authority**: the grant invokes the resource construct's native
`grant*` method rather than assembling IAM actions itself, so the library holds
no policy of its own to keep correct. Third, **the shared contract couples
nothing**: it is generic over the grantee type and lives in `core`, so no
resource package depends on a grantee package (or on `@composurecdk/iam`), and
each resource's capability vocabulary is owned by that resource's package.

Concretely, the seam has three layers:

1. **`core`** defines a generic, `aws-cdk-lib`-free contract: `Grant<G>` (a
   deferred grant applied to a grantee of type `G`), `grantVia(resource, apply)`
   (builds a `Grant` that resolves a resource `Ref` and calls `apply`), and
   `GrantQueue<G>` (the grantee-side accumulator).
2. **Each resource package** exports one capability namespace built from
   `grantVia`, typed against the construct interface plus a type-only
   `IGrantable`: `tableGrants` (`read`/`write`/`readWrite`/`fullAccess`),
   `queueGrants` (`consume`/`send`/`purge`), `bucketGrants`
   (`read`/`write`/`readWrite`/`put`/`delete`), `topicGrants`
   (`publish`/`subscribe`). One `tableGrants` serves both DynamoDB builders
   because `Table` and `TableV2` share `ITable`.
3. **Grantee builders** expose `grant(...)`, backed by a `GrantQueue<IGrantable>`
   applied in `build()`.

A grantee is a construct an IAM statement can attach to — one that implements
aws-cdk-lib's `IGrantable`. `RoleBuilder`'s `Role` implements it directly;
`FunctionBuilder`'s `Function` implements it by exposing its execution role as
`grantPrincipal`, so granting to the function routes the policy onto that role
(whichever role it ends up with — its default least-privilege role, a
`.configureRole` extension, an external `.role(ref)`, or the CDK auto-role).
`IGrantable` is thus the test for a grantee builder. A resource is never
`IGrantable`, so the mutation always lands on the grantee's principal, never on
the resource.

```ts
compose(
  {
    bucket: createBucketBuilder(),
    handler: createFunctionBuilder()
      .runtime(Runtime.NODEJS_22_X)
      .handler("index.handler")
      .code(Code.fromAsset("handler"))
      .grant(bucketGrants.write(ref("bucket", (r) => r.bucket))),
  },
  { bucket: [], handler: ["bucket"] }, // handler → bucket; no reverse edge, no cycle
);
```

## Consequences

- The `compose()` dependency map stays truthful: a grant edge points from
  consumer to resource, matching the data flow, and never manufactures a reverse
  edge or the cycle it can cause.
- **To grant:** `<granteeBuilder>.grant(<resourceGrants>.<capability>(ref(...)))`.
  **To make a resource grantable:** add a `grants.ts` of `grantVia` helpers — no
  core change, no wiring. **To make a builder a grantee:** add a `GrantQueue`
  (`#grants`, `grant()`, `copyInto` in the `.copy()` hook, `applyTo` in `build()`).
- Capability names are owned by, and discoverable from, the resource package; the
  grantee side is uniform across every resource.
- No new cross-package dependencies: the contract is in `core`, which everything
  already depends on; only the consuming application imports both a resource
  package and a grantee, as it already does.
- **Out of scope.** API Gateway AWS-service integrations, whose `credentialsRole`
  has no owner in the current builder surface and so cannot yet be a grantee
  (tracked in laazyj/composureCDK#270); and Neptune's `allowAccessFrom`, which
  couples an IAM grant with a security-group rule and will migrate its IAM half to
  a consumer-side `clusterGrants.connect(...)` in a separate breaking change.

## Alternatives considered

- **Resource-side grants (aws-cdk-lib's shape), e.g. `table.grantReadWriteData(ref)`.**
  Rejected: it inverts the grant edge and is cycle-prone whenever the grantee also
  consumes the resource — the common case.
- **A thunk-based grantee method, e.g. `role.grant(ref("table", (t) => (g) => t.grantReadWriteData(g)))`.**
  Rejected: the capability is written inline at every call site with no
  discoverable catalogue, and each resource's action knowledge leaks into consumer
  code.
- **Put the shared contract in `@composurecdk/iam`.** Rejected: every grantable
  resource package would then depend on `@composurecdk/iam` (today only `lambda`
  does). A generic `Grant<G>` in `core` needs no such edges.
