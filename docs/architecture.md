# Architecture

This document describes the core abstractions in ComposureCDK: the **Lifecycle** interface, the **Builder** pattern, **compose**, and **Ref** — the lazy reference mechanism that wires them together.

## Design Drivers

AWS CDK provides L2 constructs for individual resources, but leaves integration — wiring permissions, passing references between constructs, ordering creation — to the application developer. This produces procedural code where dependencies between components are implicit in execution order rather than declared as data.

ComposureCDK draws from Stuart Sierra's [Component](https://github.com/stuartsierra/component) library for Clojure. The central idea: a system is a collection of named components with declared dependencies. A framework resolves the dependency graph and manages the lifecycle. The developer defines components and their relationships; the framework handles the rest.

An additional problem shapes the design: **CDK construct configuration is verbose.** A Lambda function with VPC, IAM, logging, and tracing configuration requires dozens of lines of property assignments. The builder pattern reduces this to a fluent chain where only the non-default values need to be specified.

## Lifecycle

`Lifecycle` is the foundational interface. Every component in ComposureCDK implements it.

```typescript
interface Lifecycle<T, Context> {
  build(scope: IConstruct, id: string, context: Context): T;
}
```

- **`scope`** — The CDK construct scope. Resources created during `build` are attached here.
- **`id`** — A unique identifier within the scope.
- **`context`** — The resolved outputs of this component's dependencies, keyed by component name.
- **`T`** — The type this component returns when built. Typically an object containing the CDK constructs and values the component produces (e.g., `{ function: lambda.Function }`).

A `Lifecycle` is deliberately minimal. It has one method. It does not manage its own dependencies or know where it sits in a larger system — that is the job of `compose`.

### Build results must be complete

A builder's result type (`T`) must include every significant resource the builder creates — not just the primary construct. If a builder creates auxiliary resources (such as a log group for access logging, or an IAM role), those resources must be exposed in the result so that consumers can reference, configure, or compose with them.

Resources that are created but not returned are invisible to the rest of the system. This breaks composability: a consuming component cannot declare a dependency on something it cannot see. It also makes testing harder, since there is no programmatic way to inspect or assert against the hidden resource.

The rule: **if a builder creates it, the result should expose it.**

### Why an interface, not a base class

Components are composed, not inherited. A component is any object with a `build` method that matches the signature. This keeps the coupling to ComposureCDK minimal — a component does not need to extend a framework class, call `super()`, or conform to a class hierarchy. It just implements a single method.

## compose

`compose` assembles components into a system.

```typescript
const system = compose(
  {
    database: databaseComponent,
    cache: cacheComponent,
    api: apiComponent,
  },
  {
    database: [],
    cache: [],
    api: ["database", "cache"],
  },
);
```

The first argument is a record of named components. The second declares each component's dependencies as an array of other component keys.

When `compose` is called, it:

1. Builds a directed acyclic graph from the dependency declarations.
2. Validates that the graph has no cycles. If a cycle is found, a `CyclicDependencyError` is thrown immediately — not deferred to build time.
3. Returns a new `Lifecycle` whose `build` method topologically sorts the graph and builds each component in dependency order, passing the resolved outputs of its dependencies as context.

### Eager validation

Cycle detection happens at composition time, not build time. This means structural errors in the system are caught as early as possible — when the system is defined, not when it is deployed. This follows from the project tenet that dependencies are data, and data can be validated.

### The result is a Lifecycle

`compose` returns a `Lifecycle`. This means a composed system can itself be used as a component in a larger system. Composition is recursive — systems can be nested without special handling.

### Dependency declarations are exhaustive

Every component must appear as a key in the dependencies record, even if it has no dependencies (in which case the value is `[]`). This is enforced by the type system. The alternative — making the dependencies record partial and defaulting missing keys to no dependencies — was rejected because it makes it too easy to forget a component and mask a missing dependency declaration.

## Builder

