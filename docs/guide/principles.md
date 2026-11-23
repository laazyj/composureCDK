# Principles for architecting a ComposureCDK app

This is the catalogue of rules for laying out an application built with ComposureCDK: where configuration, policy, stacks and the `compose()` system go, and the habits that keep the system readable and upgradable as it grows. It is for people writing apps, for coding agents, and for anyone reviewing either. A section at the end covers writing a builder library.

The rules come from the review histories of two production apps built independently on ComposureCDK 0.11–0.14, collected in [#784](https://github.com/laazyj/composureCDK/issues/784). That issue holds the source text, with the code examples each rule grew from. The maintainer's decisions, and feedback from checking a builder library against the catalogue, are linked under Sources below.

This catalogue is the source of truth. The guide, the condensed rules for agents and the reviewer rubric are written from it, and refer to rules by ID. How the library works is explained in [architecture.md](../architecture.md); the rules link to it rather than repeat it.

## Reading an entry

Each rule has a stable ID. IDs are never reused or renumbered: a retired rule keeps its ID and is marked **retired**, so feedback and review comments that cite it still resolve.

Each entry ends with a line of tags, in this order:

1. **Kind**, always given.
   - `core`: a rule about using ComposureCDK. It goes in the guide and the agent rules.
   - `practice`: good practice for any CDK app, which ComposureCDK users kept running into. It goes in the guide's appendix, whichever section it sits in here.
   - `library`: a rule for writing builders that others use. It goes in the guide's section for library authors.
   - `gap`: advice that exists only because the library lacks something. It goes once its `gap` issue closes.
2. **Confidence**, always given.
   - `converged`: both apps reached it independently.
   - `decided`: the maintainer decided it, settling a disagreement or in an ADR.
   - `provisional`: one app found it. It is likely right, but needs a second source.
   - `opinion`: a matter of taste. It is recorded so feedback has something to cite, and is not enforced.
3. **enforced:** how a breach is caught, when that is more than review: `type` (the type system), `lint` (a named rule in `@composurecdk/eslint-plugin`), `test` (the app's own tests) or `none`. Any rule not marked `none` is also a reviewer's to check.
4. **gap:** the issue tracking a library gap behind the rule, on any kind of rule.
5. **see:** the part of the library's docs the rule applies.
6. **Sources**, always given.
   - `A§n`: the principles in the body of #784.
   - `B Pn`: the second app's guide, in the first comment on #784.
   - `B Part 2.n`: its list of gaps to check for.
   - `B #n`: its catalogue of 79 lessons.
   - `D n`: a decision: [1–5](https://github.com/laazyj/composureCDK/issues/784#issuecomment-7081589648), [6](https://github.com/laazyj/composureCDK/issues/784#issuecomment-7094761842).
   - `F n`: item n of the feedback on the catalogue's first draft: [1–6](https://github.com/laazyj/composureCDK/pull/859#issuecomment-7106549266), [7](https://github.com/laazyj/composureCDK/pull/859#issuecomment-7107219269).

To say a rule is missing, wrong, unclear, in conflict with another, belongs somewhere else, or held up in your app, use the [**Guide feedback** template](https://github.com/laazyj/composureCDK/issues/new?template=guide_feedback.md).

## Reporting a gap in ComposureCDK

When ComposureCDK lacks a builder, a grant or an option your app needs, [open a feature request](https://github.com/laazyj/composureCDK/issues/new?template=feature_request.md). Describing the use case is what gets a gap closed, and closing it lets you delete the workaround.

## The layers

An app has four layers: configuration, app, stack and system. Each one owns something different, and most layout feedback came from something being in the wrong layer.

### LAYER-1: Keep configuration, app, stack and system as separate layers, depending one way

Configuration chooses the environment. The app applies policy that holds whatever the system contains. A stack is a unit of deployment. The system is the `compose()` declaration of the architecture. Each layer may use what the layers before it provide, never what comes after.

`core` · `converged` · A§0, B P1, B P4

### LAYER-2: Read and validate configuration once, at the app layer, into typed settings

Context and environment variables are read in one module and turned into typed settings. The choice is configuration, but what each choice means is code: a context value selects an entry in a typed record. Nothing below the app reads context or `process.env`. Treat `process.env` as a parameter, so tests can drive it.

`core` · `converged` · A§0, B P7, B #40

### LAYER-3: Validate settings against a closed set, in combination, and with one default each

Throw on an unknown value, so a typo can't deploy the other variant. Check combinations at synth, not at deploy, ordering the checks so each error names the actual mistake. Each switch has one resolver that holds its default and feeds every consumer (environment variables, conditional grants and conditional alarms). Pass `undefined` through rather than defaulting a second time.

`core` · `converged` · enforced: `test` · A§0, B P7, B #40, B #41

### LAYER-4: Don't hard-code the account; fail fast when it is missing or doesn't match the credentials

`practice` · `provisional` · A§0

### LAYER-5: Keep standing configuration in committed code, not in context flags

A value whose omission on a redeploy would destroy resources, such as an allowlist of delegated accounts, is a committed constant.

`practice` · `provisional` · A§0

### LAYER-6: Install app-wide policy once, on the `App`, before any stack exists

Use the library's policies first: `alarmActionsPolicy` and `alarmNamePolicy` (`@composurecdk/cloudwatch`), `templateTextPolicy` (`@composurecdk/cloudformation`), `topicPolicyConflictPolicy` (`@composurecdk/sns`). Where none exists, write one in the same shape, so it reaches the resources builders create internally. Once the app enforces something, don't configure it again per builder. Tests that build their own `App` don't get these policies unless they install them, so make that an explicit choice.

`core` · `converged` · see: [Policies](../architecture.md#policies), [ADR-0002](../adr/0002-policies.md) · A§0, B P4, B #19

### LAYER-7: An Aspect reaches only constructs in the tree

A resource a service creates at run time, such as a log group, escapes app-wide policy. Create it in the app so the policy applies, or use the builder that creates it (VOCAB-6).

`core` · `provisional` · A§0

### LAYER-8: A stack is a deployment unit: it carries an environment, not architecture

A stack carries its account and region, tags, description, deploy order, and any retention that differs between deployment units. It has no resources of its own and does no wiring. Don't give each domain its own stack.

`core` · `converged` · A§0, B P1, B #1

### LAYER-9: Hand stacks to the system in a way that fits its size

- **One stack:** build the system into it.
- **Several stacks:** `app.ts` places every **top-level subsystem**, never their inner components, with `.withStacks({ … })`, or `groupedStacks(…)` when several share a stack, so each deployment unit matches part of the architecture.
- **A stack that needs a handle** (retention, Aspects, deploy order): a stack layer of its own (`stacks.ts`) builds it and returns it, and the placement takes the built stack. Otherwise the placement can take a builder.

Deployment tooling can decide it for you: a pipeline framework that supplies its own `Stack` subclass needs the separate stack layer from the start. If such a stack needs a component that is already built (say its environment comes from a pipeline construct), build that part of the system first, then the stacks, then the rest.

`core` · `decided` · enforced: `type` (exhaustive placement, also checked at synth) · gap: [#884](https://github.com/laazyj/composureCDK/issues/884) · see: [Stack management](../stack-management.md#decision-guide), [ADR-0023](../adr/0023-stack-strategy-is-the-one-routing-seam.md) · A§0, B P1, B P4, D 3, F 4

### LAYER-10: Put a region-bound resource in a stack in that region, rather than switching features off

`core` · `provisional` · A§0

### LAYER-11: Deploy order between stacks is a stack-layer concern

`compose()` orders the build, not the deploy. When two stacks are linked by name rather than by `ref`, order them with `addStackDependency(…, reason)` in the stack layer.

`core` · `provisional` · enforced: `test` · A§0

### LAYER-12: A choice between variants of the system is made visibly in `app.ts`

Configuration may choose the system's shape, but only as an expression in the `compose()` call in `app.ts`, from settings passed in as parameters (LAYER-2).

`core` · `converged` · A§0, B P7

### LAYER-13: Cross a stack boundary with `ref` within an account and region, and by deterministic name beyond it

Within one account and region, a `ref` between stacks becomes a cross-stack reference, whose strength is your decision. Across accounts or regions, or into a stack that may not exist, both sides import one function that builds the name, and the system takes the link as an optional typed input. For example, an approval step in a pipeline's account that waits on an alarm in the service's account names the alarm by ARN, and both sides import the helper that builds it. Make the leak visible in the declaration rather than hiding it, and test the name helper (TEST-10).

`core` · `provisional` · see: [Cross-stack references](../stack-management.md#cross-stack-references) · A§0, F 6

## The declaration

### DECL-1: The `compose()` declaration is the architecture diagram

A reader should see the components, their key configuration and their dependencies in the `compose()` call. If the map is only a list of names that call factories elsewhere, it is too thin to describe the system.

`core` · `converged` · A§1, B P2, B #4

### DECL-2: Start with one `compose()`; split into named subsystems along the high-level design

Begin with one flat `compose()`. Split it into named subsystems when the system has subsystems in its high-level design (for example an ingestion edge, a UI edge and a core processing unit), so the compose graph and the HLD show the same shape. Size alone is not a reason to split: shorten a long declaration with factories (INLINE-2). The app composes the subsystems, and each subsystem composes its components inline. Settle the split before production (PATH-1).

`core` · `decided` · A§1a, B P1, D 1

### DECL-3: Every edge is in the dependency map, and every input is a `ref` set in the declaration

Never resolve a `ref` the declaration didn't pass in: expose it as a builder prop so the dependency shows in the declaration. A grant that refers to a sibling needs that sibling in the map.

`core` · `converged` · enforced: `type` (exhaustive map) · see: [Dependency declarations are exhaustive](../architecture.md#dependency-declarations-are-exhaustive) · A§1b, A§3, B P2, B #5

### DECL-4: Wire subsystems together in `app.ts` with typed `Ref<T>` parameters

A subsystem asks for what it needs (`{ queue }: { queue: Ref<Queue> }`), and `app.ts` says which component provides it. Subsystems never import each other or know each other's keys.

`core` · `converged` · A§1c, B P2, B #6

### DECL-5: A variant with different resources is a separate component, chosen in the map

Don't add pass-through components to make two variants fit one shape.

`core` · `provisional` · A§1d

### DECL-6: Side effects are named components in the map, not hidden in `.afterBuild()` or inside another builder

`core` · `provisional` · A§1e

### DECL-7: Scope each output to the component that produces it

`core` · `provisional` · A§1f

### DECL-8: Each component is one fluent expression in the map

Don't hoist a component into a variable to post-process it.

`core` · `converged` · A§2, B P2

### DECL-9: Generate conditional components and their dependency entries from the same source

When components come from a record or a condition, derive their dependency entries from it too, so adding one can't leave an entry missing.

`core` · `provisional` · B P8, B Part 2.5, B #56

### DECL-10: Build every construct inside the graph; give one with no library builder a builder of your own

A construct from CDK or a third-party library that has no ComposureCDK builder (VOCAB-5) joins the system as a component, through a builder written as INLINE-4 describes. Never create it outside `compose()` and pass it, or values read from it, into the graph: it would have no dependency edge (DECL-3), sit at a construct path off the compose tree (PATH-1), and be missed by the stack layer and `afterBuild` hooks. Until the builder exists, an inline `{ build } satisfies Lifecycle<…>` will do; replace it once one exists, yours or the library's.

Lookups of existing resources (`Bucket.fromBucketName(…)`, `Vpc.fromLookup(…)`) and stacks are the exceptions: make them in the stack or app layer and pass them in as typed inputs (DECL-4, LAYER-9).

`core` · `decided` · see: [Implementing a component with a builder](../architecture.md#implementing-a-component-with-a-builder), [Implementing Ref support in a builder](../architecture.md#implementing-ref-support-in-a-builder) · D 6, F 3

### DECL-11: When the order of side effects on a shared parent matters, make it an edge

Siblings with no edge between them have no defined build order. When each one changes a shared parent through an `add*`-style API (`pipeline.addStage(…)`), that order becomes the result's, and the map shows nothing of it. List each one's predecessor in the dependency map (`prod: ["pipeline", "beta"]`), and pin the order in a test (TEST-4).

`core` · `provisional` · see: [compose](../architecture.md#compose) · F 2

### DECL-12: Decline features that hide information or would make a cycle in the compose graph

The dependencies between components form a DAG, which is stricter than CloudFormation.

`core` · `provisional` · A§5

## Abstraction

### INLINE-1: Write it inline first; abstract only for reuse

A helper that hides part of a builder chain, or ties two subsystems together, makes the system harder to read. A one-off wrapper adds opacity for no gain.

`core` · `converged` · A§2, B P2

### INLINE-2: A shared factory sets only what every use shares

A factory may set only what is true of every use (runtime, handler, code, encryption), takes at most an identifying argument, returns the builder interface (`IFunctionBuilder`, `ITableV2Builder`, …) so call sites can chain on it, and lives beside the map. Everything that varies (timeout, environment, grants, alarms, refs) is chained at the call site. No options bags. A second variant is a second factory, or code written inline. Share values (constants, paths, selectors) freely.

`core` · `decided` · A§2, B P2, B P3, B #10, B #11, D 2

### INLINE-3: A builder does one job

It returns what it makes. Whatever consumes that is its own component, wired with `ref`.

`core` · `provisional` · A§2

### INLINE-4: Logic beyond a builder chain goes in a named builder of its own

When a component needs fan-out, validation or a service the library doesn't cover, write a builder in its own `*-builder.ts`, in the library's shape, and create it inline (`createX()`). Keep each validation with whatever knows the thing it checks. If the library should cover it, [report the gap](#reporting-a-gap-in-composurecdk).

`core` · `provisional` · enforced: `lint` (the [`recommended` preset](../../packages/eslint-plugin/README.md#rules)) · see: [Implementing a component with a builder](../architecture.md#implementing-a-component-with-a-builder) · A§2

### INLINE-5: Helper modules hold pieces, not components

A state-machine definition, constants, log formats and URI helpers live in helper modules. They take resources that are already resolved, and never resolve refs or build whole components.

`core` · `provisional` · B P2, B #5

### INLINE-6: Don't export internal helpers; delete unused ones on every refactor

Keep `xOf` selectors private. Keep a one-line `ref` beside its only consumer, and move it to a shared module only once a second consumer needs it.

`core` · `converged` · A§2, B P2, B #8

### INLINE-7: Don't use `scoped()` in an app; keep it for reusable composite builders

It changes the construct path of everything under it (PATH-1).

`core` · `decided` · see: [Encapsulating a system with `scoped`](../architecture.md#encapsulating-a-system-with-scoped) · A§6, B P1, B #3, D 5

### INLINE-8: Keep a workaround small, inside the declaration, and true to the system's shape

It has the same components and dependency edges the real thing would have, and its `ref` selects only the fields it uses.

`core` · `provisional` · A§5

## The library's vocabulary

### VOCAB-1: Grant with a typed `*Grants` first, then `grantVia`, then a raw statement

Declare permissions on the grantee's builder with the library's typed grants. When none is tight enough, use `grantVia(ref, fn)`, and write a raw `PolicyStatement` only when neither fits. A missing typed grant is worth [reporting](#reporting-a-gap-in-composurecdk). Don't let a second grant style grow alongside the library's.

`core` · `converged` · see: [ADR-0013](../adr/0013-consumer-side-grants.md) · A§3, B P5, B #22, B #23

### VOCAB-2: Grant at the resource, not its key, and make every grant work on its own

The library's table and bucket grants carry the resource's customer-managed key, so grant the resource and let the key come with it. A grant that only works because a neighbouring grant supplies part of it breaks when the neighbour goes.

`core` · `provisional` · B P5, B #26, B #27

### VOCAB-3: Use the narrowest verb that matches what the code does

When the library adds a narrower verb, sweep every grantee for over-grants, not just the line you came to change.

`core` · `provisional` · B P5, B Part 2.8, B #28, B #29

### VOCAB-4: Work with refs through `ref`, `Ref<T>.map()`, `combine()` and `dependsOn()`

In the declaration, never `resolve()` a ref and then change what it returns. To deploy one component after another that nothing in its template references, wrap it in `dependsOn(component, { target, sources })` rather than an inline `Lifecycle` that calls `node.addDependency(resolve(…))`. A builder resolves its own props inside `build()`, which is how [Ref support](../architecture.md#implementing-ref-support-in-a-builder) works.

`core` · `converged` · see: [Combining refs](../architecture.md#combining-refs--one-consumer-many-dependencies), [Deploy-time dependencies](../architecture.md#deploy-time-dependencies-with-dependson), [ADR-0022](../adr/0022-deploy-dependencies-at-composition.md) · A§3, B P2

### VOCAB-5: Check the library before writing L1 constructs or IAM by hand

Look for a builder (budgets, Bedrock, WAF, …) and its recommended-defaults methods first.

`core` · `converged` · A§3, A§5, B P5, B #24, B #25

### VOCAB-6: Inside a custom builder, build child resources with the library's builders

That way the app's policies still apply to them, and their alarms are named and actioned like the library's. Return alarms built with `AlarmDefinitionBuilder` and `createAlarms`.

`core` · `provisional` · A§3

### VOCAB-7: Check what a library builder synthesizes against your own policies

A builder can add resources you didn't expect, such as a custom-resource Lambda whose log group has no retention. When it does, replace it locally (DECL-10) and [report the gap](#reporting-a-gap-in-composurecdk).

`core` · `provisional` · A§3

## Defaults

### DEFAULT-1: Know how a builder's defaults combine with what you pass, and add only the difference

Top-level props replace the default, so passing a config object can drop the whole default. Override only what differs: spread the exported defaults (`BUCKET_DEFAULTS`, `DEFAULT_BUCKET_LIFECYCLE_RULES`, …) and add the difference.

`core` · `converged` · see: [Defaults](../architecture.md#defaults), [ADR-0009](../adr/0009-defaults-yield-to-mutually-exclusive-siblings.md) · A§4, B P3

### DEFAULT-2: Work out how your settings combine with the defaults

For example, an expiry rule on a versioned bucket combines with the default noncurrent-version rule, and keeps objects longer than either says alone.

`core` · `provisional` · A§4

### DEFAULT-3: Opt out of a secure default explicitly, at the call site

`core` · `converged` · A§4, B P8

### DEFAULT-4: State the defaults that rollback, security or shared resources depend on, and assert them in a test

A library upgrade can change a default.

`core` · `provisional` · enforced: `test` · A§4

### DEFAULT-5: The Lambda builder's `.environment()` replaces the whole environment

Spread the variables every function needs into each call, and test the convention.

`gap` · `provisional` · enforced: `test` · gap: [#858](https://github.com/laazyj/composureCDK/issues/858) · B P3, B #12

### DEFAULT-6: Write security-critical configuration literally

A redaction list built with `.map()` hides its contents from scanners and readers.

`core` · `provisional` · A§4

## Construct paths and logical IDs

### PATH-1: Logical IDs follow the compose tree, so settle the hierarchy before production

Nesting `compose()`, `scoped()` and moving a component between builders all change construct paths, and so logical IDs, alarm names and anything derived from paths. That replaces resources.

`core` · `converged` · see: [ADR-0012](../adr/0012-explicit-build-id-decoupled-from-compose-key.md), [ADR-0020](../adr/0020-scoped-system-construct.md) · A§6, B P1, B #3

### PATH-2: Prove a layout refactor is a pure refactor

Diff the synthesized templates resource by resource, for every stack and every deploy variant.

`core` · `converged` · A§6, B P10

### PATH-3: When a resource has to move, keep its ID or plan its replacement

- To nest a deployed system without changing its IDs, pin them with `at(id, component)`.
- Otherwise CloudFormation creates the new resource before deleting the old one. Plan for both existing at once (for example `retainOnDelete`), and change a unique physical name, or keep it through the builder's `configure` hook.
- Rename with `cdk refactor`, or pin a critical resource with `overrideLogicalId`.

`core` · `converged` · see: [Pinning a component's construct id](../architecture.md#pinning-a-components-construct-id-with-at) · A§6, B P5, B #24

## Tests

### TEST-1: Build every test through one `testApp()` that pins every input from the environment

Load context from the same `cdk.json` the CLI uses, never a copy. Blank `CDK_DEFAULT_ACCOUNT` in the test config.

`core` · `provisional` · A§7

### TEST-2: Synthesize the real app, once per context, and test each subsystem on its own

Build each subsystem into a bare `Stack` with inputs the real app doesn't use yet.

`core` · `converged` · A§7, B P9

### TEST-3: Find a resource by its identity, and assert there is exactly one

Never find it by position or a literal logical ID, which breaks on restructure.

`core` · `converged` · A§6, A§7, B P9, B #57

### TEST-4: Pin what matters exactly

That means the sorted list of every alarm name, IAM statements, redaction lists, bucket policies, trust conditions, and `DependsOn` where order matters. Use `toEqual`, not `arrayContaining`.

`core` · `converged` · A§7, B P9, B #64

### TEST-5: Check every stack for annotations, with `it.each` so a failure names the stack

`core` · `provisional` · A§7

### TEST-6: Test both variants of an optional feature, and the failure path

Synthesize every deploy variant, and assert that what is forbidden is absent from the whole template. Guard a security property with `node.addValidation`, and expect synthesis to throw when it is broken.

`core` · `converged` · A§7, B P9, B #63

### TEST-7: Assert what clients depend on, not the library's internal naming

For a library-default alarm, assert it by your component key. For an alarm you configured, also assert its metric, dimensions and threshold.

`core` · `converged` · A§7, B P9, B Part 2.6, B #65

### TEST-8: Never pass vacuously

Check a population is non-empty before looping over it. Don't select it by the property under test. Derive expected counts and lists from the source they must cover, never a hard-coded number.

`core` · `converged` · A§7, B P9, B #59, B #60

### TEST-9: Check invariants across the whole template

For example: every role can decrypt with its table's key, every task retries throttling, and every handler keeps its shared environment.

`core` · `provisional` · B P9, B #62

### TEST-10: Rebuild a derived name from the synthesized resource's properties

So the name helper can't drift from what the builder produces.

`core` · `provisional` · A§0, A§7

### TEST-11: Parse a state-machine definition; don't search its text

`practice` · `provisional` · B P9, B Part 2.1, B #61

### TEST-12: Mutation-check a narrowed grant

Revert the grant and watch the test fail.

`practice` · `provisional` · B P9, B #64

## Deploying

### DEPLOY-1: Template tests aren't enough: deploy early to a disposable account

Fire each new kind of alarm once, and exercise each cross-stack path, including a failure you cause on purpose. Don't trust a claim that "the service does X itself" until a deploy shows it. The traps below were each found only on deploy.

`practice` · `converged` · A§8, B P6

### DEPLOY-2: Turn every failure found on deploy into a synth-time guard or a template-wide test

`practice` · `converged` · enforced: `test` · A§8, B P6

### DEPLOY-3: Make a disposable stack disposable, and keep account-wide resources out of it

ComposureCDK keeps logs, keys and buckets by default. A disposable stack needs a policy that destroys them, such as the examples' [`cleanDeskPolicy`](../../packages/examples/src/clean-desk-policy.ts), and the bucket builder's own removal policy so the bucket is emptied. Account-wide resources go elsewhere (ALARM-7).

`practice` · `provisional` · B P4, B Part 2.4, B #20

### Traps found only on deploy

Only the traps an app still has to act on are listed. Ones the library has since fixed are in its release notes.

| Trap                                                                                                      | Status                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Step Functions SDK tasks (for example `DynamoUpdateItem`) don't get the table's customer-managed key      | [#856](https://github.com/laazyj/composureCDK/issues/856). Meanwhile grant the table on the state machine too.                |
| `LambdaInvoke`'s default retrier doesn't retry Lambda throttling                                          | [#857](https://github.com/laazyj/composureCDK/issues/857). Meanwhile add a full-jitter throttling retry to every Lambda task. |
| A fresh account can't reserve Lambda concurrency, and dropping it removes the builder's concurrency alarm | Pin the alarm list (TEST-4).                                                                                                  |
| WAF logging delivers nothing until the log group has a resource policy                                    | `@composurecdk/wafv2` adds no policy, and whether WAF adds one itself is unconfirmed (A§5). Check on deploy.                  |
| An unaliased DynamoDB reserved word in an expression fails at run time                                    | [`@composure-labs/dynamodb-guard`](https://github.com/composure-labs/dynamodb-guard) fails synth.                             |
| A grant to a single object key in a bucket known only by name needs a raw statement                       | [#782](https://github.com/laazyj/composureCDK/issues/782). Meanwhile `grantVia` (VOCAB-1).                                    |

## Alarms

### ALARM-1: Keep every alarm the builders recommend; turn one off only for a reason specific to your system

`core` · `converged` · A§10, B P8, B #52

### ALARM-2: Opt in to an extra alarm only with a reason tied to your code

It should watch a retry or failure path your code has. Pair a grant with the alarm that would catch it failing.

`core` · `provisional` · B P8, B #53, B #54

### ALARM-3: Define custom alarms by name in one module, typed from the builder

Take the type from the builder's `addAlarm` parameter rather than restating it. Whether to attach them one `.addAlarm(key, def)` at a time or with `.addAlarms({ … })` is a matter of taste.

`core` · `opinion` · enforced: `none` · see: [ADR-0021](../adr/0021-alarm-keys-typed-on-the-result.md) · A§2, A§10, D 4

### ALARM-4: Choose evaluation periods by the kind of signal

A traffic-driven signal must be sustained. A broken invariant can alarm on one datapoint. An intermittent failure uses M of N.

`practice` · `provisional` · A§10

### ALARM-5: An alarm's description gives the user impact and the first thing to check

`practice` · `provisional` · A§10

### ALARM-6: Decide where alarms go once, for the whole system, and in every region

Until then, alarms change state and notify no one.

`core` · `converged` · A§0, B P8, B Part 2.3

### ALARM-7: Account-scoped components live once per account and region, in a stack that lives as long as the account

Budgets and account-level alarms sit together, in a stack that is never torn down with an environment.

`core` · `provisional` · B P8, B Part 2.4, B #55

## Repository

### PRACTICE-1: The CDK package imports nothing from the application; a generated contract connects them

`practice` · `provisional` · A§9

### PRACTICE-2: Derive wiring from one source

Generate grants and integration URIs from one exhaustive record, as DECL-9 does for components. Don't hand-maintain lists AWS owns.

`practice` · `provisional` · B P7, B #43–#46

### PRACTICE-3: Ship test variants as separate assets, not as runtime flags on the production code

`practice` · `provisional` · B P7, B #42

### PRACTICE-4: List only the `@composurecdk/*` packages the code imports, and move them together on one version

`practice` · `converged` · A§9, B P10, B #70

### PRACTICE-5: Let one layer own retries and backoff

Don't stack SDK retries under workflow retries.

`practice` · `provisional` · B P6, B #36

## Writing a builder library

These apply when you publish builders for others to use, such as a library that fills a DECL-10 gap. Start by extending the `recommended` and `libraryAuthor` [lint presets](../../packages/eslint-plugin/README.md#presets), which check much of what a library owes its consumers; the rules here are what they don't, or don't yet, check. The rules above apply too, wherever a library builds a system of its own. See also [Public API](../architecture.md#public-api) and [Implementing a component with a builder](../architecture.md#implementing-a-component-with-a-builder).

### LIB-1: Export every type your emitted declarations name, starting with each `*BuilderProps`

A consumer's declaration emission has to name them, and fails with TS2883 when the package doesn't export one. A candidate for a lint rule.

`library` · `decided` · see: [ADR-0001](../adr/0001-builder-type-emission.md) · F 1

### LIB-2: A durable name is a required prop, never derived from the build id or the compose key

A name that must not change, such as a physical name, would otherwise change whenever the construct path does (PATH-1).

`library` · `provisional` · see: [ADR-0012](../adr/0012-explicit-build-id-decoupled-from-compose-key.md) · F 1

### LIB-3: Type "at least one" as a non-empty tuple, and check it at run time for JavaScript callers

`library` · `provisional` · F 1

### LIB-4: Identify a value by a `Symbol.for` brand, never `instanceof`

The ESM and CommonJS copies of a package can both load in one process, even through a relative import. For a CDK class you can't brand, read its L1 instead.

`library` · `decided` · enforced: `lint` ([`no-realm-bound-instanceof`](../../packages/eslint-plugin/docs/rules/no-realm-bound-instanceof.md)) · see: [ADR-0007](../adr/0007-dual-esm-cjs-publishing.md), [ADR-0011](../adr/0011-cross-component-relationship-guards.md) · F 1

### LIB-5: Test a builder that wraps another library through the synthesized template

Don't assert on the wrapped library's internal APIs, such as underscore-prefixed methods: they change without notice.

`library` · `provisional` · F 5

## Not carried over

These came up in the source apps but are specific to one organisation's tools or process, so they are not rules here: a particular security-blueprint library, a package-registry mirror's import lag (B #68, B #69, B #78), a review tool that drops comments between revisions, and change-request conventions.

Nor are rules about how a team runs its own changes: what a workaround's comment says, whether and where to file a gap in someone else's library, the steps of an upgrade, design docs and READMEs, change descriptions, and promotion gates. ComposureCDK takes no position on a team's process (F 7).
