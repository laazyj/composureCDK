# ComposureCDK rules for coding agents

These are the rules for writing, changing or reviewing an app or builder library built with ComposureCDK, condensed for coding agents. ComposureCDK is newer than most training data, so follow these rules rather than habits carried over from plain CDK.

Each rule has an ID from the [catalogue of principles](https://github.com/laazyj/composureCDK/blob/main/docs/guide/principles.md), which gives its reasons and sources. [Architecting a ComposureCDK app](https://github.com/laazyj/composureCDK/blob/main/docs/guide/architecting-an-app.md) works through them with a running example. Cite rule IDs in review comments and change descriptions, so a person can look each one up. To review a change against these rules, use the [review rubric](review-rubric.md). To audit, upgrade or refactor an existing app, follow [the audit guide](audit.md) first.

## Rules

### Layers

- **LAYER-1** Keep configuration, app, stack and system as separate layers (`config.ts`, `app.ts`, `stacks.ts`, a file per subsystem; a small app can share `app.ts`). A layer uses only what the layers before it provide.
- **LAYER-2** Read every external input (context, `process.env`, files) once, in the configuration module, into typed settings. Nothing below the app reads them. Take `env` as a parameter so tests can drive it.
- **LAYER-3** Validate settings against a closed set and throw on anything else. Check combinations at synth. Give each switch one resolver that holds its default.
- **LAYER-4** Never hard-code an account. Take the expected account from committed config or context, and fail synthesis when it is missing or differs from `CDK_DEFAULT_ACCOUNT`.
- **LAYER-5** Keep configuration whose omission would destroy resources in committed code, not in a context flag.
- **LAYER-6** Install app-wide policy once, on the `App`, with the library's policies (`templateTextPolicy`, `alarmActionsPolicy`, …) before writing your own. Don't configure per builder what a policy already enforces. Alarm routing whose topic is a component or differs by region follows ALARM-6.
- **LAYER-7** An Aspect reaches only constructs in the tree. Create in the app anything a service would otherwise create at run time.
- **LAYER-8** A stack carries an environment (account, region, tags, retention, deploy order), never resources or wiring of its own. Split stacks by deployment unit (region, lifetime, blast radius, a reference cycle), not by business area.
- **LAYER-9** One stack: `singleStack(createStackBuilder()…)`. A stack per top-level subsystem: `.withStacks(map)`. Stacks per Region or per deployment unit: `groupedStacks(groups, placement)`. Place top-level subsystems, never their inner components, except that a subsystem spanning regions places its own region-bound components. Pin a deployed builder's stack with `at()` or `.stackName()` before renaming it.
- **LAYER-10** Put a region-bound resource in a stack in that region. Don't switch it off instead; switching it off for cost is DEFAULT-3.
- **LAYER-11** Order stacks that are linked by name with `addStackDependency(…, reason)` in the stack layer.
- **LAYER-12** Choose between variants of the system with an expression in `app.ts`'s `compose()` call, from settings passed in as parameters.
- **LAYER-13** Within one account, connect stacks with `ref`, in the same region or another; choose the reference strength (a strong cross-region reference makes replacing the producer take two deploys). Across accounts: a deterministic name built by one helper both sides import.

### The declaration

- **DECL-1** The `compose()` declaration is the architecture diagram. Keep each component's builder chain, key configuration, grants and refs in it.
- **DECL-2** Start with one flat `compose()`. Split into subsystems along the high-level design, not by size, and before the first production deploy.
- **DECL-3** Put every dependency in the dependency map, and pass every input as a `ref` in the declaration. Never resolve a `ref` the declaration didn't pass in.
- **DECL-4** Give each subsystem typed `Ref<T>` parameters for what it needs, and wire them in `app.ts`. Subsystems never import each other or use each other's keys.
- **DECL-5** When a variant has different resources, write a separate component and choose it in the map. No pass-through components.
- **DECL-6** Make each side effect that creates resources a named component in the map. Keep `.afterBuild()` for outputs, logical-ID pins and installing policy.
- **DECL-7** Scope each output to the component that produces it.
- **DECL-8** Write each component as one fluent expression in the map. Don't hoist it into a variable or wrap it in a helper.
- **DECL-9** When components come from a record or a condition, derive their dependency entries from the same source.
- **DECL-10** Never create a construct outside `compose()` and pass it in. Wrap one with no ComposureCDK builder in a builder of your own. Lookups (`fromBucketName`, `fromLookup`) and stacks are the exceptions: make them in the stack or app layer and pass them in as typed inputs. If the consuming prop takes no `ref`, report the gap.
- **DECL-11** When siblings change a shared parent and the order matters, list each one's predecessor in the dependency map. Siblings with no edge between them have no defined order.
- **DECL-12** Don't adopt a feature that hides a dependency or would make a cycle in the compose graph.

### Abstraction

- **INLINE-1** Write it inline first. Extract only what is reused.
- **INLINE-2** A shared factory sets only what every use shares, takes at most an identifying argument, and returns the builder interface. No options bags.
- **INLINE-3** A builder does one job and returns what it makes. Whatever consumes that is another component, wired with `ref`.
- **INLINE-4** Put logic beyond a builder chain in a named builder in its own `*-builder.ts`, in the library's shape, and create it inline.
- **INLINE-5** Helper modules hold pieces (a state-machine definition, constants), take resolved resources, and never build whole components.
- **INLINE-6** Don't export internal helpers. Delete unused ones on every refactor.
- **INLINE-7** Don't use `scoped()` in an app.
- **INLINE-8** Keep a workaround small, inside the declaration, with the same components and edges the real thing would have.

### The library's vocabulary

- **VOCAB-1** Grant with the library's typed `*Grants` on the grantee's builder, then `grantVia`, and a raw `PolicyStatement` only when neither fits.
- **VOCAB-2** Grant the resource, not its key: the library's grants carry the key. Make every grant work on its own.
- **VOCAB-3** Grant the narrowest action on the narrowest resources the code needs: no account or region wildcards in ARNs it reaches in one account, and read and lookup only for a role unreviewed code can assume.
- **VOCAB-4** Use `ref`, `Ref<T>.map()` and `combine()`. Order deploys with `dependsOn(component, { target, sources })`, not an inline `Lifecycle` that resolves refs.
- **VOCAB-5** Look for a library builder before writing L1 constructs or IAM by hand.
- **VOCAB-6** Inside a custom builder, build child resources with the library's builders.
- **VOCAB-7** Check what a library builder, or CDK itself (custom-resource Lambdas for strong cross-region references and OIDC providers), synthesizes against the app's policies.

### Defaults

- **DEFAULT-1** Top-level props replace a builder's default, so pass only the difference. Extend a default list by spreading the exported default; to change one entry, keep the others by `id` and replace that one.
- **DEFAULT-2** Work out how your settings combine with the defaults before relying on them.
- **DEFAULT-3** Opt out of a secure default explicitly, at the call site.
- **DEFAULT-4** State in code, not only in a comment, the defaults that rollback or security depend on, and assert them in a test.
- **DEFAULT-5** The Lambda builder's `.environment()` replaces the whole environment. Spread shared variables into every call.
- **DEFAULT-6** Write security-critical configuration, such as redaction lists, literally.

### Construct paths and logical IDs

- **PATH-1** Construct paths follow the compose tree. Nesting a `compose()` or moving a component replaces its resources.
- **PATH-2** Prove a refactor is pure by diffing the synthesized templates resource by resource.
- **PATH-3** To move a deployed component without replacing it, pin its ID with `at(id, component)`. Otherwise plan the replacement. Pin and retain, before any change, a resource whose replacement would fail (an alias in use, a fixed physical name) or whose loss is costly (a hosted zone).

### Tests

- **TEST-1** Build every test through one `testApp()` that pins every input, with context from the same `cdk.json` the CLI uses.
- **TEST-2** Synthesize the real app once per context. Test each subsystem in a bare `Stack`.
- **TEST-3** Find a resource by its identity, and assert there is exactly one. Never by position or a literal logical ID, except in a test that pins a deployed resource's logical ID.
- **TEST-4** Pin exactly, with `toEqual`: alarm names, IAM statements, trust conditions, policies, retention, ID pins. A snapshot shows change, not safety, and doesn't count.
- **TEST-5** Check every stack for warnings and errors, with `it.each` so a failure names the stack.
- **TEST-6** Test both variants of an optional feature, and the failure path.
- **TEST-7** Assert what clients depend on, not the library's internal naming.
- **TEST-8** Never pass vacuously: check a population is non-empty, and don't select it by the property under test.
- **TEST-9** Check invariants across the whole template.
- **TEST-10** Rebuild a derived name from the synthesized resource's properties.
- **TEST-11** Parse a state-machine definition rather than searching its text.
- **TEST-12** Check that a narrowed grant's test fails when the grant is reverted.

### Deploying

- **DEPLOY-1** Template tests aren't enough. Deploy early to a disposable account; in a small single-account app, a reviewed `cdk diff`, rollback and a smoke test can stand in for one.
- **DEPLOY-2** Turn every failure found on deploy into a synth-time guard or a template-wide test.
- **DEPLOY-3** Make a disposable stack disposable, and keep account-wide resources out of it.

### Alarms

- **ALARM-1** Keep every recommended alarm. Turn one off only for a reason specific to the system.
- **ALARM-2** Add an extra alarm only for a retry or failure path the code has.
- **ALARM-3** Define custom alarms by name in one module, typed from the builder's `addAlarm` parameter. `.addAlarm()` or `.addAlarms({ … })` are equally fine.
- **ALARM-4** Choose evaluation periods by the kind of signal.
- **ALARM-5** Give each alarm a description of the user impact and the first thing to check.
- **ALARM-6** Route alarms once, for the whole system, in each region that has alarms; when the topic is a component or differs by region, route per region where it is reachable, and test that every alarm has actions.
- **ALARM-7** Keep account-scoped components once per account and region, in a stack that lives as long as the account.

### Repository

- **PRACTICE-1** The CDK package imports nothing from the application code. A generated contract connects them.
- **PRACTICE-2** Generate repeated wiring from one exhaustive record.
- **PRACTICE-3** Ship test variants as separate assets, never as runtime flags on production code.
- **PRACTICE-4** Depend only on the `@composurecdk/*` packages the code imports, all on one version.
- **PRACTICE-5** Let one layer own retries and backoff.

### Writing a builder library

Extend the `recommended` and `libraryAuthor` presets of `@composurecdk/eslint-plugin` first.

- **LIB-1** Export every type your emitted declarations name, starting with each `*BuilderProps`.
- **LIB-2** Make a durable name a required prop. Never derive it from the build id or the compose key.
- **LIB-3** Type "at least one" as a non-empty tuple, and check it at run time.
- **LIB-4** Identify a value by a `Symbol.for` brand, never `instanceof`.
- **LIB-5** Test a builder that wraps another library through the synthesized template, not that library's internals.

## Don't and do

The layouts reviewers rejected most often. Names not imported from `@composurecdk/*` (`handler`, `processorAlarms`, `PROCESS_TIMEOUT`, `DataPlane`, `ingestEdge`, `SearchCluster` and its builder) are the app's own, for illustration: don't look for them in the library.

### A dependency hidden inside `build()` (DECL-3)

```ts
// Don't: the queue's dependency on the DLQ is invisible in the declaration
queue: {
  build: (scope, id, context) =>
    createQueueBuilder()
      .deadLetterQueue({
        queue: resolve(ref("dlq", (r: QueueBuilderResult) => r.queue), context),
        maxReceiveCount: 5,
      })
      .build(scope, id),
},

// Do: the input is a ref in the declaration, and the edge is in the map
queue: createQueueBuilder().deadLetterQueue(
  ref("dlq", (r: QueueBuilderResult) => ({ queue: r.queue, maxReceiveCount: 5 })),
),
// …
{ dlq: [], queue: ["dlq"] }
```

### A factory that takes the component's configuration (INLINE-2)

```ts
// Don't: timeout and grants move out of the declaration
processor: backendFunction("process", { timeout: PROCESS_TIMEOUT, grants: [write(data)] }),

// Do: the factory sets what every use shares; the call site chains the rest
export const handler = (name: string): IFunctionBuilder =>
  createFunctionBuilder()
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(Code.fromAsset(`dist/handlers/${name}`));

processor: handler("process")
  .timeout(PROCESS_TIMEOUT)
  .grant(bucketGrants.write(ref("data", (r: BucketBuilderResult) => r.bucket))),
```

### A subsystem that knows another subsystem (DECL-4)

```ts
// Don't: ingest-edge.ts imports the data plane and uses its key
.grant(queueGrants.send(ref("dataPlane", (r: DataPlane) => r.queue.queue)))

// Do: ingest-edge.ts asks for a queue…
export function ingestEdge(settings: Settings, { queue }: { queue: Ref<IQueue> }) {
  // … .grant(queueGrants.send(queue))
}
// …and app.ts says which
ingestEdge: ingestEdge(config, { queue: ref("dataPlane", (r: DataPlane) => r.queue.queue) }),
```

### A construct created outside the graph (DECL-10)

```ts
// Don't: no dependency edge, no stack placement, a path outside the compose tree
const cluster = new SearchCluster(stack, "Search", { nodes: 3 });
compose({ api: handler("api").environment({ SEARCH_URL: cluster.url }) }, { api: [] });

// Do: wrap it in a builder of your own, and make it a component
compose(
  {
    search: createSearchClusterBuilder().nodes(3),
    api: handler("api").environment({
      SEARCH_URL: ref("search", (r: SearchClusterBuilderResult) => r.cluster.url),
    }),
  },
  { search: [], api: ["search"] },
);
```

### A wrapper around the builder chain (DECL-8, INLINE-1)

```ts
// Don't: the reader meets the wrapper before the builder
processor: withAlarms(handler("process").timeout(PROCESS_TIMEOUT), processorAlarms()),

// Do: one fluent expression, read top to bottom
processor: handler("process")
  .timeout(PROCESS_TIMEOUT)
  .addAlarm("rejected", processorAlarms.rejected),
```

## When the library falls short

When ComposureCDK lacks a builder, a grant or an option, [open a feature request](https://github.com/laazyj/composureCDK/issues/new?template=feature_request.md), and keep the workaround small (INLINE-8). To say one of these rules is wrong, missing or unclear, use the [Guide feedback template](https://github.com/laazyj/composureCDK/issues/new?template=guide_feedback.md).
