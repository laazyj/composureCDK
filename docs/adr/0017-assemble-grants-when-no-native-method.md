# ADR 0017: Assemble a grant from an action + the construct's own ARN when a resource has no native `grant*` method

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

[ADR-0013](0013-consumer-side-grants.md) established consumer-side grants and a
guiding principle — _defer to the construct's own authority_: a capability helper
"invokes the resource construct's native `grant*` method rather than assembling
IAM actions itself, so the library holds no policy of its own to keep correct."
Every helper shipped under that ADR honours it: `tableGrants` calls
`grantReadData`, `queueGrants` calls `grantConsumeMessages`, `functionGrants`
calls `grantInvoke`, and so on.

An API Gateway REST API breaks the assumption. Callers need
`execute-api:Invoke`, but aws-cdk-lib exposes no `grantInvoke` on `IRestApi` —
the only native grant is `Method.grantExecute`, on the individual `Method`
construct, which the REST API builders do not surface as a result. So a
`restApiGrants.invoke(ref("api", (r) => r.api))` helper — the natural parallel
to `functionGrants.invoke` — has no native method to delegate to. Either the
capability cannot exist, or it must assemble the statement itself.

## Decision

When (and only when) a resource construct exposes **no** native `grant*` method
for the capability, a capability helper may assemble the grant directly, subject
to two bounds that keep the library-owned policy trivial:

1. **A single, well-known action.** The helper names one canonical action
   (`execute-api:Invoke`), not a hand-curated action set. If a capability would
   need to enumerate several actions to be correct, it does not qualify — that is
   exactly the policy-maintenance burden ADR-0013 avoids.
2. **The construct's own ARN builder for the resource.** The resource ARN comes
   from the construct's method (`IRestApi.arnForExecuteApi(method, path, stage)`),
   never a string the helper formats itself. Scoping options map straight onto
   that method's parameters.

`restApiGrants.invoke` is the first such helper:

```ts
invoke: (api, scope = {}) =>
  grantVia(api, (restApi, grantee) => {
    Grant.addToPrincipal({
      grantee,
      actions: ["execute-api:Invoke"],
      resourceArns: [restApi.arnForExecuteApi(scope.method, scope.path, scope.stage)],
    });
  });
```

Everything else from ADR-0013 is unchanged: the helper still returns a
`Grant<IGrantable>` via `grantVia`, still lives in the resource package, and is
still declared on the consumer's `grant(...)`.

## Consequences

- Resources without a usable native grant method can still expose consumer-side
  capabilities, so the granting idiom stays uniform across the library rather than
  reverting to inline, per-call-site IAM at the consumer.
- The exception is deliberately narrow. A helper that needed a multi-action set,
  or that formatted an ARN by hand, would reintroduce the library-owned-policy
  problem ADR-0013 rejects — reach for the native method, or file for one
  upstream, before assembling.
- ADR-0013's default still holds: prefer a native `grant*` method whenever one
  exists. This ADR adds the fallback, it does not replace the rule.
