# Architecture

This document describes the core abstractions in ComposureCDK: the **Lifecycle** interface, the **Builder** pattern, and the **compose** function that ties them together.

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

This is a single expression with no intermediate state. You cannot conditionally set properties, apply defaults in layers, or inspect the configuration before building.

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

## How the pieces fit together

```
createFunctionBuilder()          ← Builder wraps a FunctionBuilder in a Proxy
  .runtime(Runtime.NODEJS_20_X)  ← Proxy sets props.runtime, returns builder
  .handler("index.handler")      ← Proxy sets props.handler, returns builder
  .build(scope, id, context)     ← Proxy delegates to FunctionBuilder.build()
                                    which reads this.props and creates the CDK construct
```

At the system level:

```
compose(
  { fn: functionBuilder, table: tableBuilder },
  { fn: ["table"], table: [] },
)
```

This produces a `Lifecycle` that, when built:

1. Topologically sorts: `table`, then `fn`.
2. Builds `table` with an empty context → returns `{ table: dynamodb.Table }`.
3. Builds `fn` with context `{ table: { table: dynamodb.Table } }` → returns `{ function: lambda.Function }`.
4. Returns the combined result: `{ table: { ... }, fn: { ... } }`.

The composed system is itself a `Lifecycle`, so it can be nested into a larger system with the same mechanism.
