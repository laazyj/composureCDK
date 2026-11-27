# Architecting a ComposureCDK app

This guide shows how to lay out an application built with ComposureCDK, from a first `compose()` to a system split into subsystems across several stacks. The package READMEs explain each builder. This guide is about putting them together: which layer each concern belongs in, when to write a component inline and when to extract it, and how to keep dependencies visible as the system grows.

It follows one small app through the decisions in order. Each decision names the rules behind it by ID, such as DECL-3. The rules, with their reasons and sources, are in the [catalogue of principles](principles.md). For how the library itself works, read [architecture.md](../architecture.md) first.

The example app accepts feedback over HTTPS, queues it, and processes it into a bucket. It needs an API and a function to accept submissions, and a queue, a dead-letter queue, a function and a bucket to process them. Imports are left out of the snippets for brevity.

## The four layers

An app has four layers, and dependencies point one way down this list (LAYER-1):

| Layer             | What it owns                                                                              | Where it lives                                 |
| ----------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Configuration** | What changes with the environment: the account, and the context that selects a variant    | `config.ts`                                    |
| **App**           | Policy that holds whatever the system contains: template hygiene, alarm routing           | `app.ts`                                       |
| **Stack**         | Deployment units: account and region, tags, retention, deploy order                       | inline at first, then `stacks.ts`              |
| **System**        | The architecture: `compose()`, its components, their configuration and their dependencies | `app.ts` at first, then one file per subsystem |

Each layer uses only what the layers before it provide. A component never reads context or knows which stack it is in. A stack holds no resources of its own.

## Configuration: read once, into typed settings

Read context and environment variables in one module, validate them against a closed set, and hand the rest of the app typed settings (LAYER-2, LAYER-3). The choice is configuration; what each choice means is code.

```ts
export const ACCOUNT_KEY = "feedback:account";
export const ACCOUNT_CLASS_KEY = "feedback:accountClass";

const ACCOUNT_CLASSES = ["integrated", "personal"] as const;
type AccountClass = (typeof ACCOUNT_CLASSES)[number];

export interface Settings {
  readonly account: string;
  readonly accountClass: AccountClass;
  readonly throttle: { readonly rateLimit: number; readonly burstLimit: number };
}

const BY_CLASS: Record<AccountClass, Omit<Settings, "account">> = {
  integrated: { accountClass: "integrated", throttle: { rateLimit: 50, burstLimit: 100 } },
  personal: { accountClass: "personal", throttle: { rateLimit: 3, burstLimit: 3 } },
};

export function settings(app: App, env: NodeJS.ProcessEnv = process.env): Settings {
  const account: unknown = app.node.tryGetContext(ACCOUNT_KEY) ?? env.CDK_DEFAULT_ACCOUNT;
  if (typeof account !== "string" || account === "") {
    throw new Error(`Set -c ${ACCOUNT_KEY}=<account> or CDK_DEFAULT_ACCOUNT`);
  }
  const accountClass: unknown = app.node.tryGetContext(ACCOUNT_CLASS_KEY) ?? "integrated";
  if (!ACCOUNT_CLASSES.includes(accountClass as AccountClass)) {
    throw new Error(
      `${ACCOUNT_CLASS_KEY} must be one of ${ACCOUNT_CLASSES.join(", ")}, not ${JSON.stringify(accountClass)}`,
    );
  }
  return { account, ...BY_CLASS[accountClass as AccountClass] };
}
```

- **There is no default account.** Synthesis fails fast without one (LAYER-4).
- **`env` is a parameter**, so a test can drive it instead of the machine's environment.
- **A typo can't deploy the other variant**, because an unknown value throws.
- **Standing configuration is committed code.** A value whose omission on a redeploy would destroy resources, such as an allowlist, is a constant, not a context flag (LAYER-5).

## The system: start with one `compose()`

Begin with one flat `compose()` in `app.ts` (DECL-2). The declaration is the architecture diagram: a reader should see every component, its key configuration and its dependencies in it (DECL-1).

