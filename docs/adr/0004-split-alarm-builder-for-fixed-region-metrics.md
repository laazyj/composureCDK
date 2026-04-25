# ADR 0004: Split-alarm builder pattern for AWS services with fixed-region metrics

- **Status:** Accepted
- **Date:** 2026-04-25

## Context

A small set of AWS services emit CloudWatch metrics in a single fixed region
regardless of where the underlying resource is created. Today this affects:

- **CloudFront distributions** — `AWS/CloudFront` is `us-east-1` only.
- **Route 53 health checks** — `AWS/Route53` is `us-east-1` only.

CloudWatch alarms are regional. An alarm in any non-`us-east-1` stack against
these namespaces will never receive data. With
`treatMissingData: BREACHING` (the AWS-recommended value for Route 53 health
checks) the alarm sits in `ALARM` permanently — every deploy pages on-call.
With `NOT_BREACHING` it sits in `INSUFFICIENT_DATA` permanently — the safety
net silently never fires.

Either failure mode breaks the project's secure-by-default stance: a builder
that creates a recommended alarm "by default" must actually be capable of
firing. PR [#58](https://github.com/laazyj/composureCDK/pull/58) introduced
`createCloudFrontAlarmBuilder` to address this for CloudFront; issue
[#45](https://github.com/laazyj/composureCDK/issues/45) hits the same problem
for Route 53 health checks. Without a deliberate pattern, every future
fixed-region-metric service would need to rediscover the same shape.

## Decision

For services whose metric region is independent of the resource's region,
ship **two builders** plus a single shared alarm-assembly helper:

1. A combined builder (e.g. `createHealthCheckBuilder`,
   `createDistributionBuilder`) that materialises the resource and its
   recommended alarms in the same scope. Suitable when the stack is already
   in the metric's region (the simple "all-in-`us-east-1`" layout).
2. A standalone alarm builder (e.g. `createHealthCheckAlarmBuilder`,
   `createCloudFrontAlarmBuilder`) that accepts a `Resolvable<*BuilderResult>`
   for the resource and creates alarms in its own scope. Pair with
   `compose().withStacks()` to route the alarm builder into a `us-east-1`
   stack while the resource lives elsewhere — typical for production
   accounts with a dedicated `us-east-1` monitoring stack.
3. A shared internal helper `build*Alarms(scope, id, target, options)`. Both
   builders delegate to it — it is the **only** place alarm assembly lives.
   This keeps the recommended-alarm config shape, defaults, and `addAlarm()`
   extension surface in lock-step between the two paths.

Both builders emit a synth-time annotation
(`addWarningV2("@composurecdk/<package>:alarm-region", …)`) when alarms
would be materialised outside the metric's region, with
`Token.isUnresolved` suppression for env-agnostic stacks. The warning ID is
stable per package so users can suppress it deliberately if needed.

```ts
// packages/<service>/src/<service>-alarm-builder.ts

/** @internal */
export function build<Service>Alarms(
  scope: IConstruct,
  id: string,
  target: Pick<<Service>BuilderResult, "<resource>">,
  options: { recommendedAlarms?: <Service>AlarmConfig | false; customAlarms?: AlarmDefinitionBuilder<I<Resource>>[] } = {},
): Record<string, Alarm> {
  const recommendedDefs = ...resolve<Service>AlarmDefinitions(target.<resource>, options.recommendedAlarms);
  const customAlarmDefs = options.customAlarms?.map((b) => b.resolve(target.<resource>)) ?? [];
  const allAlarmDefs = [...recommendedDefs, ...customAlarmDefs];
  if (allAlarmDefs.length > 0) warnIfNotIn<Region>(scope);
  return createAlarms(scope, id, allAlarmDefs);
}
```

### When this pattern applies

Use it whenever the metric's region is fixed and not derivable from the
resource's region. Today: CloudFront, Route 53. Likely future candidates:
`AWS/Billing`, `AWS/Usage`, `AWS/CertificateManagerPrivateCA` (some
metrics).

For services where metric region == resource region (ACM, API Gateway, S3,
Lambda, …) the simple combined-builder pattern remains correct — there is
no cross-region split to express, and no new ADR/builder is needed.

### Why this over the alternatives

**Option considered: combined builder only, document the pitfall.** Rejected
because the failure mode (silently broken alarms) is precisely the kind of
hidden footgun the project's secure-by-default stance exists to prevent. A
README warning is read by users who already suspect a problem; the
synth-time annotation reaches users who don't.

**Option considered: a single builder that accepts an alternate alarm scope.**
Rejected because it conflates two concerns into one fluent surface
(`createHealthCheckBuilder().alarmScope(otherStack)`) and works around —
rather than uses — the existing `Resolvable` / `compose().withStacks()`
machinery. The split-builder shape composes naturally with
`Ref<*BuilderResult>` and matches how every other multi-stack scenario in
the project is expressed.

**Option considered: extract a generic `createCrossRegionAlarmBuilder<T>`
abstraction.** Rejected for now — two instances (CloudFront, Route 53) is
not enough to factor a generic well, and the per-service alarm-definition
logic is the load-bearing part anyway. Revisit if a third or fourth service
joins the list.

## Consequences

- Affected packages publish two factories instead of one. Package READMEs
  must teach both, and the cross-region `compose().withStacks()` worked
  example (set `crossRegionReferences: true` on both stacks).
- The shared helper guarantees the two builders cannot drift on
  recommended-alarm shape, defaults, or `treatMissingData` semantics — any
  change lands in one place. Tests verify both paths produce the same alarm
  surface against the same input.
- The synth warning is non-fatal. Users who genuinely want a no-data alarm
  (e.g. for a placeholder during initial development) can ignore it; users
  who hit it accidentally see the message in `cdk synth` output before they
  wonder why nothing pages.
- `addAlarm()` for custom alarms attaches to whichever builder the user
  invokes it on. Users wanting custom alarms in the `us-east-1` stack call
  it on the standalone builder; users staying in `us-east-1` everywhere
  call it on the combined builder. Symmetric and intuitive.
- The pattern does **not** apply retroactively to ACM or other services
  whose metrics live in the resource's region — those keep their single
  combined-builder shape unchanged.
- A new fixed-region-metric service entering the project should follow this
  pattern by mirroring `cloudfront-alarm-builder.ts` /
  `health-check-alarm-builder.ts`. If a third or fourth service lands, that
  is the trigger to revisit option (3) above and consider extracting a
  generic abstraction.
