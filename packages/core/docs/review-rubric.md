# ComposureCDK review rubric

How to review a change to an app or builder library built with ComposureCDK. Each check stands alone and names the rule it enforces, so you don't need to read the [agent rules](agent-rules.md) to review; the [catalogue of principles](https://github.com/laazyj/composureCDK/blob/main/docs/guide/principles.md) gives each rule's reasons. An ID in parentheses is a related rule to cite with the finding.

## How to review

1. **Read the diff, then each `compose()` declaration it touches, in full.** A missing dependency edge shows only against the whole map.
2. **Work through the checks below.**
3. **Report only what you can point at:** a file and line, the rule, and a fix, in the format under [Reporting](#reporting). When two checks match the same code, report the more specific one.
4. **Don't report:**
   - what the type system, or the `@composurecdk/eslint-plugin` presets the project extends, already catch: a component missing from the dependency map, or `instanceof` across packages where the preset is on;
   - matters of taste the rules leave open, such as `.addAlarm()` against `.addAlarms()`;
   - a team's own process: comment style, change descriptions, how a workaround is tracked.
5. **When the fix belongs in ComposureCDK, say so,** and suggest a [feature request](https://github.com/laazyj/composureCDK/issues/new?template=feature_request.md) instead of a workaround.

## Severity

Severity is about impact:

- **Blocking:** replaces or deletes a deployed resource, widens access, hides a dependency, or breaks synthesis, deployment or run time.
- **Should fix:** makes the system harder to read, change or upgrade.
- **Consider:** low cost if left, such as test hygiene.

In an audit of existing code rather than a diff, read "widens access" as "is wider than the code needs", and use "consider" for a rule with no check below unless the finding meets one of these definitions.

Many rules are still `provisional` in the catalogue: one app has confirmed them so far. Whatever the severity, give the rule's reason with the finding, and accept a reason specific to the system in reply.

## Checks

### Construct paths and access

- **PATH-1** (blocking) A deployed component's construct path changes:
  - its key is renamed;
  - it moves into or out of a nested `compose()`, or between builders;
  - a system is newly wrapped in `scoped()` (INLINE-7).

  Fix: keep its IDs with `at(id, component)` (PATH-3), or show with a synthesized template diff (PATH-2) what CloudFormation will replace.

- **VOCAB-3** (blocking) A grant is wider than what the code does, such as `readWrite` where the handler only reads, an account or region wildcard in an ARN the code reaches in one account, a deploy role a pull request's code can assume, or a whole-key grant where the resource's grant carries the key (VOCAB-2).
- **DEFAULT-5** (blocking) A later `.environment()` call replaces an earlier one, in a factory or in the chain, and drops variables the function needs.
- **LAYER-5** (blocking) A context flag holds something whose omission on a redeploy would remove resources, such as an allowlist.
- **LAYER-4** (should fix) An account ID is written into the app as a default or constant, or the expected account is read from `CDK_DEFAULT_ACCOUNT` itself, so the check against the credentials can't fail.
- **PATH-3** (should fix) A resource whose replacement would fail (an alias in use, a fixed physical name) or whose deletion would be costly (a hosted zone) has no logical-ID pin or no retention.

### The declaration

- **DECL-3** (blocking) A dependency is hidden from the map:
  - `resolve(` inside a component's `build()`, or an inline `{ build }` that reads `context`;
  - a `ref("key", …)` or a grant naming a sibling that isn't in that component's dependency entry.

  Fix: take the value as a builder prop set with a `ref`, and add the edge.

- **DECL-10** (blocking) A construct is created outside `compose()`, in a different stack or scope from the component it is passed into (or a value read from it is). Lookups and stacks are allowed. Fix: wrap the construct in a builder and make it a component, pinned with `at()` if it is already deployed. If the consuming prop takes no `ref`, report the library gap instead.
- **DECL-10** (should fix) The same, but the construct shares its only consumer's stack.
- **DECL-11** (blocking) Siblings change a shared parent through an `add*`-style call and the order matters, but neither lists the other in the dependency map.
- **DECL-4** (should fix) A subsystem's module imports another subsystem's module, or uses another subsystem's key in a `ref`. Fix: take a typed `Ref<T>` parameter, and wire it in `app.ts`.
- **DECL-8** (should fix) A component is built in a variable and post-processed, or wrapped in a helper (`withX(builder, …)`) that adds grants, alarms or configuration out of sight (INLINE-1).
- **INLINE-2** (should fix) A shared factory takes an options object, or sets something that differs between its uses: a timeout, an environment, grants, alarms or refs.
- **DECL-5** (should fix) A pass-through component exists only to make two variants share a shape, such as `{ build: () => ({ zone: resolve(…) }) }`.
- **DECL-6** (should fix) A side effect, such as a deployment, is made in `.afterBuild()` or inside another component's builder rather than as a component of its own.
- **DECL-2** (should fix) The system is split by size or by stack rather than along its high-level design.
- **DECL-7** (should fix) An output in a multi-stack app is scoped to a component other than the one that produces it.

### Layers and stacks

- **LAYER-2** (should fix) `tryGetContext` or `process.env` is read below the app layer: in a subsystem, a component or a builder.
- **LAYER-3** (should fix) A context value is used without being checked against a closed set.
- **LAYER-8** (should fix) A stack holds a resource of its own, created with `new X(stack, …)` and never passed into the system. If it is passed in, report DECL-10 instead.
- **LAYER-8** (should fix) A stack is added per business area rather than per deployment unit (region, lifetime, blast radius, a reference cycle).
- **LAYER-9** (should fix) A placement (`groupedStacks` or `withStacks`) places a subsystem's inner component rather than the subsystem, other than a region-bound component placed by its own subsystem.
- **LAYER-9** (blocking) A stack built from a builder gets a new id, because its group, its `withStacks` key or the system id passed to `build()` is renamed, and the builder has no `at()` or `.stackName()` pin: the deployed stack is replaced.
- **LAYER-13** (blocking) A name that links accounts or regions is written out on both sides rather than built by one helper both import.
- **LAYER-13** (consider) A strong cross-region `ref` points at a resource the change could replace, which will take two deploys.
- **ALARM-6** (should fix) A stack with alarms has no alarm routing, or routing is installed per region with no test that every alarm has actions.

### The library's vocabulary and defaults

- **VOCAB-1** (should fix) A raw `PolicyStatement`, `addToPrincipalPolicy` or L2 `grant*()` call where the library has a typed `*Grants`, or `grantVia` would do.
- **VOCAB-4** (should fix) `node.addDependency(resolve(…))`, or an inline `Lifecycle` written only to order a deploy. Fix: `dependsOn(component, { target, sources })`.
- **VOCAB-5** (should fix) An L1 construct where a ComposureCDK builder exists.
- **DEFAULT-1** (should fix) A config object passed to a builder restates or drops its default, for example a list replaced rather than extended by spreading the exported default.
- **DEFAULT-3** (blocking) A secure default is switched off anywhere but explicitly, at the call site. Recommended alarms are ALARM-1's.
- **DEFAULT-6** (should fix) Security-critical configuration, such as a redaction list, is built with `.map()` or a spread rather than written out.
- **ALARM-1** (should fix) A recommended alarm is switched off (`recommendedAlarms(false)`, or a key set to `false`) with no reason specific to the system.

### Tests

- **TEST-3** (should fix) A test finds a resource by a literal logical ID or by position, or doesn't assert that exactly one matched. A test that pins a deployed resource's logical ID is the exception.
- **TEST-4** (should fix) IAM statements, trust conditions, alarm names, policies, retention or ID pins are checked with `arrayContaining`, `objectLike`, a text search or only a snapshot, where `toEqual` would pin them.
- **TEST-8** (should fix) A loop over found resources has no check that it found any, or selects them by the property it then asserts.
- **TEST-5** (should fix) A stack is missing from the per-stack annotations check.
- **TEST-1** (consider) A test builds `new App()` itself rather than through the shared `testApp()`.

### Builder libraries

Only for a change to a library of builders that others use.

- **LIB-1** (blocking) A builder's `*BuilderProps`, or another type its declarations name, isn't exported from the package.
- **LIB-2** (blocking) A physical name or other durable name is derived from the build id or the compose key.
- **LIB-3** (should fix) "At least one" is typed as a plain array, with no run-time check.
- **LIB-5** (should fix) A test asserts on the wrapped library's internal API rather than the synthesized template.

## Reporting

One finding per problem, most severe first:

```md
**DECL-3** · blocking · `src/data-plane.ts:42`
The queue resolves `ref("dlq")` inside `build()`, so its dependency on the DLQ is missing from the map.
Fix: `.deadLetterQueue(ref("dlq", (r: QueueBuilderResult) => ({ queue: r.queue, maxReceiveCount: 5 })))`, and `queue: ["dlq"]`.
```

End with a count of findings by severity, or "No findings" when the change is clean. A reviewer who disagrees with a rule itself, rather than its application, can say so with the [Guide feedback template](https://github.com/laazyj/composureCDK/issues/new?template=guide_feedback.md).