```ts
const PROCESS_TIMEOUT = Duration.seconds(30);
const queueOf = (r: QueueBuilderResult) => r.queue;
const bucketOf = (r: BucketBuilderResult) => r.bucket;

export function buildApp(app = new App()) {
  templateTextPolicy(app);
  const { account } = settings(app);

  return compose(
    {
      data: createBucketBuilder(),
      dlq: createQueueBuilder("dlq"),
      queue: createQueueBuilder()
        .visibilityTimeout(Duration.seconds(PROCESS_TIMEOUT.toSeconds() * 6))
        .deadLetterQueue(
          ref("dlq", (r: QueueBuilderResult) => ({ queue: r.queue, maxReceiveCount: 5 })),
        ),
      processor: handler("process")
        .timeout(PROCESS_TIMEOUT)
        .environment({ DATA_BUCKET: ref("data", (r: BucketBuilderResult) => r.bucket.bucketName) })
        .grant(bucketGrants.write(ref("data", bucketOf)))
        .addEventSource("queue", sqsEventSource(ref("queue", queueOf))),
      accept: handler("accept")
        .environment({ QUEUE_URL: ref("queue", (r: QueueBuilderResult) => r.queue.queueUrl) })
        .grant(queueGrants.send(ref("queue", queueOf))),
      api: createRestApiBuilder()
        .restApiName("Feedback")
        .addMethod(
          "POST",
          ref("accept", (r: FunctionBuilderResult) => new LambdaIntegration(r.function)),
        ),
    },
    {
      data: [],
      dlq: [],
      queue: ["dlq"],
      processor: ["data", "queue"],
      accept: ["queue"],
      api: ["accept"],
    },
  )
    .withStackStrategy(
      singleStack(
        createStackBuilder()
          .env({ account, region: "eu-west-1" })
          .description("Feedback: ingest API, queue, processor and data bucket"),
      ),
    )
    .build(app, "Feedback");
}
```

Three rules shape it:

- **Every input is a `ref` set in the declaration, and every edge is in the dependency map** (DECL-3). The queue's dead-letter queue is a `ref`, so `queue: ["dlq"]` appears in the map. Never resolve a `ref` inside a component's `build()` where the declaration can't see it.
- **Each component is one fluent expression** (DECL-8). Don't hoist a builder into a variable to post-process it, or wrap it in a helper that adds alarms or grants out of sight.
- **Grants use the library's typed grants** (VOCAB-1). `queueGrants.send(...)` and `bucketGrants.write(...)` sit on the grantee, next to the `ref` that names what is granted.

One stack is enough to start with, so the stack is configured inline with `singleStack`, from `@composurecdk/core` (LAYER-9).

### Share what every use shares, and nothing more

The two functions share a runtime, a handler name, a code location and a default timeout. A small factory can hold exactly that (INLINE-2):

```ts
/** What every handler shares. Everything else is chained at the call site. */
export const handler = (name: string): IFunctionBuilder =>
  createFunctionBuilder()
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(Code.fromAsset(`dist/handlers/${name}`))
    .timeout(Duration.seconds(10));
```

It takes only an identifying argument and returns the builder interface, so each call site chains what differs: the processor's longer timeout, each function's environment and grants. Don't give it an options bag (`handler("process", { timeout, grants })`). That moves the component's configuration out of the declaration and assumes the two will always be configured alike. Share values, such as `PROCESS_TIMEOUT`, freely.

Write everything else inline until something is genuinely reused (INLINE-1).

### A construct with no ComposureCDK builder

When you need a construct the library has no builder for, from CDK or a third-party library, give it a builder of your own in the library's shape, and create it inline like any other component (DECL-10, INLINE-4). Don't create it outside `compose()` and pass it in: it would have no dependency edge, sit outside the compose tree, and be missed by the stack layer. Lookups of existing resources, such as `Topic.fromTopicArn(…)`, deploy nothing, so they can stay plain values made in the stack or app layer.