The builder pattern provides a fluent API for configuring components. It is a separate concern from `Lifecycle` — a component does not need a builder to work, and the builder does not need to know about composition.

### The problem it solves

CDK construct props are TypeScript interfaces with many optional properties. Configuring a Lambda function looks like:

```typescript
new lambda.Function(scope, "Handler", {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda"),
  timeout: Duration.seconds(30),
  memorySize: 256,
  tracing: lambda.Tracing.ACTIVE,
  // ... more properties
});
```

This is a single expression with no intermediate state. We cannot conditionally set properties, apply defaults in layers, or inspect the configuration before building.

The builder pattern converts this to:

```typescript
createFunctionBuilder()
  .runtime(Runtime.NODEJS_20_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"))
  .timeout(Duration.seconds(30))
  .memorySize(256)
  .tracing(Tracing.ACTIVE);
```

Each method either sets a property (when called with an argument) or reads the current value (when called with no arguments). The builder returns itself on set, enabling chaining.

### How it works

`Builder<Props, T>(constructor)` creates a new instance of `T` and wraps it in a `Proxy`.

The proxy intercepts property access and routes it based on a set of method names cached at construction time:

- **Props** — any property not in the method set becomes a getter/setter. Called with a value: sets the prop, returns the builder. Called with no arguments: returns the current value.
- **Methods returning `this`** — wrapped to return the proxy instead of the raw instance, preserving the builder chain.
- **Other methods** — delegated directly to the instance. This is how `build()` works: it is a method on the underlying class, and its return value passes through unwrapped.

### IBuilder type

`IBuilder<Props, T>` is a mapped type that generates the builder's type signature from the props interface and the target class:

```typescript
type IBuilder<Props, T> = {
  // Each prop becomes a getter/setter
  [K in keyof Props]-?: ((arg: Props[K]) => IBuilder<Props, T>) & (() => Props[K]);
} & {
  // Methods from T that return T get their return type replaced
  [K in keyof T]: T[K] extends (...args) => T ? (...args) => IBuilder<Props, T> : T[K];
};
```

This means the builder API is fully typed and discoverable via IDE autocompletion — no manual interface authoring required for each component.

### Implementing a component with a builder

A component that uses the builder pattern follows this structure:

```typescript
// 1. Define the props type (often an alias for the CDK props)
type FunctionBuilderProps = FunctionProps;

// 2. Define the build result
interface FunctionBuilderResult {
  function: lambda.Function;
}

// 3. Implement the class with Lifecycle and a props field
class FunctionBuilder implements Lifecycle<FunctionBuilderResult> {
  props: Partial<FunctionBuilderProps> = {};

  build(scope: IConstruct, id: string): FunctionBuilderResult {
    return {
      function: new lambda.Function(scope, id, this.props as FunctionBuilderProps),
    };
  }
}

// 4. Export a factory function
function createFunctionBuilder(): IFunctionBuilder {
  return Builder<FunctionBuilderProps, FunctionBuilder>(FunctionBuilder);
}
```

The class must have a `props: Partial<Props>` field (this is how the builder proxy reads and writes configuration) and a no-argument constructor (the `Builder` function calls `new constructor()`).

Builder authors: see [ADR-0001](adr/0001-builder-type-emission.md) for type-emission rules.

## Defaults

Builders apply secure, AWS-recommended defaults to every resource they create. Each builder package exports a `defaults.ts` module containing a constant of type `Partial<Props>` — the set of properties that are applied unless the user explicitly overrides them.

### How it works

Defaults are merged in the builder's `build()` method using a single spread: `{ ...DEFAULTS, ...this.props }`. Because the `Builder` proxy writes user-provided values to `this.props`, any value the user sets takes precedence over the default. There is no opt-out flag — every default is individually overridable through the existing fluent API, making deviations intentional and visible.

```typescript
// defaults.ts — each property documents the AWS recommendation it implements
export const FUNCTION_DEFAULTS: Partial<FunctionProps> = {
  /** @see https://docs.aws.amazon.com/.../opex-distributed-tracing.html */
  tracing: Tracing.ACTIVE,
  /** @see https://docs.aws.amazon.com/.../opex-logging.html */
  loggingFormat: LoggingFormat.JSON,
};

// function-builder.ts — one-line merge in build()
build(scope, id) {
  const mergedProps = { ...FUNCTION_DEFAULTS, ...this.props };
  return { function: new LambdaFunction(scope, id, mergedProps) };
}
```

For nested properties like `deployOptions`, the builder performs a targeted deep merge to avoid clobbering user-provided values within the nested object.

### Design rationale

- **Defaults live in each builder package**, not in core. The core `Builder` proxy and `Lifecycle` interface are generic — defaults are domain-specific (Lambda defaults differ from API Gateway defaults).
- **Every default property has a JSDoc annotation** linking to the specific AWS recommendation it implements, preferring the [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html) and its lenses (e.g. Serverless Applications Lens, Security Pillar) as the primary source. This keeps each default traceable and auditable.
- **Defaults are exported** so consumers can inspect them, reference them in documentation, or use them in tests.
- **Build-time resources** (such as the `LogGroup` auto-created for API Gateway access logging) are only created when the user has not provided their own. This avoids creating unused resources when the user has a custom setup.

## Ref

Lifecycle, Builder, and compose each solve a distinct problem. But there is a gap between them: **builders are configured before their dependencies are built.** When we set up a REST API builder and need to pass it a Lambda integration, the Lambda function does not exist yet — it will only be created when `compose` builds the system in dependency order. We need a way to say "the value that will come from _this_ component" at configuration time.

`Ref` is that mechanism. It is a lazy reference to a value that another component will produce at build time.

### The problem

Consider an API that needs a Lambda integration. Without `Ref`, we would have to wire things up imperatively after building:

```typescript
// Without Ref — imperative post-build wiring
const handler = createFunctionBuilder()
  .runtime(Runtime.NODEJS_20_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"));

const handlerResult = handler.build(scope, "Handler");

const api = createRestApiBuilder()
  .restApiName("MyApi")
  .addMethod("GET", new LambdaIntegration(handlerResult.function))
  .build(scope, "Api");
```

This defeats the purpose of `compose`. The dependency order is managed manually. The configuration is split across two phases — builder setup and post-build wiring — and the relationship between the API and the handler is implicit in procedural sequencing rather than declared as data.

### The solution

`Ref` lets us capture a reference at configuration time that resolves at build time:

```typescript
// With Ref — declarative cross-component wiring
compose(
  {
    handler: createFunctionBuilder()
      .runtime(Runtime.NODEJS_20_X)
      .handler("index.handler")
      .code(Code.fromAsset("lambda")),

    api: createRestApiBuilder()
      .restApiName("MyApi")
      .addMethod(
        "GET",
        ref("handler", (r: FunctionBuilderResult) => new LambdaIntegration(r.function)),
      ),
  },
  { handler: [], api: ["handler"] },
);
```

All configuration lives in one place. The dependency is declared in the `compose` call. The `ref` tells the API builder "when building, resolve the handler's output and transform it into an integration."

### How it works

A `Ref<T>` wraps a resolver function that takes the build context (a record of component outputs keyed by name) and returns a value of type `T`. It is created with the `ref` factory and can be narrowed or transformed:

```typescript
// Reference a component's full build output
ref<FunctionBuilderResult>("handler");

// Narrow to a specific property
ref<FunctionBuilderResult>("handler").get("function");

// Transform the referenced value
ref<FunctionBuilderResult>("handler")
  .get("function")
  .map((fn) => new LambdaIntegration(fn));

// Shorthand: ref with inline transform
ref("handler", (r: FunctionBuilderResult) => new LambdaIntegration(r.function));
```