When the library ought to cover it, [report the gap](principles.md#reporting-a-gap-in-composurecdk).

## Split along the high-level design

The app has two parts any design document would draw: an **ingest edge** that accepts submissions, and a **data plane** that stores and processes them. Once a system has parts like these, give each a `compose()` of its own, so the compose graph has the same shape as the design (DECL-2). Size alone isn't a reason to split.

Each subsystem composes its components inline. The data plane's four components move into it unchanged:

```ts
/** Stores feedback, and processes it off the queue. */
export function dataPlane() {
  return compose(
    {
      data: createBucketBuilder(),
      dlq: createQueueBuilder("dlq"),
      queue: createQueueBuilder() /* … unchanged … */,
      processor: handler("process") /* … unchanged … */,
    },
    { data: [], dlq: [], queue: ["dlq"], processor: ["data", "queue"] },
  );
}

export type DataPlane = ReturnType<ReturnType<typeof dataPlane>["build"]>;
```

A subsystem asks for what it needs as a typed parameter, and never imports another subsystem or knows its keys (DECL-4). The ingest edge needs a queue, not "the data plane's queue":

```ts
/** Accepts feedback over HTTPS and queues it. */
export function ingestEdge(settings: Settings, { queue }: { queue: Ref<IQueue> }) {
  return compose(
    {
      /** Validates a submission and queues it. */
      accept: handler("accept")
        .environment({ QUEUE_URL: queue.map((q) => q.queueUrl) })
        .grant(queueGrants.send(queue)),
      /** The public endpoint. */
      api: createRestApiBuilder()
        .restApiName("Feedback")
        .deployOptions({
          throttlingRateLimit: settings.throttle.rateLimit,
          throttlingBurstLimit: settings.throttle.burstLimit,
        })
        .addMethod(
          "POST",
          ref("accept", (r: FunctionBuilderResult) => new LambdaIntegration(r.function)),
        ),
    },
    { accept: [], api: ["accept"] },
  );
}
```

`app.ts` says which queue that is, so the connection between the subsystems is visible in one place:

```ts
compose(
  {
    dataPlane: dataPlane(),
    ingestEdge: ingestEdge(config, { queue: ref("dataPlane", (r: DataPlane) => r.queue.queue) }),
  },
  { dataPlane: [], ingestEdge: ["dataPlane"] },
);
```

Settings reach a subsystem as parameters, never as context it reads itself. Where configuration chooses between two shapes of the system, the choice is an expression in this `compose()` call (LAYER-12).

**Split before production.** Nesting a `compose()` changes the construct path of everything in it, and so its logical IDs: the bucket's `FeedbackdataF4A54D3B` becomes `FeedbackdataPlanedata63640C24`, and CloudFormation replaces it (PATH-1). Settle the hierarchy before the first production deploy. If you must restructure a deployed system, pin the old IDs with [`at()`](../architecture.md#pinning-a-components-construct-id-with-at) (PATH-3), and prove the refactor is pure by diffing the synthesized templates resource by resource (PATH-2). Don't wrap app subsystems in [`scoped()`](../architecture.md#encapsulating-a-system-with-scoped), for the same reason (INLINE-7).

## Stacks: deployment units

A stack carries an environment, not architecture (LAYER-8). Once there are several stacks, or one needs a handle for retention or alarm routing, give the stack layer a module of its own (LAYER-9). Here both stacks need one, so the stack layer builds them. A stack that needs no handle can be given as a stack builder instead, and the strategy builds it.

```ts
/** The deployment units: environment, tags, retention and alarm routing. */
export function stacks(app: App, { account }: Settings) {
  const { stack: data } = createStackBuilder()
    .env({ account, region: REGION })
    .description("Feedback: stored and processed data")
    .terminationProtection(true)
    .tag("app", "Feedback")
    .build(app, "FeedbackData");
  const { stack: edge } = createStackBuilder()
    .env({ account, region: REGION })
    .description("Feedback: ingest API")
    .tag("app", "Feedback")
    .build(app, "FeedbackEdge");

  // The data outlives any one deployment of the stack that holds it.
  RemovalPolicies.of(data).retain({ applyToResourceTypes: ["AWS::S3::Bucket"] });

  // One alarm route, applied in each stack. A topic is a lookup, so it stays a plain value.
  for (const stack of [data, edge]) {
    const alertsArn = `arn:${stack.partition}:sns:${REGION}:${account}:ops-alerts`;
    const alerts = Topic.fromTopicArn(stack, "Alerts", alertsArn);
    alarmActionsPolicy(stack, { defaults: { alarmActions: [new SnsAction(alerts)] } });
  }

  return { data, edge };
}
```

`app.ts` places the **top-level subsystems**, never their inner components, so each deployment unit matches part of the design. Each subsystem gets a stack of its own, so use [`.withStacks`](../stack-management.md#3-stack-map-withstacks), the shortcut for `groupedStacks` with each key its own group; a missing subsystem doesn't compile. For stacks per Region, or per deployment unit of subsystems, use [`groupedStacks`](../stack-management.md#groupedstacks) instead (LAYER-9):

```ts
export function buildApp(app = new App()) {
  // App: policy that holds whatever the system contains.
  templateTextPolicy(app);
  const config = settings(app);

  // Stack: the deployment units.
  const { data, edge } = stacks(app, config);

  // System: the architecture.
  compose(
    {
      dataPlane: dataPlane(),
      ingestEdge: ingestEdge(config, { queue: ref("dataPlane", (r: DataPlane) => r.queue.queue) }),
    },
    { dataPlane: [], ingestEdge: ["dataPlane"] },
  )
    .withStacks({ dataPlane: data, ingestEdge: edge })
    .afterBuild(
      outputs({
        ApiUrl: {
          value: ref("ingestEdge", (r: IngestEdge) => r.api.api.url),
          description: "POST feedback here",
          scope: "ingestEdge",
        },
      }),
    )
    .build(app, "Feedback");

  return { data, edge };
}
```

- **The `ref` between the two stacks just works.** Within one account and region it becomes a cross-stack reference, and its strength (`@aws-cdk/core:defaultCrossStackReferences`) is your decision: see [Cross-stack references](../stack-management.md#cross-stack-references). Across regions in one account a `ref` works too, with the same choice of strength; across accounts, link by a deterministic name that both sides build with one shared helper (LAYER-13).
- **Each output is scoped to the component that produces it**, so it lands in that component's stack (DECL-7, [Per-output stack routing](../stack-management.md#per-output-stack-routing)).
- **Alarm routing is decided once, and reaches every stack** (ALARM-6). With stacks in more than one region, each region needs a target.
- **Deploy order between stacks that link by name is the stack layer's job:** `addStackDependency(…, reason)` (LAYER-11). `compose()` orders the build, not the deploy ([Deploy-time dependencies](../architecture.md#deploy-time-dependencies-with-dependson)).

A deployment framework that supplies its own `Stack` subclass needs this separate stack layer from the start.

## App-wide policy

Install policies once, on the `App` or a stack, before the system builds (LAYER-6). [Policies](../architecture.md#policies) are Aspects, so they reach the resources builders create internally. Use the library's first: `templateTextPolicy` rejects characters CloudFormation would silently rewrite, and `alarmActionsPolicy` routes every alarm. Once a policy enforces something, don't configure it again per builder.

Keep the builders' recommended alarms; turn one off only for a reason specific to your system (ALARM-1).

## Defaults are decisions

The builders' defaults are secure and operational, so most of the example sets nothing beyond what it needs. Before overriding one, know how it combines with what you pass: top-level props replace the default, so pass only the difference, spreading the exported defaults where you extend a list (DEFAULT-1, [Defaults](../architecture.md#defaults)). Opt out of a secure default explicitly, at the call site (DEFAULT-3). State in code the defaults your rollback or security depends on, and assert them in a test, because an upgrade can change a default (DEFAULT-4).

One setter to know: the Lambda builder's `.environment()` replaces the whole environment rather than merging (DEFAULT-5).

## Tests

Synthesize the real app, once per context, through one `testApp()` that pins every input from the environment (TEST-1, TEST-2):

```ts
export const TEST_ACCOUNT = "123456789012";

// In your app, read this context from the same cdk.json the CLI uses (TEST-1).
const CDK_CONTEXT = { "@aws-cdk/core:defaultCrossStackReferences": "weak" };

export const testApp = (context: Record<string, unknown> = {}) =>
  new App({ context: { ...CDK_CONTEXT, [ACCOUNT_KEY]: TEST_ACCOUNT, ...context } });

describe("the feedback app", () => {
  let built: ReturnType<typeof buildApp>;
  beforeAll(() => {
    built = buildApp(testApp());
  });

  it.each([["data"], ["edge"]] as const)(
    "synthesizes the %s stack with no warnings or errors",
    (key) => {
      const annotations = Annotations.fromStack(built[key]);
      expect(annotations.findWarning("*", Match.anyValue())).toEqual([]);
      expect(annotations.findError("*", Match.anyValue())).toEqual([]);
    },
  );

  it("retains the data bucket", () => {
    const buckets = Template.fromStack(built.data).findResources("AWS::S3::Bucket");
    // By identity: the builder's defaults add an access-log bucket beside it.
    const data = Object.entries(buckets).filter(([id]) =>
      /^FeedbackdataPlanedata[0-9A-F]{8}$/.test(id),
    );
    expect(data).toHaveLength(1);
    expect(data[0]?.[1].DeletionPolicy).toBe("Retain");
  });
});
```

Both tests earned their place while this guide was written:

- **The annotations check, one case per stack** (TEST-5), failed until the cross-stack reference strength was set. Without it, CDK warns once the app has two stacks.
- **The bucket test finds the bucket by its identity** (TEST-3). A first version matched every retained bucket and found two, because the bucket builder adds an access-log bucket by default. A test that selects by type, or by the property it checks, passes or fails for the wrong reason (TEST-8).

Beyond these, pin exactly what matters: the sorted list of alarm names, IAM statements, and policies (TEST-4). Assert what clients depend on, not the library's internal naming (TEST-7).

## Before production

- **Deploy early to a disposable account** (DEPLOY-1). Some failures only a deploy finds; the catalogue lists the [traps found so far](principles.md#traps-found-only-on-deploy). Turn each one into a synth-time guard or a test across the whole template (DEPLOY-2).
- **Make disposable stacks disposable, and keep account-wide resources out of them** (DEPLOY-3, ALARM-7).

## Where next

- **[The catalogue of principles](principles.md)** has every rule, including those this guide only mentions, with its reasons and sources.
- **[Agent rules](../../packages/core/docs/agent-rules.md)** are the same rules condensed for coding agents, and ship in `@composurecdk/core`.
- **[Examples](../../packages/examples/README.md)** are deployable apps built with ComposureCDK.
- **Found a rule wrong, missing or unclear?** Use the [Guide feedback template](https://github.com/laazyj/composureCDK/issues/new?template=guide_feedback.md).