- **`ref<T>(component)`** — creates a `Ref` to the named component's build output.
- **`.get(key)`** — narrows to a property of the resolved value. Type-safe: the key must exist on `T`.
- **`.map(fn)`** — transforms the resolved value into a new type. This is the primary way to adapt a dependency's output into the shape a consumer needs.

Resolution happens during the build phase. When `compose` builds a component, it passes the accumulated outputs of already-built dependencies as context. The component's `build` method (or the builder internals) calls `resolve()` on any `Ref` values, which evaluates the resolver chain against that context. If a referenced component is not in the context, a descriptive error is thrown indicating the missing dependency.

### Resolvable

Builders do not accept `Ref<T>` directly — they accept `Resolvable<T>`, which is the union `T | Ref<T>`. This means concrete values and refs are interchangeable at the call site:

```typescript
// Concrete value — works
api.addMethod("GET", new LambdaIntegration(myFunction));

// Ref — also works, same call site
api.addMethod(
  "GET",
  ref("handler", (r) => new LambdaIntegration(r.function)),
);
```

Internally, the builder stores the `Resolvable<T>` as-is. At build time, it calls `resolve(value, context)`, which either returns the concrete value unchanged or evaluates the `Ref`.

### Implementing Ref support in a builder

A builder that accepts cross-component references follows this pattern:

1. Accept `Resolvable<T>` instead of `T` in any method that might receive a dependency's output.
2. Store the `Resolvable<T>` during configuration.
3. Call `resolve(value, context)` during `build` to obtain the concrete value.

```typescript
import { resolve, type Resolvable } from "@composurecdk/core";

class MyBuilder implements Lifecycle<MyResult> {
  private integration?: Resolvable<Integration>;

  addIntegration(integration: Resolvable<Integration>): this {
    this.integration = integration;
    return this;
  }

  build(scope: IConstruct, id: string, context: Record<string, object>): MyResult {
    const concreteIntegration = this.integration ? resolve(this.integration, context) : undefined;
    // ... use concreteIntegration to create CDK constructs
  }
}
```

This is the only change required. The builder does not need to know whether it received a concrete value or a `Ref` — `resolve` handles both uniformly.

## How the pieces fit together

```
createFunctionBuilder()          ← Builder wraps a FunctionBuilder in a Proxy
  .runtime(Runtime.NODEJS_20_X)  ← Proxy sets props.runtime, returns builder
  .handler("index.handler")      ← Proxy sets props.handler, returns builder
  .build(scope, id, context)     ← Proxy delegates to FunctionBuilder.build()
                                    which reads this.props and creates the CDK construct
```

At the system level, with `Ref` wiring the components together:

```
compose(
  {
    handler: createFunctionBuilder().runtime(...).handler(...).code(...),
    api: createRestApiBuilder()
           .restApiName("MyApi")
           .addMethod("GET", ref("handler", r => new LambdaIntegration(r.function))),
  },                                  ↑
  { handler: [], api: ["handler"] },  ref captures a lazy reference during configuration
)
```

This produces a `Lifecycle` that, when built:

1. Topologically sorts: `handler`, then `api`.
2. Builds `handler` with an empty context → returns `{ function: lambda.Function }`.
3. Builds `api` with context `{ handler: { function: lambda.Function } }`.
   - During build, the `Ref` passed to `addMethod` is resolved: the resolver reads `context["handler"]`, applies the transform, and produces a concrete `LambdaIntegration`.
4. Returns the combined result: `{ handler: { ... }, api: { ... } }`.

The composed system is itself a `Lifecycle`, so it can be nested into a larger system with the same mechanism.

The four concepts — Lifecycle, compose, Builder, and Ref — form a closed loop:

- **Lifecycle** defines the build contract.
- **compose** manages dependency order and passes context.
- **Builder** provides fluent configuration.
- **Ref** bridges configuration time and build time, keeping all wiring declarative.
